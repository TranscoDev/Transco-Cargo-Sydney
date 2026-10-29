// Company details (console → Settings → Company): the business's own
// name, contacts, logo and look, kept in the DB instead of
// written into the code, so another cargo company can be set up by
// filling these in. Every staff member can see them; only an admin saves.
//
// Step 1: stored and edited here only. The website, PDFs and bot still
// use their own text until they are switched over to read this.

const express = require('express');
const { getDb } = require('./db');

const DOC_ID = 'current';
const MAX_FIELD = 300;

// Defaults are Transco's details as the site and bot show them today.
// Blank = not known yet (never guessed).
const FIELDS = [
  { key: 'name', group: 'Business', label: 'Company name', default: 'Transco Cargo Sydney' },
  { key: 'short_name', group: 'Business', label: 'Short name', default: 'Transco' },
  { key: 'abn', group: 'Business', label: 'ABN (Australian Business Number)', default: '', hint: 'The 11-digit number the government gives the business, e.g. 12 345 678 901. It is on the company\'s invoices and tax papers — ask the manager if unsure.' },
  { key: 'phone', group: 'Contact', label: 'Main phone', default: '0434 842 023' },
  { key: 'email', group: 'Contact', label: 'Email', default: 'transcosydney@gmail.com' },
  { key: 'address', group: 'Contact', label: 'Address', default: 'Unit 1, No 79 Station Road, Seven Hills NSW 2147' },
  { key: 'website', group: 'Contact', label: 'Website', default: 'https://my.transcosydney.com.au' },
  { key: 'brand_colour', group: 'Look', label: 'Brand colour', default: '#0f8f86', type: 'colour' },
  { key: 'bot_name', group: 'Chat bot', label: 'Bot name', default: 'Agent Transco' },
  { key: 'pdf_footer', group: 'Forms & PDFs', label: 'Footer text on PDFs', default: '', multiline: true }
];

// The logo is kept as a small image (data URL) beside the fields.
const MAX_LOGO = 700 * 1024;
const LOGO_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

const store = () => getDb().collection('companySettings');

function clean(v) {
  return typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, MAX_FIELD) : '';
}

async function current() {
  return (await store().findOne({ _id: DOC_ID })) || { values: {} };
}

// Saved value, or the default when it hasn't been changed.
function fieldValue(doc, f) {
  const v = doc.values && doc.values[f.key];
  return typeof v === 'string' ? v : f.default;
}

// Every field filled in (default or changed) — what other parts will read.
async function companyDetails() {
  const doc = await current();
  return Object.fromEntries(FIELDS.map(f => [f.key, fieldValue(doc, f)]));
}

function staffShape(doc) {
  return {
    fields: FIELDS.map(f => ({ ...f, value: fieldValue(doc, f) })),
    logo: doc.logo || null,
    updatedAt: doc.updatedAt || null,
    updatedBy: doc.updatedBy || null
  };
}

function validate(body) {
  const values = {};
  for (const f of FIELDS) {
    const raw = body && body.values && body.values[f.key];
    if (typeof raw !== 'string') continue;
    const v = clean(raw);
    if (f.type === 'colour' && v && !/^#[0-9a-f]{6}$/i.test(v)) return { error: 'Brand colour must look like #0f8f86.' };
    if (f.key === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { error: 'That email address doesn\'t look right.' };
    values[f.key] = v;
  }
  // logo: a data URL to set, null to remove, missing to keep.
  const logo = body && body.logo;
  if (logo !== undefined && logo !== null) {
    if (typeof logo !== 'string' || !LOGO_RE.test(logo)) return { error: 'The logo must be a PNG, JPG, WEBP or SVG picture.' };
    if (logo.length > MAX_LOGO) return { error: 'The logo picture is too big — please use one under 500 KB.' };
  }
  return { value: values, logo };
}

function createCompanyRouter({ isStaffAdmin }) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      res.json({ ...staffShape(await current()), canEdit: await isStaffAdmin(req) });
    } catch (err) { next(err); }
  });

  router.put('/', async (req, res, next) => {
    try {
      if (!(await isStaffAdmin(req))) return res.status(403).json({ error: 'Only an admin can change the company details.' });
      const v = validate(req.body);
      if (v.error) return res.status(400).json(v);
      const before = await current();
      const logo = v.logo === undefined ? before.logo || null : v.logo;
      const doc = { values: { ...(before.values || {}), ...v.value }, logo, updatedAt: new Date(), updatedBy: (req.user && req.user.email) || null };
      await store().replaceOne({ _id: DOC_ID }, doc, { upsert: true });
      res.json({ ...staffShape(doc), canEdit: true });
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createCompanyRouter, companyDetails, FIELDS };
