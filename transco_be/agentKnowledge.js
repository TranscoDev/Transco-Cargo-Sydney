// Agent knowledge (console → Agent Transco): the business details and
// information sections the chat bot uses, edited by staff instead of in
// the Flowise prompt/tool.
//
// - details: contacts, addresses, links, payment. The bot's ready-made
//   replies (English, Sinhala, Tamil) have the defaults below written in;
//   when staff change one, the bot swaps it into every reply.
// - sections: information in plain words. The bot answers questions it
//   has no ready-made reply for from these, in the customer's language,
//   and hands the chat to staff when the answer isn't here.
//
// Prices, zones and shipping dates are NOT here: prices are worked out by
// the bot's calculator, dates come from the shipping calendar.
//
// Every save keeps the previous version (agentKnowledgeHistory) so a
// mistake can be undone. Payment details can be changed by admins only.

const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('./db');

const DOC_ID = 'current';
const MAX_DETAIL = 200;
const MAX_SECTION = 4000;
const HISTORY_KEEP = 50;

// The defaults are exactly what the bot's replies say today (first variant
// in the Flowise tool's KNOWLEDGE_SWAPS) — change both together.
const DETAILS = [
  { key: 'warehouse_address', group: 'Sydney warehouse', label: 'Warehouse address', default: 'Unit 1, No 79 Station Road, Seven Hills NSW 2147' },
  { key: 'warehouse_map', group: 'Sydney warehouse', label: 'Warehouse map link', default: 'https://maps.app.goo.gl/HzSHFnTAfMU89JLh6' },
  { key: 'office_phone', group: 'Sydney contacts', label: 'Transco #1 phone (office)', default: '0434 842 023' },
  { key: 'pickup_name', group: 'Sydney contacts', label: 'Pickup & appointments — name', default: 'Sajith' },
  { key: 'pickup_phone', group: 'Sydney contacts', label: 'Pickup & appointments — phone (Transco #2)', default: '0468 382 023' },
  { key: 'insurance_name', group: 'Sydney contacts', label: 'Insurance — name', default: 'Supun' },
  { key: 'insurance_phone', group: 'Sydney contacts', label: 'Insurance — phone', default: '03 9357 7228' },
  { key: 'head_office_phone', group: 'Head office & India', label: 'Melbourne head office / India phone', default: '+61 3 9703 2255' },
  { key: 'colombo_address', group: 'Colombo warehouse', label: 'Colombo (Wattala) warehouse address', default: '176/2 Alwis Town, Hendala, Wattala' },
  { key: 'colombo_phone_1', group: 'Colombo warehouse', label: 'Colombo phone 1', default: '070 644 0604' },
  { key: 'colombo_phone_2', group: 'Colombo warehouse', label: 'Colombo phone 2', default: '070 644 0601' },
  { key: 'colombo_phone_3', group: 'Colombo warehouse', label: 'Colombo phone 3', default: '011 298 1910' },
  { key: 'colombo_hotline', group: 'Colombo warehouse', label: 'Colombo hotline', default: '+94 70 644 0330' },
  { key: 'tracking_link', group: 'Tracking', label: 'BL tracking website', default: 'https://pebl-tracker.transcocargo.com.au/search-bl/' },
  { key: 'payid', group: 'Payment (admin only)', label: 'PayID', default: 'transcosydney@gmail.com', adminOnly: true },
  { key: 'payid_name', group: 'Payment (admin only)', label: 'PayID account name', default: 'JDM CARS PTY LTD', adminOnly: true }
];

