// ============================================================
// EMAILS — staff email customers from the console
// ============================================================
//
// Two sending accounts:
//   gmail   — the Transco Gmail, connected once by an admin with "Connect
//             Gmail" (Google sign-in; Railway can't reach Gmail's SMTP).
//             Only the send permission is asked for. The refresh token is
//             stored encrypted (pii.js) in settings { _id: 'gmailAccount' }.
//   outlook — sydney@transcocargo.com.au through Microsoft Graph, ready for
//             when the Microsoft 365 admin gives the app details:
//             OUTLOOK_TENANT_ID, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET,
//             OUTLOOK_MAILBOX (+ OUTLOOK_SECRET_EXPIRES, YYYY-MM-DD).
//
// Who sends from which: Outlook — every login with the Emails page. Gmail —
// admins; until Outlook is connected, everyone with the Emails page (it's
// the only account for now).
//
// Every sent email is logged in `sentEmails` (the Emails page and the
// customer profile's history).
//
// AI drafts (Gemini): from a chat in the console, or from a screenshot of
// a chat elsewhere. Facts come only from the same fact pack the bot uses
// (prices, calendar); anything else is left as [check] for staff, and an
// email can't be sent while a [check] is left.
//
//   GET  /api/emails                       sent emails (filters: customerId, account, q)
//   GET  /api/emails/accounts              which accounts are connected / usable
//   GET  /api/emails/gmail/connect         admin: Google sign-in URL
//   POST /api/emails/gmail/disconnect      admin
//   GET  /api/emails/recipients?q=|customerId=   customers with an email
//   POST /api/emails/send
//   POST /api/emails/draft
//   GET  /api/email-oauth/gmail/callback   (public) Google comes back here

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { ObjectId } = require('mongodb');
const { getDb, settings, customers, messages, bookings } = require('./db');
const pii = require('./pii');
const agent = require('./agentAnswer');

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'openid', 'email'];
const BACKEND_URL = (process.env.PUBLIC_BACKEND_URL || process.env.MEDIA_BASE_URL || 'https://transco-backend-production.up.railway.app').replace(/\/+$/, '');
const CONSOLE_URL = (process.env.CONSOLE_URL || 'https://transco-console.transcocargo.workers.dev').replace(/\/+$/, '');
const GMAIL_REDIRECT = `${BACKEND_URL}/api/email-oauth/gmail/callback`;
const SENDER_NAME = process.env.EMAIL_SENDER_NAME || 'Transco Cargo Sydney';
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const CHECK_RE = /\[check[^\]]*\]/i;

const sentEmails = () => getDb().collection('sentEmails');
// Pasted keys often carry a stray space or line break.
const env = name => String(process.env[name] || '').trim();
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- OAuth state (signed, 10 minutes) ----------

