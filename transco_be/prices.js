// Prices & promotions (console → Prices & Promotions): the prices the chat
// bot's calculator quotes with, and the promotions it applies. Only admins
// can change them; every save keeps the previous version so it can be put
// back.
//
// The defaults are exactly the prices built into the Flowise tool
// (calculate_price) — it falls back to its own copy if this can't be read,
// so change both together.
//
// Promotions: "free_third" is the Tea Chest bundle (every 3rd Tea Chest's
// freight free, Sea Freight to Sri Lanka) — it shapes the price table.
// Every other type shows as a discount line under the quote's total; only
// the single best promotion applies to an order.

const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('./db');

const DOC_ID = 'current';
const HISTORY_KEEP = 50;

const PRICES = [
  { key: 'wine_box', group: 'Sea freight — boxes (Wattala pickup)', label: 'Wine Box', default: 30 },
  { key: 'gift_box', group: 'Sea freight — boxes (Wattala pickup)', label: 'Gift Box', default: 45 },
  { key: 'tea_chest', group: 'Sea freight — boxes (Wattala pickup)', label: 'Tea Chest', default: 75 },
  { key: 'quarter_cbm', group: 'Sea freight — boxes (Wattala pickup)', label: 'Quarter CBM', default: 150 },
  { key: 'bicycle', group: 'Sea freight — boxes (Wattala pickup)', label: 'Bicycle', default: 280 },
  { key: 'cbm', group: 'Sea freight — boxes (Wattala pickup)', label: 'Odd-size / custom cargo, per CBM', default: 600 },
  { key: 'z1_first', group: 'Door delivery in Sri Lanka (per order)', label: 'Zone 1 (up to 20 km) — first box', default: 50 },
  { key: 'z1_extra', group: 'Door delivery in Sri Lanka (per order)', label: 'Zone 1 — each extra box', default: 25 },
  { key: 'z2_first', group: 'Door delivery in Sri Lanka (per order)', label: 'Zone 2 (21–100 km) — first box', default: 70 },
  { key: 'z2_extra', group: 'Door delivery in Sri Lanka (per order)', label: 'Zone 2 — each extra box', default: 35 },
  { key: 'z3_first', group: 'Door delivery in Sri Lanka (per order)', label: 'Zone 3 (over 100 km) — first box', default: 80 },
  { key: 'z3_extra', group: 'Door delivery in Sri Lanka (per order)', label: 'Zone 3 — each extra box', default: 40 },
  { key: 'tv_35', group: 'TVs (Wattala pickup only)', label: 'Up to 35"', default: 140 },
  { key: 'tv_45', group: 'TVs (Wattala pickup only)', label: '36" to 45"', default: 220 },
  { key: 'tv_55', group: 'TVs (Wattala pickup only)', label: '46" to 55"', default: 300 },
  { key: 'tv_65', group: 'TVs (Wattala pickup only)', label: '60" to 65"', default: 350 },
  { key: 'tv_75', group: 'TVs (Wattala pickup only)', label: '66" to 75"', default: 400 },
  { key: 'air_per_kg', group: 'Air freight', label: 'Per kg', default: 15 },
  { key: 'air_doc_fee', group: 'Air freight', label: 'Documentation fee (per box)', default: 60 },
  { key: 'air_transport', group: 'Air freight', label: 'Local transport (per box)', default: 10 },
  { key: 'air_lithium', group: 'Air freight', label: 'Lithium battery surcharge', default: 35 },
  { key: 'doc_first_kg', group: 'Air freight', label: 'Documents only — first kg', default: 40 },
  { key: 'doc_extra_kg', group: 'Air freight', label: 'Documents only — each extra kg', default: 15 },
  { key: 'in_general_1', group: 'India', label: 'General box — 1 box', default: 400 },
  { key: 'in_general_2', group: 'India', label: 'General box — 2 boxes', default: 600 },
  { key: 'in_general_3', group: 'India', label: 'General box — 3 boxes', default: 800 },
  { key: 'in_tea_1', group: 'India', label: 'Tea Chest — 1 box', default: 600 },
  { key: 'in_tea_2', group: 'India', label: 'Tea Chest — 2 boxes', default: 900 },
  { key: 'in_tea_3', group: 'India', label: 'Tea Chest — 3 boxes', default: 1200 },
  { key: 'in_quarter_1', group: 'India', label: 'Quarter CBM — 1 box', default: 600 },
  { key: 'in_quarter_2', group: 'India', label: 'Quarter CBM — 2 boxes', default: 900 },
  { key: 'in_quarter_3', group: 'India', label: 'Quarter CBM — 3 boxes', default: 1200 }
];
const PRICE_KEYS = PRICES.map(p => p.key);