// Started from the manager's "Agent Transco" document, with our current
// details where they differ (booking includes the declaration, live dates,
// India, My Transco).
const SECTIONS = [
  {
    key: 'about', title: 'About us',
    default: 'Transco Cargo Sydney ships personal effects from Sydney, Australia to Sri Lanka (and India) by Sea Freight and Express Air Freight. We give quotes, shipping dates, drop-off and pickup details, packing and customs guidance, and tracking help.\nWebsite: https://my.transcosydney.com.au'
  },
  {
    key: 'hours', title: 'Drop-off, box collection & home pickup',
    default: 'Drop-off and box collection at the Seven Hills warehouse:\n- Saturday 11am–3pm (no appointment needed)\n- Tuesday to Friday 5pm–6pm, by appointment only\n- Closed Sunday and Monday\nHome pickup (Sydney Metro): weekdays after 5pm and weekends all day. Don\'t quote a pickup fee — the pickup contact confirms it.\nClosures and holidays come from Website notices.'
  },
  {
    key: 'booking', title: 'Booking & declaration',
    default: 'Customers book online at https://my.transcosydney.com.au/account.html#/book — the shipping declaration is part of the booking (the old website declaration form is no longer used).\nAt the warehouse counter, customers can scan our QR code and fill the drop-off form on their phone; staff help them.\nCustomers can see their bookings, BL number and status in My Transco: https://my.transcosydney.com.au/account.html'
  },
  {
    key: 'boxes', title: 'Where to get boxes',
    default: 'Sydney (official Transco boxes):\n- Transco warehouse, Seven Hills — Saturdays 11am–3pm\n- Balajie Groceries, 20 Aurelia St, Toongabbie — 0469 587 525\n- Hills Mega Mart, 37-39 Boomerang Pl, Seven Hills — 0423 836 324\n- Kate Food Products, 41 Boomerang Pl, Seven Hills — 02 9831 5820\nInterstate / far away (approved 104L heavy-duty tea chest):\n- Kennards Self Storage "Jumbo Box Heavy Duty" (431 x 406 x 596 mm, 104L) — recommended, stronger\n- Bunnings "104L Heavy Duty Large Tea Chest Box"'
  },
  {
    key: 'packing', title: 'Packing rules',
    default: '- Maximum 30 kg per Tea Chest box.\n- Write the sender details (name, Sydney address, phone) and receiver details (name, Sri Lanka address, phone) clearly and attach them to the outside of each box.\n- All boxes to one receiver go on one Bill of Lading; different receivers are billed separately.\n- Electrical items (TVs, washing machines, fridges, microwaves…) have no door delivery — the receiver collects them from the Wattala warehouse.'
  },
  {
    key: 'customs', title: 'Sri Lanka customs',
    default: '- Sri Lanka Customs charges duty/tax on electrical appliances, vehicle/machinery spare parts, perfumes & cosmetics, and alcohol.\n- Declare all contents in detail. Sender and receiver passport numbers must be on all forms, and names must match the passports exactly.\n- Commercial quantities for resale are not allowed as personal cargo.\n- New clothes: keep the brand labels/tags on, or Customs may tax them as commercial goods.\n- Returning-resident duty-free allowance: more than 1 year in Australia → up to USD 1,000; 6–12 months → up to USD 500.\n- Never give a duty amount — Sri Lanka Customs assesses it, and it is paid to them directly, not through us.\n- Cars: ask for make & model, year, engine CC and fuel type, and location; the team gives the full breakdown.'
  },
  {
    key: 'banned', title: 'Banned & restricted items (air freight)',
    default: 'Not accepted by air:\n- Dangerous goods: hazardous chemicals, flammable liquids, explosives\n- Aerosols and sprays\n- Loose lithium batteries and power banks\n- Cash, negotiable instruments, precious metals and high-value jewellery'
  },
  {
    key: 'tracking', title: 'Tracking',
    default: 'Customers track with their 6-digit BL (Bill of Lading) number on the tracking website. The BL number is on the drop-off receipt. Signed-in My Transco customers also see their BL and status there. India shipments: contact the India team (head office).'
  },
  {
    key: 'handoff', title: 'When to pass to staff',
    default: 'Pass the chat to staff when the answer isn\'t in this information, when the customer is upset, or when they ask for a person. Give everything you do know first, then say what the team will confirm.'
  },
  {
    key: 'faq', title: 'Other questions & answers',
    default: ''
  }
];

const DETAIL_KEYS = DETAILS.map(d => d.key);
const SECTION_KEYS = SECTIONS.map(s => s.key);

const store = () => getDb().collection('agentKnowledge');
const history = () => getDb().collection('agentKnowledgeHistory');

function clean(v, max) {
  return typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '';
}

async function current() {
  return (await store().findOne({ _id: DOC_ID })) || { details: {}, sections: {} };
}

// Saved value, or the default when staff haven't changed it.
function detailValue(doc, d) {
  const v = doc.details && doc.details[d.key];
  return typeof v === 'string' && v.trim() ? v.trim() : d.default;
}
function sectionText(doc, s) {
  const v = doc.sections && doc.sections[s.key];
  return typeof v === 'string' ? v : s.default;
}

function staffShape(doc) {
  return {
    details: DETAILS.map(d => ({ ...d, value: detailValue(doc, d) })),
    sections: SECTIONS.map(s => ({ key: s.key, title: s.title, default: s.default, text: sectionText(doc, s) })),
    updatedAt: doc.updatedAt || null,
    updatedBy: doc.updatedBy || null
  };
}

