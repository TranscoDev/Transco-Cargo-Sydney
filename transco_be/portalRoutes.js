// ============================================================
// MY TRANSCO — customer portal API, mounted at /api/portal
// ============================================================
//
// Listed in server.js's PUBLIC_API_PREFIXES so the STAFF auth check
// skips it — this router applies its own CUSTOMER auth instead
// (requireCustomer), on every route except requesting/verifying a
// sign-in code. Nothing here ever accepts a customer id from the
// request: "who is asking" is always req.customer, resolved from the
// signed token, and every read/write goes through customerTools.js,
// which filters by that id.
//
// Error messages are written for customers (they're shown as-is in the
// UI) — no stack traces, no database wording.

const crypto = require('crypto');
const express = require('express');
const { customers, customerOtps } = require('./db');

// "Forgot password" links: single use, 30 minutes. Only a hash of the
// token is stored, so a database leak can't be used to reset passwords.
const RESET_TTL_MS = 30 * 60 * 1000;
// "Confirm it's you" emails for a number we already know (sign-up from an
// imported / WhatsApp customer): single use, 24 hours.
const SIGNUP_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
// WhatsApp sign-in codes are OFF (Oct 2026): WhatsApp only delivers a
// business message within 24 hours of the customer's last message, so
// codes often never arrived. Sign-in is email/mobile + password; a known
// number proves itself with an email link instead. 'on' brings the code
// routes back (the test suite uses it to keep covering them).
const WHATSAPP_LOGIN_CODES = process.env.WHATSAPP_LOGIN_CODES === 'on';
const CODES_OFF = {
  error: 'We no longer send sign-in codes on WhatsApp. Please sign in with your email or mobile and password, or tap "Forgot password?" to get an email link. Need help? Call us on 0434 842 023.',
  reason: 'codes_off'
};
const PORTAL_SITE_URL = (process.env.PORTAL_SITE_URL || 'https://my.transcosydney.com.au').replace(/\/$/, '');
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const { normalizePhoneNumber } = require('./normalizePhone');
const { OTP_TTL_MS, OTP_MAX_ATTEMPTS } = require('./customerAuth');
const { hasRealName } = require('./customerTools');

const ALLOWED_COUNTRY_CODES = ['61', '94', '91'];
const ACQUISITION_SOURCES = ['warehouse_qr', 'website', 'direct'];
const LANGUAGES = ['en', 'si', 'ta'];
const CONTACT_PREFERENCES = ['whatsapp', 'phone', 'email'];
const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const MIN_PASSWORD_LENGTH = 8;
// Bump when the Privacy Policy (website /privacy.html) changes materially.
const PRIVACY_POLICY_VERSION = '2026-10-10';
const MAX_PASSWORD_LENGTH = 200;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

const CODES_PER_PHONE_WINDOW_MS = 15 * 60 * 1000;
const CODES_PER_PHONE_MAX = 3;
const CODE_RESEND_COOLDOWN_MS = 45 * 1000;
const IP_WINDOW_MS = 15 * 60 * 1000;
// Overridable so the test suite (many sign-ins from one address) can raise it.
const IP_MAX_REQUESTS = Number(process.env.PORTAL_AUTH_IP_LIMIT) || 60;

// Small in-memory limiter for the unauthenticated auth endpoints —
// a backstop in front of the per-phone limits (which are stored in
// Mongo and so survive restarts / multiple instances).
function createIpLimiter(windowMs, max) {
  const hits = new Map();
  return function limited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) {
      for (const [key, times] of hits) {
        if (!times.some(t => now - t < windowMs)) hits.delete(key);
      }
    }
    return recent.length > max;
  };
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function cleanString(value, max) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? null : trimmed;
}

// Validates a profile update (customer's own PATCH /me, and staff edits
// from the console). Returns { error, field } or { set }.
function profileUpdateFromBody(body) {
  const set = {};

  if ('name' in body) {
    const name = cleanString(body.name, 80);
    if (!name || name.length < 2 || /^\+?\d[\d\s-]+$/.test(name)) {
      return { error: 'Please enter your name.', field: 'name' };
    }
    set.name = name;
  }
  if ('email' in body) {
    const email = cleanString(body.email, 120);
    if (email === null || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return { error: 'That email address doesn\'t look right.', field: 'email' };
    }
    set.email = email ? email.toLowerCase() : null;
  }
  if ('address' in body) {
    const a = body.address || {};
    const line1 = cleanString(a.line1 ?? '', 120);
    const suburb = cleanString(a.suburb ?? '', 60);
    const state = cleanString(a.state ?? '', 10);
    const postcode = cleanString(a.postcode ?? '', 10);
    if ([line1, suburb, state, postcode].includes(null)) {
      return { error: 'One of the address fields is too long.', field: 'address' };
    }
    if (state && !AU_STATES.includes(state.toUpperCase())) {
      return { error: 'Please choose a state from the list.', field: 'state' };
    }
    if (postcode && !/^\d{4}$/.test(postcode)) {
      return { error: 'Postcode should be 4 digits.', field: 'postcode' };
    }
    set.address = { line1, suburb, state: state.toUpperCase(), postcode };
  }
  if ('preferredLanguage' in body) {
    if (!LANGUAGES.includes(body.preferredLanguage)) {
      return { error: 'Please choose a language from the list.', field: 'preferredLanguage' };
    }
    set.preferredLanguage = body.preferredLanguage;
  }
  if ('contactPreference' in body) {
    if (!CONTACT_PREFERENCES.includes(body.contactPreference)) {
      return { error: 'Please choose how we should contact you.', field: 'contactPreference' };
    }
    set.contactPreference = body.contactPreference;
  }
  return { set };
}

