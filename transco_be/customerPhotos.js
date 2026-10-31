// Photos customers send in chat (WhatsApp or the website widget), and
// WhatsApp voice notes (kept so staff can play the original — the bot
// only reads the transcription).
//
// Private: stored on the volume outside the public /uploads folder and
// served only at /api/messages/photo/<file>, which needs a staff login
// (Conversations page access). The console fetches them with the staff
// token. The message keeps the relative path in mediaUrl.
//
// Kept for KEEP_DAYS, then the file is deleted and the message shows
// "photo deleted" (customers sometimes send passports or documents).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { messages } = require('./db');

const DIR = process.env.CUSTOMER_PHOTO_DIR || '/data/customer-photos';
const KEEP_DAYS = 90;
const MAX_BYTES = 6 * 1024 * 1024;
const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
// WhatsApp voice notes are audio/ogg (opus); other phones may send these.
const VOICE_TYPES = { 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/amr': '.amr' };
const VOICE_MAX_BYTES = 16 * 1024 * 1024;
const FILE_RE = /^[a-f0-9]{32}\.(jpg|png|webp|ogg|mp3|m4a|aac|amr)$/;
const URL_PREFIX = '/api/messages/photo/';

fs.mkdirSync(DIR, { recursive: true });

const isPhotoType = mimeType => Object.prototype.hasOwnProperty.call(TYPES, String(mimeType || '').toLowerCase());

// Saves the photo; returns the fields for saveMessage.
async function save(buffer, mimeType) {
  const type = String(mimeType || '').toLowerCase();
  if (!isPhotoType(type)) throw new Error(`Not a supported photo type: ${mimeType}`);
  if (!buffer || !buffer.length || buffer.length > MAX_BYTES) throw new Error('Photo is empty or too large');
  const file = crypto.randomBytes(16).toString('hex') + TYPES[type];
  await fs.promises.writeFile(path.join(DIR, file), buffer);
  return { mediaUrl: URL_PREFIX + file, mediaType: 'image' };
}

// A voice note, same privacy and 90 days as photos.
async function saveVoice(buffer, mimeType) {
  const type = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (!Object.prototype.hasOwnProperty.call(VOICE_TYPES, type)) throw new Error(`Not a supported voice type: ${mimeType}`);
  if (!buffer || !buffer.length || buffer.length > VOICE_MAX_BYTES) throw new Error('Voice note is empty or too large');
  const file = crypto.randomBytes(16).toString('hex') + VOICE_TYPES[type];
  await fs.promises.writeFile(path.join(DIR, file), buffer);
  return { mediaUrl: URL_PREFIX + file, mediaType: 'audio' };
}

function router() {
  const r = express.Router();
  r.get('/photo/:file', (req, res) => {
    const file = req.params.file;
    if (!FILE_RE.test(file)) return res.status(404).json({ error: 'Photo not found' });
    const full = path.join(DIR, file);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Photo not found (it may have been deleted after 90 days)' });
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(full);
  });
  return r;
}

async function cleanup() {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  try {
    for (const file of await fs.promises.readdir(DIR)) {
      if (!FILE_RE.test(file)) continue;
      const full = path.join(DIR, file);
      const st = await fs.promises.stat(full);
      if (st.mtimeMs < cutoff) { await fs.promises.unlink(full); removed++; }
    }
    const old = { mediaUrl: { $regex: '^' + URL_PREFIX.replace(/\//g, '\\/') }, createdAt: { $lt: new Date(cutoff) } };
    await messages().updateMany({ ...old, mediaType: 'audio' }, { $set: { mediaUrl: null, mediaType: null, voiceDeleted: true } });
    await messages().updateMany(old, { $set: { mediaUrl: null, mediaType: null, photoDeleted: true } });
    if (removed) console.log(`Customer photos: deleted ${removed} older than ${KEEP_DAYS} days`);
  } catch (err) {
    console.error('Customer photo cleanup failed:', err.message);
  }
}

// Once shortly after start, then daily.
function startCleanup() {
  setTimeout(cleanup, 60 * 1000).unref();
  setInterval(cleanup, 24 * 60 * 60 * 1000).unref();
}

module.exports = { save, saveVoice, router, startCleanup, isPhotoType, MAX_BYTES, KEEP_DAYS };
