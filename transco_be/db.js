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

module.exports = { connectToDatabase, getDb, customers, messages, users, bookings, settings };
