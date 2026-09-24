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
  campaigns,
  segments
};
