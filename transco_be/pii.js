// Passport / NIC numbers are encrypted in the database (AES-256-GCM).
//
// Key: PII_KEY — 32 bytes as base64 (or 64 hex characters). Keep it safe:
// without it the stored numbers can't be read back. With no PII_KEY set,
// numbers are stored as before (plain) and a warning is logged, so a
// deploy without the key never loses data.
//
// Stored form: "enc1:" + base64(iv | tag | ciphertext). open() returns
// plain values unchanged, so older (unencrypted) records keep working and
// seal() of an already-sealed value is a no-op.

const crypto = require('crypto');

const PREFIX = 'enc1:';
let key = null;
const raw = process.env.PII_KEY || '';
if (raw) {
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('PII_KEY must be 32 bytes (base64 or 64 hex characters).');
  key = buf;
} else {
  console.warn('[pii] PII_KEY is not set — passport/NIC numbers are stored unencrypted.');
}

function isSealed(v) { return typeof v === 'string' && v.startsWith(PREFIX); }

function seal(value) {
  if (!key || typeof value !== 'string' || !value || isSealed(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function open(value) {
  if (!isSealed(value)) return value;
  if (!key) return null; // sealed but no key: never show the cipher text
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[pii] could not decrypt a stored value:', e.message);
    return null;
  }
}

// "N1234567" → "N••••567": what customers see of their own numbers.
const MASK = '•';
function mask(value) {
  const v = open(value);
  if (!v) return v || '';
  return v.length <= 4 ? MASK.repeat(v.length) : v[0] + MASK.repeat(Math.max(3, v.length - 4)) + v.slice(-3);
}
function isMasked(v) { return typeof v === 'string' && v.includes(MASK); }

// A person on a declaration ({ fullName, …, idNumber }).
function sealPerson(p) { return p && p.idNumber ? { ...p, idNumber: seal(p.idNumber) } : p; }
function openPerson(p) { return p && p.idNumber ? { ...p, idNumber: open(p.idNumber) || '' } : p; }
function maskPerson(p) { return p && p.idNumber ? { ...p, idNumber: mask(p.idNumber) } : p; }
function hasId(p) { return Boolean(p && p.idNumber); }

module.exports = { seal, open, mask, isMasked, isSealed, sealPerson, openPerson, maskPerson, hasId, enabled: () => Boolean(key) };
