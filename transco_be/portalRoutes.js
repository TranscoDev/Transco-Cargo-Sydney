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

const express = require('express');
const { customers, customerOtps } = require('./db');
const { normalizePhoneNumber } = require('./normalizePhone');
const { OTP_TTL_MS, OTP_MAX_ATTEMPTS } = require('./customerAuth');
const { hasRealName } = require('./customerTools');

const ALLOWED_COUNTRY_CODES = ['61', '94', '91'];
const ACQUISITION_SOURCES = ['warehouse_qr', 'website', 'direct'];
const LANGUAGES = ['en', 'si', 'ta'];
const CONTACT_PREFERENCES = ['whatsapp', 'phone', 'email'];
const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const MIN_PASSWORD_LENGTH = 8;
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

module.exports = function createPortalRouter({ customerAuth, tools, sendOtpMessage, hashPassword, verifyPassword }) {
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

  // ---------- sign in ----------

  router.post('/auth/request-code', wrap(async (req, res) => {
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
    if (ipLimited(clientIp(req))) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }

    const phoneNumber = parsePhone(req.body);
    const code = String((req.body && req.body.code) || '').replace(/\D/g, '');
    if (!phoneNumber || code.length !== 6) {
      return res.status(400).json({ error: 'Please enter the 6-digit code we sent you.' });
    }

    const otp = await customerOtps().findOne(
      { phoneNumber, expiresAt: { $gt: new Date() } },
      { sort: { createdAt: -1 } }
    );
    if (!otp) {
      return res.status(400).json({ error: 'That code has expired. Please ask for a new one.' });
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many incorrect tries. Please ask for a new code.' });
    }
    if (!customerAuth.otpMatches(phoneNumber, code, otp.codeHash)) {
      await customerOtps().updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
      const left = OTP_MAX_ATTEMPTS - otp.attempts - 1;
      return res.status(400).json({
        error: left > 0 ? `That code isn't right. You have ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many incorrect tries. Please ask for a new code.'
      });
    }

    // Single use — every outstanding code for this number is spent.
    await customerOtps().deleteMany({ phoneNumber });

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
    // Optional, but recommended: lets them sign in even after changing
    // their phone number.
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email && (email.length > 120 || !EMAIL_RE.test(email))) {
      return res.status(400).json({ error: "That email address doesn't look right.", field: 'email' });
    }

    const existing = await customers().findOne({ phoneNumber }, { projection: { passwordHash: 1 } });
    if (existing) {
      return res.status(409).json({
        error: existing.passwordHash
          ? 'This number already has an account. Please sign in instead.'
          : "We already have this number on file from WhatsApp or an earlier shipment. To protect your details, please sign in with a WhatsApp code instead — or call us on 0434 842 023 and we'll set up a password for you.",
        reason: existing.passwordHash ? 'has_account' : 'known_number'
      });
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
      lastPortalLoginAt: now
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
    // customer whose number has changed). One message for every failure,
    // so this can't be used to find out which numbers/emails have accounts.
    const byEmail = typeof body.email === 'string' && body.email.trim() !== '';
    const failure = byEmail ? 'That email or password is not right.' : 'That phone number or password is not right.';
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
      return res.status(429).json({ error: 'Too many incorrect tries. Please wait 15 minutes, or sign in with a WhatsApp code.' });
    }
    if (!customer || !customer.passwordHash || !verifyPassword(password, customer.passwordHash)) {
      if (customer) {
        const failures = (customer.portalLoginFailures || 0) + 1;
        const set = { portalLoginFailures: failures >= LOGIN_MAX_FAILURES ? 0 : failures };
        if (failures >= LOGIN_MAX_FAILURES) set.portalLockedUntil = new Date(Date.now() + LOGIN_LOCK_MS);
        await customers().updateOne({ _id: customer._id }, { $set: set });
      }
      return res.status(401).json({ error: failure });
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

  // Everything below requires a signed-in customer.
  router.use(customerAuth.requireCustomer);

  // Set a password (e.g. after signing in with a WhatsApp code) or change
  // it. Changing an existing one needs the current one.
  router.put('/me/password', wrap(async (req, res) => {
    const body = req.body || {};
    if (!validPassword(body.newPassword)) {
      return res.status(400).json({ error: `Please choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`, field: 'newPassword' });
    }
    if (req.customer.passwordHash &&
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

    if (Object.keys(set).length === 0) {
      return res.status(400).json({ error: 'Nothing to save.' });
    }

    set.profileUpdatedAt = new Date();
    const updated = await customers().findOneAndUpdate(
      { _id: req.customer._id },
      { $set: set },
      { returnDocument: 'after' }
    );
    res.json({ profile: tools.publicProfile(updated), needsName: !hasRealName(updated) });
  }));

  // ---------- dashboard ----------

  router.get('/summary', wrap(async (req, res) => {
    res.json(await tools.getSummary(req.customer._id));
  }));

  // ---------- bookings ----------

  router.get('/booking-options', wrap(async (req, res) => {
    res.json(await tools.getBookingOptions());
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
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json({ booking: result.booking });
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
