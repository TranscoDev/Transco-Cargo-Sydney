// One-off: copy the Transco database to another MongoDB (e.g. the office
// Atlas account). Copies every collection with its documents, options and
// indexes. Only the one database is copied, never anything else in the
// old project. The old database is only read, never changed.
//
//   OLD_MONGODB_URI=... NEW_MONGODB_URI=... node copyDatabase.js           (dry run: lists what would be copied)
//   OLD_MONGODB_URI=... NEW_MONGODB_URI=... node copyDatabase.js --apply   (copies, then compares counts)
//
// Database name: MONGODB_DB_NAME, or "transco" (the backend's default).
// Refuses to write into a collection that already has documents, so a
// second run can't duplicate data. Pass --overwrite to empty those first.
// Passport/NIC numbers stay encrypted as they are; keep PII_KEY unchanged
// on Railway and they read back exactly as before.

const { MongoClient } = require('mongodb');

const BATCH = 500;

async function main() {
  const apply = process.argv.includes('--apply');
  const overwrite = process.argv.includes('--overwrite');
  const oldUri = process.env.OLD_MONGODB_URI;
  const newUri = process.env.NEW_MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'transco';
  if (!oldUri || !newUri) throw new Error('Set OLD_MONGODB_URI and NEW_MONGODB_URI.');
  if (oldUri === newUri) throw new Error('OLD and NEW are the same address.');

  const from = new MongoClient(oldUri);
  const to = new MongoClient(newUri);
  await from.connect();
  await to.connect();
  const src = from.db(dbName);
  const dst = to.db(dbName);

  const all = await src.listCollections().toArray();
  const colls = all.filter(c => c.type !== 'view' && !c.name.startsWith('system.'));
  const views = all.filter(c => c.type === 'view');
  if (!colls.length) throw new Error(`Database "${dbName}" in the OLD address has no collections. Check the name.`);

  console.log(`${apply ? 'Copying' : 'Would copy'} database "${dbName}": ${colls.length} collections${views.length ? `, ${views.length} views` : ''}.`);

  const existing = new Set((await dst.listCollections().toArray()).map(c => c.name));
  const report = [];

  for (const c of colls) {
    const source = src.collection(c.name);
    const count = await source.countDocuments();
    const indexes = (await source.indexes()).filter(i => i.name !== '_id_');

    if (!apply) {
      console.log(`  ${c.name}: ${count} documents, ${indexes.length} extra indexes`);
      continue;
    }

    if (existing.has(c.name)) {
      const already = await dst.collection(c.name).countDocuments();
      if (already > 0 && !overwrite) throw new Error(`NEW "${c.name}" already has ${already} documents. Nothing more copied. Re-run with --overwrite to replace.`);
      if (overwrite) await dst.collection(c.name).drop();
    }
    if (!existing.has(c.name) || overwrite) {
      const { idIndex, ...options } = c.options || {};
      await dst.createCollection(c.name, options);
    }

    const target = dst.collection(c.name);
    let batch = [], copied = 0;
    for await (const doc of source.find({})) {
      batch.push(doc);
      if (batch.length === BATCH) { await target.insertMany(batch, { ordered: false }); copied += batch.length; batch = []; }
    }
    if (batch.length) { await target.insertMany(batch, { ordered: false }); copied += batch.length; }

    for (const { v, ns, key, name, ...opts } of indexes) {
      await target.createIndex(key, { name, ...opts });
    }

    const after = await target.countDocuments();
    report.push({ name: c.name, old: count, new: after });
    console.log(`  ${c.name}: ${copied} copied, ${indexes.length} indexes ${after === count ? '✓' : `✗ (old ${count}, new ${after})`}`);
  }

  if (apply) {
    for (const vw of views) {
      if (!existing.has(vw.name)) await dst.createCollection(vw.name, { viewOn: vw.options.viewOn, pipeline: vw.options.pipeline });
      console.log(`  view ${vw.name} ✓`);
    }
    const bad = report.filter(r => r.old !== r.new);
    console.log(bad.length
      ? `\n✗ ${bad.length} collection(s) don't match. Don't switch Railway yet.`
      : `\n✓ All ${report.length} collections match. Safe to switch MONGODB_URI on Railway.`);
  }

  await from.close();
  await to.close();
  process.exit(0);
}

main().catch(err => { console.error('Stopped: ' + err.message); process.exit(1); });
