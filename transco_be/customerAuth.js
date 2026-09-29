// ============================================================
// CUSTOMER (portal) AUTHENTICATION
// ============================================================
//
// Deliberately separate from staff auth in server.js. Customer tokens
// are signed with a key DERIVED from SESSION_SECRET for this one purpose
// ("customer-portal-v1"), not with SESSION_SECRET itself — so a customer
// token can never pass the staff requireAuth check (different key, the
// signature simply won't verify), and a staff token can never pass
// requireCustomer below. No shared "role" field for anyone to tamper
// with; the two token types are cryptographically disjoint.
//
// Passwordless: phone number -> 6-digit code sent over WhatsApp (the
// channel every Transco customer already uses) -> signed session token.
// The token only ever carries the customer's _id; everything else is
// re-read from the database on each request, so an edited profile or a
// revoked session (portalTokenVersion bump on "sign out everywhere")
// takes effect immediately.

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { customers } = require('./db');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — returning customers stay signed in
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function createCustomerAuth(sessionSecret) {
  const tokenKey = crypto.createHmac('sha256', sessionSecret).update('customer-portal-v1').digest();
  const otpKey = crypto.createHmac('sha256', sessionSecret).update('customer-otp-v1').digest();

  function signCustomerToken(customer) {
    const payload = {
      typ: 'customer',
      sub: String(customer._id),
      ver: customer.portalTokenVersion || 0,
      exp: Date.now() + TOKEN_TTL_MS
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', tokenKey).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  function verifyCustomerToken(token) {
    if (!token || typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;

    const expected = crypto.createHmac('sha256', tokenKey).update(body).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (payload.typ !== 'customer' || !payload.sub || !ObjectId.isValid(payload.sub)) return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  }

  function bearerToken(req) {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7) : null;
  }

  // Resolves the signed-in customer from the request, or null. Never
  // throws — callers decide whether "not signed in" is an error (portal
  // routes) or just the public experience (web chat).
  async function customerFromRequest(req) {
    const payload = verifyCustomerToken(bearerToken(req));
    if (!payload) return null;
    const customer = await customers().findOne({ _id: new ObjectId(payload.sub) });
    if (!customer) return null;
    if ((customer.portalTokenVersion || 0) !== payload.ver) return null;
    return customer;
  }

  async function requireCustomer(req, res, next) {
    try {
      const customer = await customerFromRequest(req);
      if (!customer) {
        return res.status(401).json({ error: 'Please sign in again.' });
      }
      req.customer = customer;
      next();
    } catch (err) {
      next(err);
    }
  }

  function generateOtp() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  }

  // Bound to the phone number, so a code issued for one number can
  // never be replayed against another.
  function hashOtp(phoneNumber, code) {
    return crypto.createHmac('sha256', otpKey).update(`${phoneNumber}:${code}`).digest('hex');
  }

  function otpMatches(phoneNumber, code, storedHash) {
    const a = Buffer.from(hashOtp(phoneNumber, code));
    const b = Buffer.from(storedHash || '');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  return {
    signCustomerToken,
    verifyCustomerToken,
    customerFromRequest,
    requireCustomer,
    generateOtp,
    hashOtp,
    otpMatches
  };
}

module.exports = { createCustomerAuth, OTP_TTL_MS, OTP_MAX_ATTEMPTS };
