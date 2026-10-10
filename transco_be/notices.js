// Website notices (console → Notices): closures ("We're closed 24 Dec –
// 2 Jan") and offers ("10% off Tea Chests this month"), scheduled ahead
// with a start and end, shown as a banner at the top of every website
// page — optionally with a seasonal animation (snow, fireworks …).
//
// A closure can also pause the chat bot (WhatsApp + website) with its own
// message, and block drop-off days in its date range on the booking form.

const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('./db');

const KINDS = ['closure', 'offer', 'info'];
const THEMES = ['none', 'christmas', 'newyear', 'avurudu', 'vesak', 'deepavali', 'ramadan', 'offer', 'celebration'];
const MAX_TEXT = 400;

const notices = () => getDb().collection('notices');

function cleanText(v, max) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function validate(body) {
  const b = body || {};
  if (!KINDS.includes(b.kind)) return { error: 'Choose what this notice is: closure, offer or info.' };
  const message = { en: cleanText(b.message && b.message.en, MAX_TEXT), si: cleanText(b.message && b.message.si, MAX_TEXT), ta: cleanText(b.message && b.message.ta, MAX_TEXT) };
  if (message.en.length < 5) return { error: 'Write the message in English (at least a few words).' };
  const startsAt = new Date(b.startsAt), endsAt = new Date(b.endsAt);
  if (isNaN(startsAt) || isNaN(endsAt)) return { error: 'Choose when the notice starts and ends.' };
  if (endsAt <= startsAt) return { error: 'The end must be after the start.' };
  const theme = THEMES.includes(b.theme) ? b.theme : 'none';
  const linkLabel = cleanText(b.link && b.link.label, 40), linkUrl = cleanText(b.link && b.link.url, 300);
  if (linkUrl && !/^(https?:\/\/|\/|#|tel:|mailto:)/i.test(linkUrl)) return { error: 'The button link must start with https://, / or tel:.' };
  const closure = b.kind === 'closure';
  return {
    value: {
      kind: b.kind,
      title: cleanText(b.title, 80),
      message,
      theme,
      startsAt, endsAt,
      enabled: b.enabled !== false,
      link: linkLabel && linkUrl ? { label: linkLabel, url: linkUrl } : null,
      // Closures only: pause the bot with this message, and block drop-off days.
      pauseBot: closure && b.pauseBot === true,
      blockDates: closure && b.blockDates === true,
      // Offers/info can be closed by the customer; closures always show.
      dismissible: !closure
    }
  };
}

function publicShape(n) {
  return {
    id: String(n._id), kind: n.kind, title: n.title || '', message: n.message, theme: n.theme || 'none',
    link: n.link || null, dismissible: n.dismissible !== false, endsAt: n.endsAt
  };
}

async function activeNotices(now = new Date()) {
  return notices().find({ enabled: true, startsAt: { $lte: now }, endsAt: { $gt: now } }).sort({ kind: 1, startsAt: 1 }).toArray();
}

// The closure pausing the bot right now (if any).
async function activeBotClosure(now = new Date()) {
  return notices().findOne({ enabled: true, kind: 'closure', pauseBot: true, startsAt: { $lte: now }, endsAt: { $gt: now } });
}

// The bot's reply during a closure: the notice in all three languages.
function closureBotMessage(n) {
  return [n.message.en, n.message.si, n.message.ta].filter(Boolean).join('\n\n');
}

// Sydney dates (YYYY-MM-DD) blocked by closures, overlapping [fromISO, toISO].
// A day is blocked if any part of it falls inside a closure.
async function blockedDates(fromISO, toISO) {
  const from = new Date(fromISO + 'T00:00:00+10:00'), to = new Date(toISO + 'T23:59:59+11:00');
  const list = await notices().find({ enabled: true, kind: 'closure', blockDates: true, startsAt: { $lt: to }, endsAt: { $gt: from } }).toArray();
  const blocked = new Set();
  for (const n of list) {
    // Walk the Sydney calendar days the closure touches.
    const fmt = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    for (let t = n.startsAt.getTime(); t < n.endsAt.getTime(); t += 3600 * 1000) blocked.add(fmt(new Date(t)));
    blocked.add(fmt(new Date(n.endsAt.getTime() - 1)));
  }
  return blocked;
}

function createNoticeRouters() {
  const publicRouter = express.Router();
  // What the website shows now (cached briefly by browsers).
  publicRouter.get('/notices', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=60');
      res.json({ notices: (await activeNotices()).map(publicShape) });
    } catch (err) { next(err); }
  });

  const staffRouter = express.Router();
  staffRouter.get('/', async (req, res, next) => {
    try {
      const list = await notices().find({}).sort({ startsAt: -1 }).limit(200).toArray();
      res.json({ notices: list.map(n => ({ ...n, id: String(n._id) })), kinds: KINDS, themes: THEMES });
    } catch (err) { next(err); }
  });
  staffRouter.post('/', async (req, res, next) => {
    try {
      const v = validate(req.body);
      if (v.error) return res.status(400).json(v);
      const doc = { ...v.value, createdAt: new Date(), createdBy: (req.user && req.user.email) || null };
      const { insertedId } = await notices().insertOne(doc);
      res.status(201).json({ notice: { ...doc, _id: insertedId, id: String(insertedId) } });
    } catch (err) { next(err); }
  });
  staffRouter.put('/:id', async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Notice not found' });
      const v = validate(req.body);
      if (v.error) return res.status(400).json(v);
      const r = await notices().findOneAndUpdate(
        { _id: new ObjectId(req.params.id) },
        { $set: { ...v.value, updatedAt: new Date(), updatedBy: (req.user && req.user.email) || null } },
        { returnDocument: 'after' }
      );
      if (!r) return res.status(404).json({ error: 'Notice not found' });
      res.json({ notice: { ...r, id: String(r._id) } });
    } catch (err) { next(err); }
  });
  staffRouter.delete('/:id', async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Notice not found' });
      const r = await notices().deleteOne({ _id: new ObjectId(req.params.id) });
      if (!r.deletedCount) return res.status(404).json({ error: 'Notice not found' });
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  return { publicRouter, staffRouter };
}

module.exports = { createNoticeRouters, activeNotices, activeBotClosure, closureBotMessage, blockedDates, validate, THEMES, KINDS };