const PROMO_TYPES = ['percent', 'amount', 'special_price', 'free_third'];
const PROMO_ON = ['freight', 'freight_delivery', 'order'];
const PROMO_ITEMS = ['tea_chest', 'all_boxes', 'tv', 'any'];
const PROMO_MODES = ['sea', 'air', 'any'];
const PROMO_COUNTRIES = ['sri_lanka', 'india', 'any'];

const DEFAULT_PROMOTIONS = [{
  id: 'free-third-tea-chest',
  name: 'Send 2, get the 3rd FREE',
  enabled: true,
  type: 'free_third',
  value: 0,
  appliesTo: 'freight',
  items: 'tea_chest',
  mode: 'sea',
  country: 'sri_lanka',
  minBoxes: 3,
  startsOn: '',
  endsOn: '',
  message: {
    en: '🎉 Send 2 Tea Chests, get the 3rd FREE (Sea Freight, same receiver on one Bill of Lading).',
    si: '🎉 Tea Chest 2ක් එවන්න, 3වෙනි එක FREE (Sea Freight, එකම receiver, එක Bill of Lading එකක).',
    ta: '🎉 2 Tea Chest அனுப்புங்கள், 3வது இலவசம் (Sea Freight, ஒரே receiver, ஒரே Bill of Lading).'
  }
}];

const store = () => getDb().collection('prices');
const history = () => getDb().collection('pricesHistory');

const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T00:00:00Z'));

async function current() {
  return (await store().findOne({ _id: DOC_ID })) || {};
}

function valuesOf(doc) {
  const out = {};
  for (const p of PRICES) {
    const v = doc.values && doc.values[p.key];
    out[p.key] = typeof v === 'number' && isFinite(v) ? v : p.default;
  }
  return out;
}
function promotionsOf(doc) {
  return Array.isArray(doc.promotions) ? doc.promotions : DEFAULT_PROMOTIONS;
}

function isActive(p, today = sydneyToday()) {
  return p.enabled && (!p.startsOn || p.startsOn <= today) && (!p.endsOn || p.endsOn >= today);
}

function validate(body) {
  const b = body || {};
  const values = {};
  for (const p of PRICES) {
    const raw = b.values && b.values[p.key];
    const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof n !== 'number' || !isFinite(n) || n <= 0 || n > 100000) return { error: `"${p.label}" (${p.group}) must be a price above 0.` };
    values[p.key] = Math.round(n * 100) / 100;
  }
  // India: more boxes must never cost less.
  for (const t of ['general', 'tea', 'quarter']) {
    if (values[`in_${t}_2`] < values[`in_${t}_1`] || values[`in_${t}_3`] < values[`in_${t}_2`]) return { error: 'India prices: 2 boxes can\'t cost less than 1, or 3 less than 2.' };
  }
  const list = Array.isArray(b.promotions) ? b.promotions : [];
  if (list.length > 30) return { error: 'Too many promotions (30 max).' };
  const promotions = [];
  for (const raw of list) {
    const p = raw || {};
    const name = text(p.name, 80);
    if (!name) return { error: 'Give every promotion a name.' };
    if (!PROMO_TYPES.includes(p.type)) return { error: `"${name}": choose the promotion type.` };
    const freeThird = p.type === 'free_third';
    const value = Number(p.value) || 0;
    if (!freeThird && (value <= 0 || (p.type === 'percent' && value > 90))) return { error: `"${name}": enter the discount (a % between 1 and 90, or an amount above $0).` };
    const startsOn = text(p.startsOn, 10), endsOn = text(p.endsOn, 10);
    if ((startsOn && !isDay(startsOn)) || (endsOn && !isDay(endsOn))) return { error: `"${name}": the dates aren't valid.` };
    if (startsOn && endsOn && endsOn < startsOn) return { error: `"${name}": the end date is before the start date.` };
    const message = { en: text(p.message && p.message.en, 300), si: text(p.message && p.message.si, 300), ta: text(p.message && p.message.ta, 300) };
    if (message.en.length < 5) return { error: `"${name}": write the customer message in English.` };
    promotions.push({
      id: text(p.id, 60) || new ObjectId().toString(),
      name,
      enabled: p.enabled !== false,
      type: p.type,
      value: freeThird ? 0 : Math.round(value * 100) / 100,
      // The free 3rd box is always Tea Chests, Sea Freight to Sri Lanka.
      appliesTo: freeThird ? 'freight' : (PROMO_ON.includes(p.appliesTo) ? p.appliesTo : 'freight'),
      items: freeThird ? 'tea_chest' : (PROMO_ITEMS.includes(p.items) ? p.items : 'any'),
      mode: freeThird ? 'sea' : (PROMO_MODES.includes(p.mode) ? p.mode : 'any'),
      country: freeThird ? 'sri_lanka' : (PROMO_COUNTRIES.includes(p.country) ? p.country : 'any'),
      minBoxes: freeThird ? 3 : Math.max(1, Math.min(100, Math.round(Number(p.minBoxes) || 1))),
      startsOn, endsOn, message
    });
  }
  if (promotions.filter(p => p.type === 'free_third').length > 1) return { error: 'Only one "free 3rd Tea Chest" promotion is allowed.' };
  return { value: { values, promotions } };
}

