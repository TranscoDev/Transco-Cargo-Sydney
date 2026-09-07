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

module.exports = { connectToDatabase, getDb, customers, messages, users, bookings };
