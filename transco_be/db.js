const { MongoClient } = require('mongodb');

let client;
let db;

async function connectToDatabase(uri, dbName = 'transco') {
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);

  await db.collection('customers').createIndex({ phoneNumber: 1 }, { unique: true });
  await db.collection('messages').createIndex({ customerId: 1, createdAt: 1 });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('bookings').createIndex({ createdAt: 1 });

  // dedupeKey makes re-running an Excel import safe: the same sender+
  // receiver pairing upserts the same shipment history record instead of
  // creating a duplicate every time an updated sheet is imported.
  await db.collection('shipmentHistory').createIndex({ dedupeKey: 1 }, { unique: true });
  await db.collection('shipmentHistory').createIndex({ customerId: 1 });

  // Live operational shipments (Phase 2) — distinct from shipmentHistory
  // (historical Excel import records) above.
  await db.collection('shipments').createIndex({ shipmentNumber: 1 }, { unique: true });
  await db.collection('shipments').createIndex({ customerId: 1 });
  await db.collection('shipments').createIndex({ bookingId: 1 });
  // hblNumber only exists on shipments imported from a batch ledger — sparse
  // so live, manually-created shipments (no HBL) don't collide on null.
  await db.collection('shipments').createIndex({ hblNumber: 1 }, { unique: true, sparse: true });

  // One document per shipment batch (e.g. "Batch 57", "Batch 58"), imported
  // from the dashboard tracker sheet — see consolidations() below.
  await db.collection('consolidations').createIndex({ batchNumber: 1 }, { unique: true });

  // Deduped receiver directory — see receivers() below.
  await db.collection('receivers').createIndex({ dedupeKey: 1 }, { unique: true });

  await db.collection('invoices').createIndex({ invoiceNumber: 1 }, { unique: true });

  console.log('Connected to MongoDB');
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not connected yet');
  return db;
}

function customers() {
  return getDb().collection('customers');
}

function messages() {
  return getDb().collection('messages');
}

function users() {
  return getDb().collection('users');
}

function bookings() {
  return getDb().collection('bookings');
}

// Small collection for global, single-document settings (currently
// the per-channel Maintenance Mode flags, websitePaused/whatsappPaused)
// — one document per setting, keyed by _id, so there's never any
// ambiguity about which record is "the" setting.
function settings() {
  return getDb().collection('settings');
}

// Historical shipment records (currently from the Excel customer import) —
// one document per sender+receiver pairing, linked to a customer via
// customerId. Kept separate from `messages` since these never came through
// a conversation. See importHistoricalCustomers.js.
function shipmentHistory() {
  return getDb().collection('shipmentHistory');
}

// Live operational shipments (Phase 2 onward) — created from a booking or
// standalone, tracked through pickup/warehouse/transit/delivery. Never
// duplicates customer data; references customerId/bookingId only.
function shipments() {
  return getDb().collection('shipments');
}

// One document per shipment batch (e.g. "Batch 57", "Batch 58") — imported
// from the dashboard tracker sheet (PE number, ETD/ETA/PEBL dates, batch
// financial rollup). Shipments reference their batch via consolidationId;
// a batch can exist before every one of its shipments has been imported.
function consolidations() {
  return getDb().collection('consolidations');
}

// Deduped receiver directory. A receiver never messages the bot and isn't
// a `customers` record — but the same person can receive shipments from
// different senders across different batches, so this exists to dedupe
// them (by phone, falling back to name+address, same convention as
// customer/shipment-history dedup elsewhere) instead of that person's
// details being re-typed and re-siloed on every shipment.
function receivers() {
  return getDb().collection('receivers');
}

// One per customer shipment — itemized charges, linked to customerId +
// shipmentId (and consolidationId when the shipment belongs to a batch).
function invoices() {
  return getDb().collection('invoices');
}

// Payment transactions against an invoice — tender type, amount, date.
// Also holds historical entries imported from the bank feed/cash log
// (source: "bank_feed_historical" / "cash_log_historical"), which are
// read-only reference data, never linked to a live invoice.
function payments() {
  return getDb().collection('payments');
}

// A log entry per email promotion send — not used to re-send anything,
// purely a record for staff of what went out, when, and to how many.
function campaigns() {
  return getDb().collection('campaigns');
}

// Staff-saved, reusable Contacts filter combinations (status/source/has
// email/search) — shared across whoever's logged into the console, not
// per-browser, so the whole team sees the same saved segments.
function segments() {
  return getDb().collection('segments');
}

module.exports = {
  connectToDatabase,
  getDb,
  customers,
  messages,
  users,
  bookings,
  settings,
  shipmentHistory,
  shipments,
  consolidations,
  receivers,
  invoices,
  payments,
  campaigns,
  segments
};
