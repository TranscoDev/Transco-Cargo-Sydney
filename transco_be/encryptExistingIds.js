// One-off: encrypt Passport/NIC numbers saved before encryption was added.
//
//   PII_KEY=... MONGODB_URI=... node encryptExistingIds.js           (dry run: counts only)
//   PII_KEY=... MONGODB_URI=... node encryptExistingIds.js --apply   (encrypts)
//
// Safe to run more than once: already-encrypted values are skipped. Use
// the SAME PII_KEY as the live backend, or the numbers can't be read back.

require('dotenv').config({ quiet: true });
const { connectToDatabase, bookings, customers } = require('./db');
const pii = require('./pii');

async function main() {
  if (!pii.enabled()) throw new Error('Set PII_KEY first (the same key the backend uses).');
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI.');
  await connectToDatabase(process.env.MONGODB_URI, process.env.MONGODB_DB_NAME);
  const plain = v => typeof v === 'string' && v !== '' && !pii.isSealed(v);
  let bookingCount = 0, customerCount = 0;

  for await (const b of bookings().find({ $or: [{ 'sender.idNumber': { $type: 'string', $ne: '' } }, { 'receiver.idNumber': { $type: 'string', $ne: '' } }] }, { projection: { sender: 1, receiver: 1 } })) {
    const set = {};
    if (b.sender && plain(b.sender.idNumber)) set['sender.idNumber'] = pii.seal(b.sender.idNumber);
    if (b.receiver && plain(b.receiver.idNumber)) set['receiver.idNumber'] = pii.seal(b.receiver.idNumber);
    if (!Object.keys(set).length) continue;
    bookingCount++;
    if (apply) await bookings().updateOne({ _id: b._id }, { $set: set });
  }

  for await (const c of customers().find({ $or: [{ 'senderDetails.idNumber': { $type: 'string', $ne: '' } }, { 'savedReceivers.idNumber': { $type: 'string', $ne: '' } }] }, { projection: { senderDetails: 1, savedReceivers: 1 } })) {
    const set = {};
    if (c.senderDetails && plain(c.senderDetails.idNumber)) set['senderDetails.idNumber'] = pii.seal(c.senderDetails.idNumber);
    if ((c.savedReceivers || []).some(r => plain(r.idNumber))) set.savedReceivers = c.savedReceivers.map(r => pii.sealPerson(r));
    if (!Object.keys(set).length) continue;
    customerCount++;
    if (apply) await customers().updateOne({ _id: c._id }, { $set: set });
  }

  console.log(`${apply ? 'Encrypted' : 'Would encrypt'}: ${bookingCount} bookings, ${customerCount} customers.`);
  process.exit(0);
}

main().catch(err => { console.error(err.message); process.exit(1); });