function stateSecret() {
  return process.env.SESSION_SECRET || 'transco-email-state';
}
function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function readState(state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

// ---------- Gmail ----------

const gmailConfigured = () => Boolean(env('GOOGLE_OAUTH_CLIENT_ID') && env('GOOGLE_OAUTH_CLIENT_SECRET'));

async function gmailAccount() {
  const doc = await settings().findOne({ _id: 'gmailAccount' });
  if (!doc || !doc.refreshToken) return null;
  return doc;
}

let gmailToken = null; // { token, exp }
async function gmailAccessToken() {
  if (gmailToken && gmailToken.exp > Date.now() + 60 * 1000) return gmailToken.token;
  const account = await gmailAccount();
  const refreshToken = account && pii.open(account.refreshToken);
  if (!refreshToken) throw new Error('Gmail is not connected. An admin can connect it in Emails → Email accounts.');
  try {
    const r = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
    gmailToken = { token: r.data.access_token, exp: Date.now() + (r.data.expires_in || 3000) * 1000 };
    return gmailToken.token;
  } catch (err) {
    if (err.response?.data?.error === 'invalid_grant') {
      await settings().updateOne({ _id: 'gmailAccount' }, { $set: { broken: true, brokenAt: new Date() } });
      throw new Error('Gmail access has expired or was removed. An admin needs to press "Connect Gmail" again.');
    }
    throw err;
  }
}

// RFC 2047 for non-ASCII headers (names, subjects in Sinhala/Tamil).
const encodeHeader = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

function buildMime({ from, to, cc, subject, textBody, htmlBody }) {
  const boundary = 'tc_' + crypto.randomBytes(12).toString('hex');
  const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(textBody),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(htmlBody),
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

async function sendViaGmail(mail) {
  const account = await gmailAccount();
  const token = await gmailAccessToken();
  const raw = buildMime({ ...mail, from: `${encodeHeader(SENDER_NAME)} <${account.email}>` });
  const r = await axios.post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { raw: Buffer.from(raw, 'utf8').toString('base64url') },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
  );
  return { fromAddress: account.email, providerId: r.data?.id || null };
}

// ---------- Outlook (Microsoft Graph) ----------

const outlookConfigured = () => Boolean(env('OUTLOOK_TENANT_ID') && env('OUTLOOK_CLIENT_ID') && env('OUTLOOK_CLIENT_SECRET') && env('OUTLOOK_MAILBOX'));

let outlookToken = null;
async function outlookAccessToken() {
  if (outlookToken && outlookToken.exp > Date.now() + 60 * 1000) return outlookToken.token;
  const r = await axios.post(
    `https://login.microsoftonline.com/${encodeURIComponent(env('OUTLOOK_TENANT_ID'))}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id: env('OUTLOOK_CLIENT_ID'),
      client_secret: env('OUTLOOK_CLIENT_SECRET'),
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
  );
  outlookToken = { token: r.data.access_token, exp: Date.now() + (r.data.expires_in || 3000) * 1000 };
  return outlookToken.token;
}

async function sendViaOutlook({ to, cc, subject, htmlBody }) {
  const token = await outlookAccessToken();
  const mailbox = env('OUTLOOK_MAILBOX');
  const list = s => String(s || '').split(',').map(a => a.trim()).filter(Boolean).map(address => ({ emailAddress: { address } }));
  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`,
    {
      message: { subject, body: { contentType: 'HTML', content: htmlBody }, toRecipients: list(to), ccRecipients: list(cc) },
      saveToSentItems: true
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
  );
  return { fromAddress: mailbox, providerId: null };
}

// ---------- shared ----------

async function accountStatus(isAdmin) {
  const gmail = await gmailAccount();
  const outlookOn = outlookConfigured();
  const gmailOn = Boolean(gmail && !gmail.broken);
  const expires = process.env.OUTLOOK_SECRET_EXPIRES || null;
  return {
    outlook: {
      connected: outlookOn,
      address: env('OUTLOOK_MAILBOX') || 'sydney@transcocargo.com.au',
      secretExpires: expires,
      usable: outlookOn
    },
    gmail: {
      configured: gmailConfigured(),
      connected: gmailOn,
      broken: Boolean(gmail && gmail.broken),
      address: gmail ? gmail.email : null,
      connectedBy: gmail ? gmail.connectedBy || null : null,
      connectedAt: gmail ? gmail.connectedAt || null : null,
      // Admins always; everyone else only while Outlook isn't connected.
      usable: gmailOn && (isAdmin || !outlookOn),
      adminOnly: outlookOn
    }
  };
}

function cleanAddresses(value) {
  const list = String(value || '').split(/[,;\s]+/).map(a => a.trim()).filter(Boolean);
  if (list.length > 10) return { error: 'Up to 10 addresses.' };
  const bad = list.find(a => !EMAIL_RE.test(a));
  if (bad) return { error: `"${bad}" doesn't look like an email address.` };
  return { value: list.join(', ') };
}

function toHtml(body) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a">${escapeHtml(body).replace(/\r?\n/g, '<br>')}</div>`;
}

function shape(doc) {
  return {
    id: String(doc._id),
    account: doc.account,
    fromAddress: doc.fromAddress,
    to: doc.to,
    cc: doc.cc || null,
    subject: doc.subject,
    body: doc.body,
    customerId: doc.customerId || null,
    customerName: doc.customerName || null,
    bookingId: doc.bookingId || null,
    bookingCode: doc.bookingCode || null,
    sentById: doc.sentById,
    sentByName: doc.sentByName,
    aiDrafted: Boolean(doc.aiDrafted),
    sentAt: doc.sentAt
  };
}

const lastDigits = p => String(p || '').replace(/\D/g, '').slice(-9);

async function findCustomer({ phone, email }) {
  const e = String(email || '').trim().toLowerCase();
  if (e && EMAIL_RE.test(e)) {
    const c = await customers().findOne({ email: { $regex: `^${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
    if (c) return c;
  }
  const d = lastDigits(phone);
  if (d.length >= 8) {
    const c = await customers().findOne({ phoneNumber: { $regex: `${d}$` } });
    if (c) return c;
  }
  return null;
}

function bookingLine(b) {
  if (!b) return '';
  return [
    b.bookingCode && `Booking ${b.bookingCode}`,
    b.resolvedDate && `${b.handover === 'pickup' ? 'pickup' : 'drop-off'} ${b.resolvedDate}${b.requestedTime ? ' ' + b.requestedTime : ''}`,
    b.boxSummary,
    b.destination && `to ${b.destination}`,
    b.blNumber && `BL ${b.blNumber}`,
    b.batchNumber && `Shipment ${b.batchNumber}`,
    b.status && `status ${b.status}`
  ].filter(Boolean).join(' · ');
}

const DRAFT_RULES = `You write emails for Transco Cargo Sydney, a cargo company shipping boxes from Sydney to Sri Lanka and India. A staff member will check and send your email.

Write ONE reply email to the customer, answering what they asked or need in the chat.

RULES
- Use ONLY the FACTS and BOOKING below for prices, dates, shipment numbers and policies. Never invent a price, date, number, address or promise.
- Anything you need but the FACTS don't give, write as [check: what is needed], e.g. "[check: delivery date]". Staff fill these in.
- Never include passport/NIC numbers, bank card numbers or passwords, even if visible.
- Friendly, clear and professional. Short paragraphs. Plain text (no Markdown, no ** or #). Use "• " for lists.
- Start with "Hi <first name>," (or "Hi," if the name isn't known). End with "Kind regards,\\nTransco Cargo Sydney" — nothing after that.
- Write in English unless the staff note asks for another language.
- If the staff member gave a note, follow it.

Reply with JSON only, no code fence:
{"subject": "...", "body": "...", "customer": {"name": "...or null", "phone": "...or null", "email": "...or null"}}
(customer = the customer's details if you can see them in the chat or screenshot)`;

function parseDraft(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]);
    if (typeof d.subject !== 'string' || typeof d.body !== 'string') return null;
    return d;
  } catch {
    return null;
  }
}

module.exports = function createEmailRouters({ isStaffAdmin, broadcast }) {
  const router = express.Router();
  const oauthRouter = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const me = req => ({ id: String(req.user.sub), name: String(req.user.name || req.user.email || 'Staff').trim() });

  async function allowedAccounts(req) {
    const status = await accountStatus(await isStaffAdmin(req));
    return { status, allowed: ['outlook', 'gmail'].filter(a => status[a].usable) };
  }

  router.get('/accounts', wrap(async (req, res) => {
    const isAdmin = await isStaffAdmin(req);
    res.json({ ...(await accountStatus(isAdmin)), isAdmin, aiDrafts: Boolean(process.env.GEMINI_API_KEY) });
  }));

  router.get('/gmail/connect', wrap(async (req, res) => {
    if (!(await isStaffAdmin(req))) return res.status(403).json({ error: 'Only an admin can connect Gmail.' });
    if (!gmailConfigured()) return res.status(400).json({ error: 'Google sign-in isn\'t set up on the server yet (GOOGLE_OAUTH_CLIENT_ID / SECRET).' });
    const params = new URLSearchParams({
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      redirect_uri: GMAIL_REDIRECT,
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state: signState({ by: me(req).name, byId: me(req).id })
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }));

  router.post('/gmail/disconnect', wrap(async (req, res) => {
    if (!(await isStaffAdmin(req))) return res.status(403).json({ error: 'Only an admin can disconnect Gmail.' });
    const account = await gmailAccount();
    const token = account && pii.open(account.refreshToken);
    if (token) axios.post('https://oauth2.googleapis.com/revoke', new URLSearchParams({ token }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => {});
    await settings().deleteOne({ _id: 'gmailAccount' });
    gmailToken = null;
    res.json({ success: true });
  }));

  // Google sends the browser back here (no staff token on this request —
  // the signed state proves an admin started it).
  oauthRouter.get('/gmail/callback', wrap(async (req, res) => {
    const back = result => res.redirect(`${CONSOLE_URL}/console/emails?gmail=${result}`);
    const state = readState(req.query.state);
    if (!state) return back('expired');
    if (req.query.error || !req.query.code) return back('cancelled');
    try {
      const r = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
        code: String(req.query.code),
        client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
        client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
        redirect_uri: GMAIL_REDIRECT,
        grant_type: 'authorization_code'
      }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
      const { refresh_token: refreshToken, id_token: idToken, scope } = r.data;
      if (!refreshToken) return back('no_refresh');
      if (!String(scope || '').includes('gmail.send')) return back('no_send');
      let email = null;
      try {
        email = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || null;
      } catch { /* shown as unknown */ }
      await settings().updateOne(
        { _id: 'gmailAccount' },
        { $set: { email, refreshToken: pii.seal(refreshToken), connectedBy: state.by, connectedById: state.byId, connectedAt: new Date(), broken: false } },
        { upsert: true }
      );
      gmailToken = null;
      return back('connected');
    } catch (err) {
      console.error('Gmail connect failed:', err.response?.data || err.message);
      return back('failed');
    }
  }));

  router.get('/', wrap(async (req, res) => {
    const isAdmin = await isStaffAdmin(req);
    const { allowed } = await allowedAccounts(req);
    const query = {};
    // Admins see everything; others see the accounts they can send from.
    if (!isAdmin) query.account = { $in: allowed.length ? allowed : ['outlook'] };
    if (req.query.account === 'gmail' || req.query.account === 'outlook') {
      if (!isAdmin && !allowed.includes(req.query.account)) return res.json({ emails: [] });
      query.account = req.query.account;
    }
    if (typeof req.query.customerId === 'string' && req.query.customerId) {
      query.customerId = { $in: req.query.customerId.split(',').slice(0, 10) };
    }
    if (typeof req.query.bookingId === 'string' && req.query.bookingId) query.bookingId = req.query.bookingId;
    if (typeof req.query.sentById === 'string' && req.query.sentById) query.sentById = req.query.sentById;
    const q = text(req.query.q, 80);
    if (q) {
      const re = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      query.$or = [{ subject: re }, { to: re }, { customerName: re }, { body: re }];
    }
    const list = await sentEmails().find(query).sort({ sentAt: -1 }).limit(300).toArray();
    res.json({ emails: list.map(shape) });
  }));

  router.get('/recipients', wrap(async (req, res) => {
    if (typeof req.query.customerId === 'string' && ObjectId.isValid(req.query.customerId)) {
      const c = await customers().findOne({ _id: new ObjectId(req.query.customerId) }, { projection: { name: 1, email: 1, phoneNumber: 1, customerCode: 1, linkedCustomerId: 1 } });
      let owner = c;
      // A staff-linked website chat → the linked customer's email.
      if (c && !c.email && c.linkedCustomerId && ObjectId.isValid(String(c.linkedCustomerId))) {
        owner = (await customers().findOne({ _id: new ObjectId(String(c.linkedCustomerId)) }, { projection: { name: 1, email: 1, phoneNumber: 1, customerCode: 1 } })) || c;
      }
      return res.json({ recipients: owner ? [{ id: String(owner._id), name: owner.name || null, email: owner.email || null, phone: owner.phoneNumber || null, code: owner.customerCode || null }] : [] });
    }
    const q = text(req.query.q, 60);
    if (q.length < 2) return res.json({ recipients: [] });
    const re = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const list = await customers()
      .find({ email: { $exists: true, $nin: [null, ''] }, $or: [{ name: re }, { email: re }, { phoneNumber: re }, { customerCode: re }] }, { projection: { name: 1, email: 1, phoneNumber: 1, customerCode: 1 } })
      .limit(8)
      .toArray();
    res.json({ recipients: list.map(c => ({ id: String(c._id), name: c.name || null, email: c.email, phone: c.phoneNumber || null, code: c.customerCode || null })) });
  }));

  router.post('/send', wrap(async (req, res) => {
    const body = req.body || {};
    const account = body.account === 'gmail' ? 'gmail' : body.account === 'outlook' ? 'outlook' : null;
    if (!account) return res.status(400).json({ error: 'Choose which email address to send from.' });
    const { allowed } = await allowedAccounts(req);
    if (!allowed.includes(account)) {
      return res.status(403).json({ error: account === 'outlook' ? 'Outlook isn\'t connected yet.' : 'You can\'t send from the Gmail account.' });
    }
    const to = cleanAddresses(body.to);
    if (to.error || !to.value) return res.status(400).json({ error: to.error || 'Add who the email is to.', field: 'to' });
    const cc = cleanAddresses(body.cc);
    if (cc.error) return res.status(400).json({ error: cc.error, field: 'cc' });
    const subject = text(body.subject, 200);
    if (!subject) return res.status(400).json({ error: 'Add a subject.', field: 'subject' });
    const message = typeof body.body === 'string' ? body.body.trim().slice(0, 20000) : '';
    if (!message) return res.status(400).json({ error: 'Write the email.', field: 'body' });
    if (CHECK_RE.test(subject) || CHECK_RE.test(message)) {
      return res.status(400).json({ error: 'Fill in every [check] before sending.', field: 'body' });
    }

    let customer = null;
    if (typeof body.customerId === 'string' && ObjectId.isValid(body.customerId)) {
      customer = await customers().findOne({ _id: new ObjectId(body.customerId) }, { projection: { name: 1 } });
    }
    let booking = null;
    if (typeof body.bookingId === 'string' && ObjectId.isValid(body.bookingId)) {
      booking = await bookings().findOne({ _id: new ObjectId(body.bookingId) }, { projection: { bookingCode: 1 } });
    }

    const mail = { to: to.value, cc: cc.value || '', subject, textBody: message, htmlBody: toHtml(message) };
    let result;
    try {
      result = account === 'gmail' ? await sendViaGmail(mail) : await sendViaOutlook(mail);
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.response?.data?.error_description || err.message;
      console.error(`Email send failed (${account}):`, detail);
      return res.status(502).json({ error: `The email wasn't sent: ${String(detail).slice(0, 200)}` });
    }

    const who = me(req);
    const doc = {
      account,
      fromAddress: result.fromAddress,
      providerId: result.providerId,
      to: to.value,
      cc: cc.value || null,
      subject,
      body: message,
      customerId: customer ? String(customer._id) : null,
      customerName: customer ? customer.name || null : text(body.customerName, 120) || null,
      bookingId: booking ? String(booking._id) : null,
      bookingCode: booking ? booking.bookingCode || null : null,
      sentById: who.id,
      sentByName: who.name,
      aiDrafted: Boolean(body.aiDrafted),
      sentAt: new Date()
    };
    const { insertedId } = await sentEmails().insertOne(doc);
    const email = shape({ ...doc, _id: insertedId });
    if (broadcast) broadcast('email.sent', { id: email.id, customerId: email.customerId });
    res.status(201).json({ email });
  }));

  router.post('/draft', wrap(async (req, res) => {
    if (!process.env.GEMINI_API_KEY) return res.status(400).json({ error: 'AI drafts aren\'t set up on the server.' });
    const body = req.body || {};
    const note = text(body.note, 500);

    let image = null;
    if (typeof body.image === 'string' && body.image) {
      const m = body.image.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return res.status(400).json({ error: 'That file isn\'t a picture. Use a PNG or JPG screenshot.' });
      const data = Buffer.from(m[2], 'base64');
      if (data.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'That picture is too big (max 6 MB).' });
      image = { mimeType: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], data };
    }

    const ids = (Array.isArray(body.customerIds) ? body.customerIds : [])
      .filter(id => typeof id === 'string' && ObjectId.isValid(id))
      .slice(0, 5);
    let chat = '';
    if (ids.length) {
      const list = await messages()
        .find({ customerId: { $in: ids.map(id => new ObjectId(id)).concat(ids) } }, { projection: { senderType: 1, content: 1, timestamp: 1, createdAt: 1 } })
        .sort({ _id: -1 })
        .limit(25)
        .toArray();
      chat = list.reverse()
        .filter(m => m.content)
        .map(m => `${m.senderType === 'CUSTOMER' ? 'Customer' : 'Transco'}: ${String(m.content).slice(0, 700)}`)
        .join('\n');
    }
    if (!image && !chat) return res.status(400).json({ error: 'Add a screenshot, or open this from a chat with messages.' });

    let customer = null;
    if (typeof body.customerId === 'string' && ObjectId.isValid(body.customerId)) {
      customer = await customers().findOne({ _id: new ObjectId(body.customerId) }, { projection: { name: 1, email: 1, phoneNumber: 1 } });
    }
    let booking = null;
    if (typeof body.bookingId === 'string' && ObjectId.isValid(body.bookingId)) {
      booking = await bookings().findOne({ _id: new ObjectId(body.bookingId) });
    } else if (customer) {
      booking = await bookings()
        .find({ customerId: { $in: [String(customer._id), customer._id] }, status: { $ne: 'cancelled' } })
        .sort({ createdAt: -1 })
        .limit(1)
        .next()
        .catch(() => null);
    }

    let facts = '';
    try {
      ({ text: facts } = await agent.buildFacts());
    } catch (err) {
      console.error('Email draft: facts failed:', err.message);
    }

    const system = `${DRAFT_RULES}\n\nFACTS:\n${facts || '(none available — use [check] for every price and date)'}`;
    const ask = [
      customer && customer.name ? `Customer: ${customer.name}` : 'Customer: see the chat',
      booking ? `BOOKING: ${bookingLine(booking)}` : 'BOOKING: none known',
      note ? `Staff note: ${note}` : null,
      chat ? `\nChat:\n${chat}` : null,
      image ? '\nThe attached screenshot is the customer chat to answer.' : null
    ].filter(Boolean).join('\n');

    let raw;
    try {
      raw = await agent.callGemini(system, ask, image);
    } catch (err) {
      console.error('Email draft failed:', err.response?.status || '', err.message);
      return res.status(502).json({ error: 'The AI couldn\'t write a draft just now. Please try again.' });
    }
    const draft = parseDraft(raw);
    if (!draft) return res.status(502).json({ error: 'The AI didn\'t return a usable draft. Please try again.' });

    // Who it's for: the customer we came from, else a match from the screenshot.
    let match = customer;
    const seen = draft.customer && typeof draft.customer === 'object' ? draft.customer : {};
    if (!match) match = await findCustomer({ phone: seen.phone, email: seen.email });
    res.json({
      subject: text(draft.subject, 200),
      body: String(draft.body).replace(/\*\*(.+?)\*\*/g, '$1').trim().slice(0, 8000),
      seen: { name: seen.name || null, phone: seen.phone || null, email: seen.email || null },
      customer: match ? { id: String(match._id), name: match.name || null, email: match.email || null } : null
    });
  }));

  return { router, oauthRouter };
};