// An email can sign in to one My Transco account only. Scoped to online
// accounts (password set or ever signed in) — an email staff typed on an
// old WhatsApp/import record doesn't block anyone.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function emailTakenByOtherAccount(email, excludeId) {
  if (!email) return false;
  const q = {
    email: String(email).toLowerCase(),
    $or: [{ passwordHash: { $exists: true } }, { portalJoinedAt: { $exists: true } }]
  };
  if (excludeId) q._id = { $ne: excludeId };
  return Boolean(await customers().findOne(q, { projection: { _id: 1 } }));
}

module.exports = function createPortalRouter({ customerAuth, tools, sendOtpMessage, sendCustomerEmail, hashPassword, verifyPassword }) {
  const router = express.Router();
  const ipLimited = createIpLimiter(IP_WINDOW_MS, IP_MAX_REQUESTS);

  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function parsePhone(body) {
    const countryCode = String((body && body.countryCode) || '61');
    if (!ALLOWED_COUNTRY_CODES.includes(countryCode)) return null;
    const raw = String((body && body.phone) || '');
    let digits = raw.replace(/\D/g, '');
    // Someone typed the full international number into the box.
    if (digits.startsWith(countryCode) && digits.length > 10) digits = digits.slice(countryCode.length);
    return normalizePhoneNumber(digits, countryCode);
  }

  // Checks a WhatsApp code for this number. Returns null when it's right
  // (and spends every outstanding code for the number — single use), or
  // { status, error } to send back.
  async function checkOtp(phoneNumber, rawCode) {
    const code = String(rawCode || '').replace(/\D/g, '');
    if (!phoneNumber || code.length !== 6) {
      return { status: 400, error: 'Please enter the 6-digit code we sent you.' };
    }
    const otp = await customerOtps().findOne(
      { phoneNumber, expiresAt: { $gt: new Date() } },
      { sort: { createdAt: -1 } }
    );
    if (!otp) {
      return { status: 400, error: 'That code has expired. Please ask for a new one.' };
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return { status: 429, error: 'Too many incorrect tries. Please ask for a new code.' };
    }
    if (!customerAuth.otpMatches(phoneNumber, code, otp.codeHash)) {
      await customerOtps().updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
      const left = OTP_MAX_ATTEMPTS - otp.attempts - 1;
      return {
        status: 400,
        error: left > 0 ? `That code isn't right. You have ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many incorrect tries. Please ask for a new code.'
      };
    }
    await customerOtps().deleteMany({ phoneNumber });
    return null;
  }

  // ---------- sign in ----------

  router.post('/auth/request-code', wrap(async (req, res) => {
    if (!WHATSAPP_LOGIN_CODES) return res.status(410).json(CODES_OFF);
    if (ipLimited(clientIp(req))) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }

    const phoneNumber = parsePhone(req.body);
    if (!phoneNumber) {
      return res.status(400).json({ error: "That phone number doesn't look right. Please check it and try again." });
    }

    const since = new Date(Date.now() - CODES_PER_PHONE_WINDOW_MS);
    const recent = await customerOtps()
      .find({ phoneNumber, createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .toArray();

    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < CODE_RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((CODE_RESEND_COOLDOWN_MS - (Date.now() - recent[0].createdAt.getTime())) / 1000);
      return res.status(429).json({ error: `Please wait ${retryAfter} seconds before asking for another code.`, retryAfter });
    }
    if (recent.length >= CODES_PER_PHONE_MAX) {
      return res.status(429).json({ error: 'Too many codes requested. Please wait 15 minutes and try again.' });
    }

    const code = customerAuth.generateOtp();
    const { insertedId } = await customerOtps().insertOne({
      phoneNumber,
      codeHash: customerAuth.hashOtp(phoneNumber, code),
      attempts: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + OTP_TTL_MS)
    });

    const sent = await sendOtpMessage(phoneNumber, code);
    if (!sent) {
      await customerOtps().deleteOne({ _id: insertedId });
      return res.status(503).json({
        error: "We couldn't send a code to that number right now. Please try again shortly, or call us on 0434 842 023."
      });
    }

    res.json({ sent: true, channel: 'whatsapp', expiresInSeconds: Math.round(OTP_TTL_MS / 1000) });
  }));

  router.post('/auth/verify-code', wrap(async (req, res) => {
    if (!WHATSAPP_LOGIN_CODES) return res.status(410).json(CODES_OFF);
    if (ipLimited(clientIp(req))) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }

    const phoneNumber = parsePhone(req.body);
    const otpError = await checkOtp(phoneNumber, req.body && req.body.code);
    if (otpError) return res.status(otpError.status).json({ error: otpError.error });

    // "Forgot password? Use a WhatsApp code": the code proves the phone,
    // so instead of signing in, hand back a one-time reset token — the
    // same kind the emailed link carries — and the site opens the
    // "choose a new password" screen with it (/auth/reset-password).
    if (req.body && req.body.purpose === 'reset') {
      const c = await customers().findOne({ phoneNumber });
      if (!c) {
        return res.status(404).json({ error: "We couldn't find an account for that number. Don't have an account? Sign up.", reason: 'no_account' });
      }
      const resetToken = crypto.randomBytes(32).toString('base64url');
      const update = { $set: { passwordReset: { hash: hashToken(resetToken), expiresAt: new Date(Date.now() + RESET_TTL_MS) } } };
      // Same rule as a normal code sign-in: a password set before the
      // number was proven may not be theirs — remove it and sign out
      // its sessions, even if they never finish choosing a new one.
      if (c.phoneVerified === false) {
        update.$set.phoneVerified = true;
        update.$set.phoneVerifiedAt = new Date();
        update.$unset = { passwordHash: '' };
        update.$inc = { portalTokenVersion: 1 };
      }
      await customers().updateOne({ _id: c._id }, update);
      return res.json({ resetToken });
    }

    const source = ACQUISITION_SOURCES.includes(req.body && req.body.source) ? req.body.source : 'website';
    const now = new Date();

    // Same phone -> same customer record, whichever channel created it
    // first (WhatsApp, historical import, staff, or this portal). Never
    // a second record for the same person.
    const result = await customers().findOneAndUpdate(
      { phoneNumber },
      {
        $setOnInsert: {
          phoneNumber,
          name: phoneNumber,
          mode: 'CHATBOT',
          status: 'ACTIVE',
          createdAt: now
        },
        $addToSet: { sources: 'portal' },
        $set: { lastPortalLoginAt: now }
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true }
    );
    let customer = result.value;

    // The WhatsApp code proves this person holds the phone. If the record
    // was created by a password sign-up that never proved the number
    // (phoneVerified === false), the history on this number now becomes
    // visible — so a password set by someone else must not survive: it's
    // removed and their sessions are signed out. The one exception is the
    // same signed-in customer verifying their own number from My
    // Transco, who keeps the password they chose.
    if (customer.phoneVerified === false) {
      const signedIn = await customerAuth.customerFromRequest(req);
      const sameCustomer = signedIn && String(signedIn._id) === String(customer._id);
      const update = { $set: { phoneVerified: true, phoneVerifiedAt: now } };
      if (!sameCustomer) {
        update.$unset = { passwordHash: '' };
        update.$inc = { portalTokenVersion: 1 };
      }
      customer = await customers().findOneAndUpdate({ _id: customer._id }, update, { returnDocument: 'after' });
    }

    // First-ever portal sign-in for this person (new OR an existing
    // WhatsApp/historical customer): record when and where they came
    // from, once — later sign-ins never overwrite it.
    if (!customer.portalJoinedAt) {
      await customers().updateOne(
        { _id: customer._id, portalJoinedAt: { $exists: false } },
        { $set: { portalJoinedAt: now, acquisitionSource: source } }
      );
      customer.portalJoinedAt = now;
    }

    await tools.ensureCustomerCode(customer);

    res.json({
      token: customerAuth.signCustomerToken(customer),
      profile: tools.publicProfile(customer),
      needsName: !hasRealName(customer)
    });
  }));

  // ---------- phone + password (no WhatsApp needed) ----------
  //
  // A password account proves nothing about the phone number typed in,
  // so:
  //  - it can only be created for a number we have NO record of yet —
  //    a number with WhatsApp/shipment/staff history must be proven
  //    first (WhatsApp code, or staff setting the password after a call);
  //  - the account is marked phoneVerified: false, and customerTools.js
  //    only shows it what it created itself in My Transco until the
  //    number is proven (a WhatsApp booking or imported shipment that
  //    later lands on the same number stays hidden from it).

  function validPassword(pw) {
    return typeof pw === 'string' && pw.length >= MIN_PASSWORD_LENGTH && pw.length <= MAX_PASSWORD_LENGTH;
  }

  router.post('/auth/register', wrap(async (req, res) => {
    if (ipLimited(clientIp(req))) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    const body = req.body || {};
    const phoneNumber = parsePhone(body);
    if (!phoneNumber) {
      return res.status(400).json({ error: "That phone number doesn't look right. Please check it and try again.", field: 'phone' });
    }
    const name = cleanString(body.name, 80);
    if (!name || name.length < 2 || /^\+?\d[\d\s-]+$/.test(name)) {
      return res.status(400).json({ error: 'Please enter your name.', field: 'name' });
    }
    if (!validPassword(body.password)) {
      return res.status(400).json({ error: `Please choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`, field: 'password' });
    }
    // Email is how customers sign in and reset a forgotten password.
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) return res.status(400).json({ error: 'Please enter your email — you will use it to sign in.', field: 'email' });
    if (email.length > 120 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "That email address doesn't look right.", field: 'email' });
    }

    if (body.privacyAccepted !== true) {
      return res.status(400).json({ error: 'Please tick that you agree to the Privacy Policy.', field: 'privacyAccepted' });
    }
    const existing = await customers().findOne({ phoneNumber }, { projection: { passwordHash: 1, email: 1, name: 1 } });
    if (existing && existing.passwordHash) {
      return res.status(409).json({ error: 'This number already has an account. Please sign in instead.', reason: 'has_account' });
    }
    if (existing) {
      // A number we already know (an earlier shipment or WhatsApp). The
      // account opens only once they prove it's theirs: when the email
      // they typed is the one we have for this number, we email a confirm
      // link to it — nothing changes until that link is used.
      const sameEmail = existing.email && String(existing.email).toLowerCase() === email;
      if (!sameEmail || await emailTakenByOtherAccount(email, existing._id)) {
        return res.status(409).json({
          error: "We already have this number from an earlier shipment or WhatsApp. To protect your details, please use the email you gave us before — we'll send you a link to confirm. Don't have it? Say \"Hi\" to us on WhatsApp for your personal link, or call us on 0434 842 023.",
          reason: 'known_number'
        });
      }
      const token = crypto.randomBytes(32).toString('base64url');
      const now = new Date();
      await customers().updateOne({ _id: existing._id }, {
        $set: {
          pendingSignup: {
            hash: hashToken(token),
            expiresAt: new Date(now.getTime() + SIGNUP_CONFIRM_TTL_MS),
            passwordHash: hashPassword(body.password),
            name,
            preferredLanguage: LANGUAGES.includes(body.preferredLanguage) ? body.preferredLanguage : 'en',
            source: ACQUISITION_SOURCES.includes(body.source) ? body.source : 'website',
            requestedAt: now
          }
        }
      });
      const link = `${PORTAL_SITE_URL}/account.html#/confirm/${token}`;
      const first = (hasRealName(existing) ? existing.name : name).split(' ')[0].replace(/[<>&"]/g, '');
      await sendCustomerEmail({
        to: email,
        subject: 'Confirm your My Transco account',
        html: `<p>Hi ${first},</p>` +
          `<p>Tap the button below to finish opening your My Transco account. You'll be signed in with the password you just chose, and see your earlier shipments with us.</p>` +
          `<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#0c7d6b;color:#fff;font-weight:700;text-decoration:none">Confirm my account</a></p>` +
          `<p style="color:#6b7480;font-size:13px">The link works for 24 hours and can be used once. If you didn't ask for this, you can ignore this email — nothing will change.<br>Transco Cargo Sydney · 0434 842 023</p>`
      });
      return res.status(202).json({ confirmEmailSent: true, email });
    }
    if (email && await emailTakenByOtherAccount(email)) {
      return res.status(409).json({
        error: 'This email is already used by another My Transco account. Please sign in, or use a different email.',
        reason: 'email_taken',
        field: 'email'
      });
    }

    const now = new Date();
    const source = ACQUISITION_SOURCES.includes(body.source) ? body.source : 'website';
    const lang = LANGUAGES.includes(body.preferredLanguage) ? body.preferredLanguage : 'en';
    const doc = {
      phoneNumber,
      name,
      mode: 'CHATBOT',
      status: 'ACTIVE',
      createdAt: now,
      sources: ['portal'],
      passwordHash: hashPassword(body.password),
      phoneVerified: false,
      ...(email ? { email } : {}),
      preferredLanguage: lang,
      portalJoinedAt: now,
      acquisitionSource: source,
      lastPortalLoginAt: now,
      privacyAcceptedAt: now,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION
    };
    let customer;
    try {
      const { insertedId } = await customers().insertOne(doc);
      customer = { ...doc, _id: insertedId };
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ error: 'This number already has an account. Please sign in instead.', reason: 'has_account' });
      }
      throw err;
    }
    await tools.ensureCustomerCode(customer);

    res.status(201).json({
      token: customerAuth.signCustomerToken(customer),
      profile: tools.publicProfile(customer),
      needsName: false
    });
  }));

  router.post('/auth/login', wrap(async (req, res) => {
    if (ipLimited(clientIp(req))) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    const body = req.body || {};
    const password = typeof body.password === 'string' ? body.password : '';
    // Sign in with the mobile number OR the email on the account (for a
    // customer whose number has changed). Says plainly when there's no
    // account (→ sign up) or no password yet (→ WhatsApp code) — sign-up
    // already reveals whether a number has an account, so hiding it here
    // only confused customers.
    const byEmail = typeof body.email === 'string' && body.email.trim() !== '';
    const failure = byEmail ? 'That email or password is not right.' : 'That phone number or password is not right.';
    const noAccount = {
      error: byEmail ? "We couldn't find an account with that email. Don't have an account? Sign up." : "We couldn't find an account for that number. Don't have an account? Sign up.",
      reason: 'no_account'
    };
    const noPassword = {
      error: 'This account has no password yet. Tap "Forgot password?" to set one by email, or call us on 0434 842 023.',
      reason: 'no_password'
    };
    let customer = null;
    if (byEmail) {
      const email = body.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email) || !password) return res.status(401).json({ error: failure });
      const matches = await customers().find({ email, passwordHash: { $exists: true } }).limit(2).toArray();
      // Two password accounts sharing an email shouldn't exist (it's
      // checked on every save); if it ever happens, refuse rather than
      // guess which one they meant.
      if (matches.length > 1) {
        return res.status(409).json({ error: 'Please sign in with your mobile number instead, or call us on 0434 842 023.' });
      }
      customer = matches[0] || null;
    } else {
      const phoneNumber = parsePhone(body);
      if (!phoneNumber || !password) return res.status(401).json({ error: failure });
      customer = await customers().findOne({ phoneNumber });
    }
    if (customer && customer.portalLockedUntil && customer.portalLockedUntil > new Date()) {
      return res.status(429).json({ error: 'Too many incorrect tries. Please wait 15 minutes, or tap "Forgot password?" to reset it by email.' });
    }
    if (!customer) return res.status(401).json(noAccount);
    if (!customer.passwordHash) return res.status(401).json(noPassword);
    if (!verifyPassword(password, customer.passwordHash)) {
      const failures = (customer.portalLoginFailures || 0) + 1;
      const set = { portalLoginFailures: failures >= LOGIN_MAX_FAILURES ? 0 : failures };
      if (failures >= LOGIN_MAX_FAILURES) set.portalLockedUntil = new Date(Date.now() + LOGIN_LOCK_MS);
      await customers().updateOne({ _id: customer._id }, { $set: set });
      return res.status(401).json({ error: failure, reason: 'wrong_password' });
    }

    const updated = await customers().findOneAndUpdate(
      { _id: customer._id },
      { $set: { lastPortalLoginAt: new Date(), portalLoginFailures: 0 }, $unset: { portalLockedUntil: '' } },
      { returnDocument: 'after' }
    );
    await tools.ensureCustomerCode(updated);
    res.json({
      token: customerAuth.signCustomerToken(updated),
      profile: tools.publicProfile(updated),
      needsName: !hasRealName(updated)
    });
  }));

  // ---------- forgot password (email link) ----------

  // Always answers the same way, whether or not the email has an account,
  // so the form can't be used to find out who is a customer.
  router.post('/auth/forgot-password', wrap(async (req, res) => {
    if (ipLimited(clientIp(req))) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    const email = typeof (req.body || {}).email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "That email address doesn't look right.", field: 'email' });
    const matches = await customers().find({
      email, $or: [{ passwordHash: { $exists: true } }, { portalJoinedAt: { $exists: true } }]
    }).limit(2).toArray();
    if (matches.length === 1) {
      const c = matches[0];
      const token = crypto.randomBytes(32).toString('base64url');
      await customers().updateOne({ _id: c._id }, { $set: { passwordReset: { hash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } } });
      const link = `${PORTAL_SITE_URL}/account.html#/reset/${token}`;
      const name = hasRealName(c) ? c.name.split(' ')[0] : 'there';
      await sendCustomerEmail({
        to: email,
        subject: 'Reset your My Transco password',
        html: `<p>Hi ${name.replace(/[<>&"]/g, '')},</p>` +
          `<p>Tap the button below to choose a new password for your My Transco account. The link works for 30 minutes and can be used once.</p>` +
          `<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#0c7d6b;color:#fff;font-weight:700;text-decoration:none">Choose a new password</a></p>` +
          `<p style="color:#6b7480;font-size:13px">If you didn't ask for this, you can ignore this email — your password won't change.<br>Transco Cargo Sydney · 0434 842 023</p>`
      });
    }
    res.json({ sent: true });
  }));

  // Sets the new password from the emailed link and signs them in.
  router.post('/auth/reset-password', wrap(async (req, res) => {
    if (ipLimited(clientIp(req))) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    const body = req.body || {};
    if (!validPassword(body.password)) {
      return res.status(400).json({ error: `Please choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`, field: 'password' });
    }
    const hash = typeof body.token === 'string' && body.token.length >= 20 ? hashToken(body.token) : null;
    const customer = hash ? await customers().findOne({ 'passwordReset.hash': hash }) : null;
    if (!customer || !customer.passwordReset || customer.passwordReset.expiresAt < new Date()) {
      return res.status(400).json({ error: 'This link has expired or was already used. Please ask for a new one.', reason: 'bad_link' });
    }
    const updated = await customers().findOneAndUpdate(
      { _id: customer._id },
      {
        $set: { passwordHash: hashPassword(body.password), passwordUpdatedAt: new Date(), lastPortalLoginAt: new Date(), portalLoginFailures: 0, portalJoinedAt: customer.portalJoinedAt || new Date() },
        $unset: { passwordReset: '', portalLockedUntil: '' },
        // Sign out every other device.
        $inc: { portalTokenVersion: 1 }
      },
      { returnDocument: 'after' }
    );
    await tools.ensureCustomerCode(updated);
    res.json({ token: customerAuth.signCustomerToken(updated), profile: tools.publicProfile(updated), needsName: !hasRealName(updated) });
  }));

  // ---------- confirm a known-number sign-up (#/confirm/<token>) ----------
  //
  // The emailed link went to the address we already had for this number,
  // so using it proves the number is theirs: the account opens with the
  // password they chose, the number counts as verified (their earlier
  // shipments show), and they're signed in. Single use.
  router.post('/auth/confirm-signup', wrap(async (req, res) => {
    if (ipLimited(clientIp(req))) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    const token = (req.body || {}).token;
    const hash = typeof token === 'string' && token.length >= 20 ? hashToken(token) : null;
    const c = hash ? await customers().findOne({ 'pendingSignup.hash': hash }) : null;
    if (!c || !c.pendingSignup || c.pendingSignup.expiresAt < new Date()) {
      return res.status(400).json({ error: 'This link has expired or was already used. Please create your account again to get a new one.', reason: 'bad_link' });
    }
    if (c.passwordHash) {
      await customers().updateOne({ _id: c._id }, { $unset: { pendingSignup: '' } });
      return res.status(409).json({ error: 'This number already has an account. Please sign in instead.', reason: 'has_account' });
    }
    const p = c.pendingSignup;
    const now = new Date();
    const set = {
      passwordHash: p.passwordHash,
      passwordUpdatedAt: now,
      phoneVerified: true,
      phoneVerifiedAt: now,
      lastPortalLoginAt: now,
      privacyAcceptedAt: now,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      preferredLanguage: p.preferredLanguage || 'en'
    };
    if (!hasRealName(c) && p.name) set.name = p.name;
    if (!c.portalJoinedAt) { set.portalJoinedAt = now; set.acquisitionSource = p.source || 'website'; }
    const updated = await customers().findOneAndUpdate(
      { _id: c._id },
      { $set: set, $unset: { pendingSignup: '' }, $addToSet: { sources: 'portal' } },
      { returnDocument: 'after' }
    );
    await tools.ensureCustomerCode(updated);
    res.json({ token: customerAuth.signCustomerToken(updated), profile: tools.publicProfile(updated), needsName: !hasRealName(updated) });
  }));

  // ---------- staff invite link (#/join/<token>) ----------

  async function customerForInvite(token) {
    if (typeof token !== 'string' || token.length < 20) return null;
    const c = await customers().findOne({ 'invite.hash': hashToken(token) });
    return c && c.invite.expiresAt > new Date() ? c : null;
  }

  // What the join page shows: their number (they own it — the link proves
  // it), the name we have, and whether they already have an account.
  router.get('/auth/invite/:token', wrap(async (req, res) => {
    if (ipLimited(clientIp(req))) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    const c = await customerForInvite(req.params.token);
    if (!c) return res.status(404).json({ error: 'This link has expired or was already used.', reason: 'bad_link' });
    // A staff login link signs straight in, password or not.
    res.json({ phoneNumber: c.phoneNumber, name: hasRealName(c) ? c.name : '', email: c.email || '', hasAccount: Boolean(c.passwordHash) || Boolean(c.invite.direct) });
  }));

  // Use the link: an existing account is simply signed in; otherwise the
  // account is created with the email + password they chose. Single use.
  router.post('/auth/invite', wrap(async (req, res) => {
    if (ipLimited(clientIp(req))) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    const body = req.body || {};
    const c = await customerForInvite(body.token);
    if (!c) return res.status(400).json({ error: 'This link has expired or was already used.', reason: 'bad_link' });
    const now = new Date();
    const direct = Boolean(c.invite.direct);
    const set = { lastPortalLoginAt: now, phoneVerified: true, phoneVerifiedAt: c.phoneVerifiedAt || now, portalJoinedAt: c.portalJoinedAt || now };
    if (direct) {
      // Staff login link: no password or forms. It stays usable until it
      // expires (they may open it again from WhatsApp), and the phone stays
      // signed in until they sign out.
      set.lastLoginLinkUseAt = now;
      const updated = await customers().findOneAndUpdate({ _id: c._id }, { $set: set, $inc: { loginLinkUses: 1 } }, { returnDocument: 'after' });
      await tools.ensureCustomerCode(updated);
      return res.json({ token: customerAuth.signCustomerToken(updated, { lifetime: true }), profile: tools.publicProfile(updated), needsName: !hasRealName(updated) });
    }
    if (!c.passwordHash) {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!EMAIL_RE.test(email) || email.length > 120) return res.status(400).json({ error: "That email address doesn't look right.", field: 'email' });
      if (await emailTakenByOtherAccount(email, c._id)) return res.status(409).json({ error: 'This email is already used by another My Transco account.', field: 'email' });
      if (!validPassword(body.password)) return res.status(400).json({ error: `Please choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`, field: 'password' });
      if (body.privacyAccepted !== true) return res.status(400).json({ error: 'Please tick that you agree to the Privacy Policy.', field: 'privacyAccepted' });
      const name = cleanString(body.name, 80);
      Object.assign(set, { email, passwordHash: hashPassword(body.password), privacyAcceptedAt: now, privacyPolicyVersion: PRIVACY_POLICY_VERSION, ...(name && name.length >= 2 ? { name } : {}) });
    }
    const updated = await customers().findOneAndUpdate({ _id: c._id }, { $set: set, $unset: { invite: '' } }, { returnDocument: 'after' });
    await tools.ensureCustomerCode(updated);
    res.json({ token: customerAuth.signCustomerToken(updated), profile: tools.publicProfile(updated), needsName: !hasRealName(updated) });
  }));

  // Everything below requires a signed-in customer.
  router.use(customerAuth.requireCustomer);

  // Set a password (e.g. after signing in with a WhatsApp code) or change
  // it. Changing an existing one needs the current one — or, if they've
  // forgotten it, a WhatsApp code sent to their own number.
  router.put('/me/password', wrap(async (req, res) => {
    const body = req.body || {};
    if (!validPassword(body.newPassword)) {
      return res.status(400).json({ error: `Please choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`, field: 'newPassword' });
    }
    if (req.customer.passwordHash && body.code !== undefined) {
      const otpError = await checkOtp(req.customer.phoneNumber, body.code);
      if (otpError) return res.status(otpError.status).json({ error: otpError.error, field: 'code' });
    } else if (req.customer.passwordHash &&
        !(typeof body.currentPassword === 'string' && verifyPassword(body.currentPassword, req.customer.passwordHash))) {
      return res.status(400).json({ error: 'Your current password is not right.', field: 'currentPassword' });
    }
    await customers().updateOne(
      { _id: req.customer._id },
      { $set: { passwordHash: hashPassword(body.newPassword), passwordUpdatedAt: new Date() } }
    );
    res.json({ success: true });
  }));

  router.post('/auth/logout-all', wrap(async (req, res) => {
    await customers().updateOne({ _id: req.customer._id }, { $inc: { portalTokenVersion: 1 } });
    res.json({ success: true });
  }));

  // ---------- profile ----------

  router.get('/me', wrap(async (req, res) => {
    await tools.ensureCustomerCode(req.customer);
    res.json({ profile: tools.publicProfile(req.customer), needsName: !hasRealName(req.customer) });
  }));

  router.patch('/me', wrap(async (req, res) => {
    const body = req.body || {};
    const parsed = profileUpdateFromBody(body);
    if (parsed.error) return res.status(400).json(parsed);
    const set = parsed.set;
    if (set.email && await emailTakenByOtherAccount(set.email, req.customer._id)) {
      return res.status(409).json({ error: 'This email is already used by another My Transco account.', field: 'email' });
    }

    // Their own Passport/NIC — kept with their sender details (encrypted).
    if ('idNumber' in body) {
      const id = await tools.setOwnIdNumber(req.customer, body.idNumber);
      if (id.error) return res.status(400).json(id);
      if (Object.keys(set).length === 0) {
        const fresh = await customers().findOne({ _id: req.customer._id });
        return res.json({ profile: tools.publicProfile(fresh), needsName: !hasRealName(fresh) });
      }
    }
    if (Object.keys(set).length === 0) {
      return res.status(400).json({ error: 'Nothing to save.' });
    }
    // Keep the default sender (the account holder) in step with the profile.
    const fresh = await customers().findOne({ _id: req.customer._id }, { projection: { senderDetails: 1 } });
    if (fresh && fresh.senderDetails) {
      if (set.name) set['senderDetails.fullName'] = set.name;
      if (set.email) set['senderDetails.email'] = set.email;
      if (set.address && set.address.line1 && set.address.suburb && set.address.state && set.address.postcode) {
        set['senderDetails.address'] = `${set.address.line1}, ${set.address.suburb} ${set.address.state} ${set.address.postcode}`;
      }
    }

    set.profileUpdatedAt = new Date();
    const updated = await customers().findOneAndUpdate(
      { _id: req.customer._id },
      { $set: set },
      { returnDocument: 'after' }
    );
    res.json({ profile: tools.publicProfile(updated), needsName: !hasRealName(updated) });
  }));

  // ---------- saved senders & receivers ----------

  router.get('/me/people', wrap(async (req, res) => {
    res.json(tools.listPeople(req.customer));
  }));
  router.post('/me/people/:kind', wrap(async (req, res) => {
    const r = await tools.savePerson(req.customer, req.params.kind, null, req.body);
    if (r.notFound) return res.status(404).json({ error: 'Not found' });
    if (r.error) return res.status(400).json(r);
    res.status(201).json(r.value);
  }));
  router.put('/me/people/:kind/:id', wrap(async (req, res) => {
    const r = await tools.savePerson(req.customer, req.params.kind, req.params.id, req.body);
    if (r.notFound) return res.status(404).json({ error: 'Not found' });
    if (r.error) return res.status(400).json(r);
    res.json(r.value);
  }));
  router.delete('/me/people/:kind/:id', wrap(async (req, res) => {
    const r = await tools.deletePerson(req.customer, req.params.kind, req.params.id);
    if (r.notFound) return res.status(404).json({ error: 'Not found' });
    res.json(r.value);
  }));

  // ---------- your data (privacy) ----------

  // Download my data: everything we hold for this account, as JSON.
  // Passport/NIC numbers stay masked (call us for the full numbers).
  router.get('/me/export', wrap(async (req, res) => {
    const data = await tools.exportCustomerData(req.customer);
    res.setHeader('Content-Disposition', `attachment; filename="my-transco-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  }));

  // Delete my account: recorded as a request for staff to action (records
  // the law makes us keep — customs declarations, invoices — stay until
  // their retention period ends). Needs the password when there is one.
  router.post('/me/delete-request', wrap(async (req, res) => {
    const body = req.body || {};
    if (req.customer.passwordHash &&
        !(typeof body.password === 'string' && verifyPassword(body.password, req.customer.passwordHash))) {
      return res.status(400).json({ error: 'Your password is not right.', field: 'password' });
    }
    if (req.customer.deletionRequestedAt) return res.json({ requestedAt: req.customer.deletionRequestedAt });
    const now = new Date();
    await customers().updateOne({ _id: req.customer._id }, {
      $set: { deletionRequestedAt: now, deletionReason: cleanString(body.reason, 300) || null }
    });
    res.json({ requestedAt: now });
  }));

  // ---------- dashboard ----------

  router.get('/summary', wrap(async (req, res) => {
    res.json(await tools.getSummary(req.customer._id));
  }));

  // ---------- bookings ----------

  router.get('/booking-options', wrap(async (req, res) => {
    const options = await tools.getBookingOptions();
    res.json({ ...options, declaration: tools.declarationDefaults(req.customer) });
  }));

  router.get('/bookings', wrap(async (req, res) => {
    res.json({ bookings: await tools.getCustomerBookings(req.customer._id) });
  }));

  router.get('/bookings/:bookingId', wrap(async (req, res) => {
    const booking = await tools.getCustomerBooking(req.customer._id, req.params.bookingId);
    if (!booking) return res.status(404).json({ error: "We couldn't find that booking." });
    res.json({ booking });
  }));

  router.post('/bookings', wrap(async (req, res) => {
    const result = await tools.createBooking(req.customer, req.body);
    if (result.error) return res.status(400).json({ error: result.error, field: result.field || null });
    res.status(201).json({ booking: result.booking });
  }));

  // The customer edits their own booking (until boxes arrive / a BL is given).
  router.patch('/bookings/:bookingId', wrap(async (req, res) => {
    const result = await tools.updateOwnBooking(req.customer._id, req.params.bookingId, req.body);
    if (result.notFound) return res.status(404).json({ error: "We couldn't find that booking." });
    if (result.error) return res.status(400).json({ error: result.error, field: result.field || null });
    res.json({ booking: result.booking });
  }));

  router.post('/bookings/:bookingId/cancel', wrap(async (req, res) => {
    const result = await tools.cancelBooking(req.customer._id, req.params.bookingId);
    if (result.notFound) return res.status(404).json({ error: "We couldn't find that booking." });
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ booking: result.booking });
  }));

  // ---------- shipments ----------

  router.get('/shipments', wrap(async (req, res) => {
    res.json({ shipments: await tools.getCustomerShipments(req.customer._id) });
  }));

  router.get('/shipments/:shipmentId', wrap(async (req, res) => {
    const shipment = await tools.getCustomerShipment(req.customer._id, req.params.shipmentId);
    if (!shipment) return res.status(404).json({ error: "We couldn't find that shipment." });
    res.json({ shipment });
  }));

  router.get('/shipments/:shipmentId/tracking', wrap(async (req, res) => {
    const tracking = await tools.getShipmentTracking(req.customer._id, req.params.shipmentId);
    if (!tracking) return res.status(404).json({ error: "We couldn't find that shipment." });
    res.json(tracking);
  }));

  // ---------- documents ----------

  router.get('/documents', wrap(async (req, res) => {
    res.json(await tools.getCustomerDocuments(req.customer._id));
  }));

  // Customer-safe error envelope for anything unexpected.
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    console.error('Portal error:', err.message);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return router;
};

module.exports.profileUpdateFromBody = profileUpdateFromBody;
module.exports.emailTakenByOtherAccount = emailTakenByOtherAccount;
