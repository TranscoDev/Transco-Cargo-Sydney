// ============================================================
// SHIPPING CALENDAR — cutoff dates with sea + air arrival dates
// ============================================================
//
// One entry = one cutoff (the last day to hand boxes over in Sydney) for
// a destination country, with the estimated arrival for sea freight and
// for air freight from that cutoff. Either arrival may be left empty
// ("to be confirmed").
//
// Dates live in the database, not in the website's code, so each
// business running this platform keeps its own schedule up to date from
// the staff console (Operations → Shipping calendar) — no developer or
// redeploy needed.
//
//   GET    /api/public/schedule?country=sri_lanka   website (no sign-in): upcoming cutoffs only
//   GET    /api/schedule?country=sri_lanka          staff: upcoming + recent past
//   POST   /api/schedule                            staff: add
//   PATCH  /api/schedule/:id                        staff: change
//   DELETE /api/schedule/:id                        staff: remove

const express = require('express');
const { ObjectId } = require('mongodb');
const { shippingSchedule } = require('./db');

const COUNTRIES = { sri_lanka: 'Sri Lanka', india: 'India' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_LIMIT = 8;
const STAFF_PAST_DAYS = 60;

function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function shape(doc) {
  return {
    id: String(doc._id),
    country: doc.country,
    cutoff: doc.cutoff,
    seaArrival: doc.seaArrival || null,
    airArrival: doc.airArrival || null,
    note: doc.note || null,
    updatedAt: doc.updatedAt || doc.createdAt || null,
    updatedBy: doc.updatedBy || null
  };
}

// Validates a full entry (create) or the fields sent (update, `partial`).
// Returns { error, field } or { value }.
function validate(body, { partial = false, existing = null } = {}) {
  const input = body || {};
  const value = {};

  if (!partial || 'country' in input) {
    if (!COUNTRIES[input.country]) return { error: 'Choose Sri Lanka or India.', field: 'country' };
    value.country = input.country;
  }
  if (!partial || 'cutoff' in input) {
    if (!isRealDate(input.cutoff)) return { error: 'Enter the cutoff date.', field: 'cutoff' };
    value.cutoff = input.cutoff;
  }
  for (const key of ['seaArrival', 'airArrival']) {
    if (!partial || key in input) {
      const v = input[key];
      if (v === null || v === undefined || v === '') value[key] = null;
      else if (!isRealDate(v)) return { error: 'That arrival date isn\'t a real date.', field: key };
      else value[key] = v;
    }
  }
  if (!partial || 'note' in input) {
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 120) : '';
    value.note = note || null;
  }

  // India is sea freight only — never store an air date for it.
  if ((value.country ?? (existing && existing.country)) === 'india' && (!partial || 'airArrival' in value)) {
    value.airArrival = null;
  }

  // Arrival can't be before the cutoff it belongs to.
  const cutoff = value.cutoff ?? (existing && existing.cutoff);
  for (const key of ['seaArrival', 'airArrival']) {
    const arrival = key in value ? value[key] : existing && existing[key];
    if (arrival && cutoff && arrival < cutoff) {
      return { error: `The ${key === 'seaArrival' ? 'sea' : 'air'} arrival can't be before the cutoff date.`, field: key };
    }
  }
  return { value };
}

module.exports = function createScheduleRouters({ getSydneyNow }) {
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function sydneyToday() {
    const now = getSydneyNow();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  }

  function daysBefore(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }

  const errorHandler = (label) =>
    // eslint-disable-next-line no-unused-vars
    (err, req, res, next) => {
      console.error(`${label} error:`, err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    };

  // ---------- public (website) ----------
  const publicRouter = express.Router();
  publicRouter.get('/schedule', wrap(async (req, res) => {
    const country = req.query.country;
    if (!COUNTRIES[country]) return res.status(400).json({ error: 'Unknown country' });
    const docs = await shippingSchedule()
      .find({ country, cutoff: { $gte: sydneyToday() } })
      .sort({ cutoff: 1 })
      .limit(PUBLIC_LIMIT)
      .toArray();
    // Short cache: dates change rarely, and a staff edit shows within a minute.
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      country,
      dates: docs.map(d => ({ cutoff: d.cutoff, seaArrival: d.seaArrival || null, airArrival: d.airArrival || null, note: d.note || null }))
    });
  }));
  publicRouter.use(errorHandler('Public schedule'));

  // ---------- staff (console) ----------
  const staffRouter = express.Router();

  staffRouter.get('/', wrap(async (req, res) => {
    const country = req.query.country;
    if (!COUNTRIES[country]) return res.status(400).json({ error: 'Unknown country' });
    const today = sydneyToday();
    const docs = await shippingSchedule()
      .find({ country, cutoff: { $gte: daysBefore(today, STAFF_PAST_DAYS) } })
      .sort({ cutoff: 1 })
      .toArray();
    res.json({ country, today, countries: COUNTRIES, dates: docs.map(shape) });
  }));

  staffRouter.post('/', wrap(async (req, res) => {
    const { error, field, value } = validate(req.body);
    if (error) return res.status(400).json({ error, field });
    const clash = await shippingSchedule().findOne({ country: value.country, cutoff: value.cutoff });
    if (clash) return res.status(409).json({ error: 'There is already an entry for that cutoff date — edit it instead.', field: 'cutoff' });
    const now = new Date();
    const doc = { ...value, createdAt: now, updatedAt: now, updatedBy: (req.user && req.user.email) || 'staff' };
    const { insertedId } = await shippingSchedule().insertOne(doc);
    res.status(201).json({ date: shape({ ...doc, _id: insertedId }) });
  }));

  staffRouter.patch('/:id', wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const _id = new ObjectId(req.params.id);
    const existing = await shippingSchedule().findOne({ _id });
    if (!existing) return res.status(404).json({ error: 'That date was not found — it may have been deleted.' });
    const { error, field, value } = validate(req.body, { partial: true, existing });
    if (error) return res.status(400).json({ error, field });
    if (value.cutoff && value.cutoff !== existing.cutoff) {
      const clash = await shippingSchedule().findOne({ country: value.country || existing.country, cutoff: value.cutoff, _id: { $ne: _id } });
      if (clash) return res.status(409).json({ error: 'There is already an entry for that cutoff date.', field: 'cutoff' });
    }
    const set = { ...value, updatedAt: new Date(), updatedBy: (req.user && req.user.email) || 'staff' };
    await shippingSchedule().updateOne({ _id }, { $set: set });
    res.json({ date: shape({ ...existing, ...set }) });
  }));

  staffRouter.delete('/:id', wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const result = await shippingSchedule().deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ error: 'That date was not found.' });
    res.status(204).send();
  }));

  staffRouter.use(errorHandler('Schedule'));

  return { publicRouter, staffRouter };
};

module.exports.COUNTRIES = COUNTRIES;
