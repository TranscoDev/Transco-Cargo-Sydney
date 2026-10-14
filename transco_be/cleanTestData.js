// One-off before go-live: remove the staff testing data and keep the real
// customers imported for Shipment 57 and Shipment 58.
//
//   railway run --service transco-backend node cleanTestData.js           (dry run: counts only)
//   railway run --service transco-backend node cleanTestData.js --apply   (backup, then delete)
//
// KEEPS: consolidations 57/58, their shipments, the customers on those
// shipments, their invoices + payments, receivers, ALL staff logins,
// shipping schedule, settings, notices.
// REMOVES: every other customer (staff test numbers, website visitors),
// all bookings, all chat messages, test shipments/consolidations and their
// invoices + payments, pending accounts, OTPs, the PII access log from
// testing, the WhatsApp dedup cache, test campaigns and segments, staff
// tasks, and resets the booking/customer code counters.
//
// --apply first copies the WHOLE database into "<db>_backup_<yyyymmdd>"
// in the same cluster, so everything can be put back.

const { MongoClient } = require('mongodb');

const REAL_BATCHES = [57, 58];

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI (run it with `railway run`).');
  const dbName = process.env.MONGODB_DB_NAME || 'transco';
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(dbName);
  const col = n => db.collection(n);

  const realCons = await col('consolidations').find({ batchNumber: { $in: REAL_BATCHES } }).toArray();
  if (realCons.length !== REAL_BATCHES.length) throw new Error(`Expected Shipment ${REAL_BATCHES.join(' and ')}; found ${realCons.length}. Stopping.`);
  const realConsIds = realCons.map(c => c._id);
  const realShipments = await col('shipments').find({ consolidationId: { $in: realConsIds } }, { projection: { customerId: 1, hblNumber: 1 } }).toArray();
  const realCustomerIds = [...new Map(realShipments.filter(s => s.customerId).map(s => [String(s.customerId), s.customerId])).values()];
  const realInvoiceIds = (await col('invoices').find({ consolidationId: { $in: realConsIds } }, { projection: { _id: 1 } }).toArray()).map(i => i._id);
  if (!realShipments.length || !realCustomerIds.length) throw new Error('No real shipments/customers found. Stopping.');

  // What goes. Every filter is "not one of the real ones", so nothing real can match.
  const plan = [
    ['customers', { _id: { $nin: realCustomerIds } }],
    ['bookings', {}],
    ['messages', {}],
    ['shipments', { consolidationId: { $nin: realConsIds } }],
    ['consolidations', { _id: { $nin: realConsIds } }],
    ['invoices', { _id: { $nin: realInvoiceIds } }],
    ['payments', { invoiceId: { $nin: realInvoiceIds } }],
    ['pendingAccounts', {}],
    ['customerOtps', {}],
    ['piiAccessLog', {}],
    ['processedWhatsAppMessages', {}],
    ['campaigns', {}],
    ['segments', {}],
    ['staffTasks', {}],
  ];

  const existing = new Set((await db.listCollections().toArray()).map(c => c.name));
  console.log(`Database "${dbName}". Keeping Shipment ${REAL_BATCHES.join(' + ')}: ${realShipments.length} shipments, ${realCustomerIds.length} customers, ${realInvoiceIds.length} invoices.\n`);
  console.log(`${apply ? 'Deleting' : 'Would delete'}:`);
  for (const [name, filter] of plan) {
    if (!existing.has(name)) continue;
    const total = await col(name).countDocuments();
    const n = await col(name).countDocuments(filter);
    console.log(`  ${name.padEnd(26)} ${String(n).padStart(5)} of ${String(total).padStart(5)}   (keeps ${total - n})`);
  }
  console.log(`  counters                    booking + customer codes start again from 1`);

  if (!apply) { console.log('\nDry run only. Nothing changed. Add --apply to back up and delete.'); await client.close(); return; }

  // 1. Full backup into a sibling database first.
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const backup = client.db(`${dbName}_backup_${stamp}`);
  if ((await backup.listCollections().toArray()).length) throw new Error(`Backup database ${backup.databaseName} already exists. Stopping so it isn't mixed up.`);
  for (const name of existing) {
    const docs = await col(name).find({}).toArray();
    if (docs.length) await backup.collection(name).insertMany(docs, { ordered: false });
  }
  for (const name of existing) {
    const a = await col(name).countDocuments(), b = await backup.collection(name).countDocuments();
    if (a !== b) throw new Error(`Backup of ${name} incomplete (${b} of ${a}). Nothing deleted.`);
  }
  console.log(`\n✓ Backup saved: database "${backup.databaseName}" (all ${existing.size} collections, counts checked).`);

  // 2. Delete.
  for (const [name, filter] of plan) {
    if (!existing.has(name)) continue;
    const r = await col(name).deleteMany(filter);
    console.log(`  ${name.padEnd(26)} deleted ${r.deletedCount}`);
  }
  await col('counters').updateMany({ _id: { $in: ['bookingCode', 'customerCode'] } }, { $set: { seq: 0 } });

  // 3. Check the real data is all still there.
  const after = {
    shipments: await col('shipments').countDocuments({ consolidationId: { $in: realConsIds } }),
    customers: await col('customers').countDocuments({ _id: { $in: realCustomerIds } }),
    invoices: await col('invoices').countDocuments({ _id: { $in: realInvoiceIds } }),
  };
  const ok = after.shipments === realShipments.length && after.customers === realCustomerIds.length && after.invoices === realInvoiceIds.length;
  console.log(`\n${ok ? '✓' : '✗'} Real data after clean-up: ${after.shipments} shipments, ${after.customers} customers, ${after.invoices} invoices.`);
  await client.close();
  if (!ok) process.exit(1);
}

main().catch(err => { console.error('Stopped: ' + err.message); process.exit(1); });