// What the bot reads: every detail (default or changed) and the sections
// that have text.
function botShape(doc) {
  const details = {};
  for (const d of DETAILS) details[d.key] = detailValue(doc, d);
  return {
    details,
    sections: SECTIONS.map(s => ({ title: s.title, text: sectionText(doc, s).trim() })).filter(s => s.text)
  };
}

function validate(body, isAdmin, doc) {
  const b = body || {};
  const details = {}, sections = {};
  for (const d of DETAILS) {
    const raw = b.details && b.details[d.key];
    const v = clean(raw, MAX_DETAIL);
    const before = detailValue(doc, d);
    const next = v || d.default;
    if (d.adminOnly && !isAdmin && next !== before) return { error: 'Only an admin can change the payment details.' };
    // Store only changes from the default, so a default can be updated later.
    if (v && v !== d.default) details[d.key] = v;
  }
  for (const s of SECTIONS) {
    const raw = b.sections && b.sections[s.key];
    if (typeof raw !== 'string') { sections[s.key] = sectionText(doc, s); continue; }
    if (raw.length > MAX_SECTION) return { error: `"${s.title}" is too long (${MAX_SECTION} characters max).` };
    sections[s.key] = clean(raw, MAX_SECTION);
  }
  return { value: { details, sections } };
}

async function saveVersion(value, by) {
  // The very first save keeps the standard text as the oldest version.
  const before = (await store().findOne({ _id: DOC_ID })) ||
    { details: {}, sections: Object.fromEntries(SECTIONS.map(s => [s.key, s.default])), updatedAt: null, updatedBy: null };
  {
    const { _id, ...rest } = before;
    await history().insertOne({ ...rest, savedAt: new Date() });
    // Keep the newest HISTORY_KEEP versions.
    const old = await history().find({}, { projection: { _id: 1 } }).sort({ savedAt: -1 }).skip(HISTORY_KEEP).toArray();
    if (old.length) await history().deleteMany({ _id: { $in: old.map(o => o._id) } });
  }
  const doc = { ...value, updatedAt: new Date(), updatedBy: by || null };
  await store().replaceOne({ _id: DOC_ID }, doc, { upsert: true });
  return doc;
}

function createAgentKnowledgeRouters() {
  const publicRouter = express.Router();
  // Read by the Flowise tool before every reply.
  publicRouter.get('/agent-knowledge', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(botShape(await current()));
    } catch (err) { next(err); }
  });

  const staffRouter = express.Router();
  const isAdmin = req => req.staffPages === null || req.staffPages === undefined;
  const by = req => (req.user && req.user.email) || null;

  staffRouter.get('/', async (req, res, next) => {
    try {
      res.json({ ...staffShape(await current()), isAdmin: isAdmin(req) });
    } catch (err) { next(err); }
  });

  staffRouter.put('/', async (req, res, next) => {
    try {
      const v = validate(req.body, isAdmin(req), await current());
      if (v.error) return res.status(400).json(v);
      const doc = await saveVersion(v.value, by(req));
      res.json({ ...staffShape(doc), isAdmin: isAdmin(req) });
    } catch (err) { next(err); }
  });

  staffRouter.get('/history', async (req, res, next) => {
    try {
      const list = await history().find({}, { projection: { updatedAt: 1, updatedBy: 1, savedAt: 1 } }).sort({ savedAt: -1 }).limit(HISTORY_KEEP).toArray();
      res.json({ versions: list.map(h => ({ id: String(h._id), updatedAt: h.updatedAt || null, updatedBy: h.updatedBy || null, replacedAt: h.savedAt })) });
    } catch (err) { next(err); }
  });

  // Puts an older version back (the current one goes into history first).
  staffRouter.post('/history/:id/restore', async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Version not found' });
      const old = await history().findOne({ _id: new ObjectId(req.params.id) });
      if (!old) return res.status(404).json({ error: 'Version not found' });
      const v = validate({ details: old.details || {}, sections: old.sections || {} }, isAdmin(req), await current());
      if (v.error) return res.status(400).json(v);
      const doc = await saveVersion(v.value, by(req));
      res.json({ ...staffShape(doc), isAdmin: isAdmin(req) });
    } catch (err) { next(err); }
  });

  return { publicRouter, staffRouter };
}

module.exports = { createAgentKnowledgeRouters, botShape, validate, DETAILS, SECTIONS, DETAIL_KEYS, SECTION_KEYS };