function staffShape(doc, isAdmin) {
  const today = sydneyToday();
  return {
    prices: PRICES.map(p => ({ ...p, value: valuesOf(doc)[p.key] })),
    promotions: promotionsOf(doc).map(p => ({ ...p, active: isActive(p, today) })),
    options: { types: PROMO_TYPES, appliesTo: PROMO_ON, items: PROMO_ITEMS, modes: PROMO_MODES, countries: PROMO_COUNTRIES },
    updatedAt: doc.updatedAt || null,
    updatedBy: doc.updatedBy || null,
    isAdmin
  };
}

// What the bot reads: every price, and the promotions running today.
function botShape(doc) {
  const today = sydneyToday();
  return {
    values: valuesOf(doc),
    promotions: promotionsOf(doc).filter(p => isActive(p, today)).map(({ startsOn, endsOn, enabled, ...p }) => p)
  };
}

async function saveVersion(value, by) {
  // The very first save keeps the built-in prices as the oldest version.
  const before = (await store().findOne({ _id: DOC_ID })) || { values: valuesOf({}), promotions: DEFAULT_PROMOTIONS, updatedAt: null, updatedBy: null };
  const { _id, ...rest } = before;
  await history().insertOne({ ...rest, savedAt: new Date() });
  const old = await history().find({}, { projection: { _id: 1 } }).sort({ savedAt: -1 }).skip(HISTORY_KEEP).toArray();
  if (old.length) await history().deleteMany({ _id: { $in: old.map(o => o._id) } });
  const doc = { ...value, updatedAt: new Date(), updatedBy: by || null };
  await store().replaceOne({ _id: DOC_ID }, doc, { upsert: true });
  return doc;
}

function createPriceRouters() {
  const publicRouter = express.Router();
  // Read by the Flowise tool before every reply.
  publicRouter.get('/prices', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(botShape(await current()));
    } catch (err) { next(err); }
  });

  const staffRouter = express.Router();
  const isAdmin = req => req.staffPages === null || req.staffPages === undefined;
  const by = req => (req.user && req.user.email) || null;
  const adminOnly = (req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ error: 'Only an admin can change prices and promotions.' }));

  staffRouter.get('/', async (req, res, next) => {
    try { res.json(staffShape(await current(), isAdmin(req))); } catch (err) { next(err); }
  });

  staffRouter.put('/', adminOnly, async (req, res, next) => {
    try {
      const v = validate(req.body);
      if (v.error) return res.status(400).json(v);
      res.json(staffShape(await saveVersion(v.value, by(req)), true));
    } catch (err) { next(err); }
  });

  staffRouter.get('/history', async (req, res, next) => {
    try {
      const list = await history().find({}, { projection: { updatedAt: 1, updatedBy: 1, savedAt: 1 } }).sort({ savedAt: -1 }).limit(HISTORY_KEEP).toArray();
      res.json({ versions: list.map(h => ({ id: String(h._id), updatedAt: h.updatedAt || null, updatedBy: h.updatedBy || null, replacedAt: h.savedAt })) });
    } catch (err) { next(err); }
  });

  staffRouter.post('/history/:id/restore', adminOnly, async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Version not found' });
      const old = await history().findOne({ _id: new ObjectId(req.params.id) });
      if (!old) return res.status(404).json({ error: 'Version not found' });
      const v = validate({ values: valuesOf(old), promotions: promotionsOf(old) });
      if (v.error) return res.status(400).json(v);
      res.json(staffShape(await saveVersion(v.value, by(req)), true));
    } catch (err) { next(err); }
  });

  return { publicRouter, staffRouter };
}

module.exports = { createPriceRouters, validate, botShape, isActive, PRICES, PRICE_KEYS, DEFAULT_PROMOTIONS };
