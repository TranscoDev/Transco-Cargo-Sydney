// CLI wrapper for the historical Excel/CSV customer import — the actual
// parsing/matching/dedup logic lives in importLogic.js, shared with the
// staff-facing upload endpoint (POST /api/imports/customers in
// server.js) so both paths behave identically.
//
// Usage:
//   node importHistoricalCustomers.js <path-to-file.csv-or-.xlsx> [--commit] [--db <name>]
//
// Without --commit this is a dry run: parses, matches against the real
// customers already in the database, and prints the summary — writes
// nothing. Pass --commit to actually insert/update. --db lets you point
// at a throwaway database name for testing against fake data.

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { readRowsFromFile, processImportRows } = require('./importLogic');

async function run() {
  const args = process.argv.slice(2);
  const filePath = args.find(a => !a.startsWith('--'));
  const commit = args.includes('--commit');
  const dbFlagIdx = args.indexOf('--db');
  const dbName = dbFlagIdx !== -1 ? args[dbFlagIdx + 1] : 'transco';

  if (!filePath) {
    console.error('Usage: node importHistoricalCustomers.js <file> [--commit] [--db <name>]');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const rows = readRowsFromFile(path.resolve(filePath));

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(dbName);
  const customersColl = db.collection('customers');
  const shipmentsColl = db.collection('shipmentHistory');

  if (commit) {
    await shipmentsColl.createIndex({ dedupeKey: 1 }, { unique: true });
  }

  const { summary, reviewRows } = await processImportRows(rows, { customersColl, shipmentsColl, commit });

  await client.close();

  console.log('\n=== IMPORT %s ===\n', commit ? 'COMMITTED' : 'DRY RUN (nothing written — pass --commit to write)');
  console.log(`Rows processed:          ${summary.processed}`);
  console.log(`Existing customers matched: ${summary.matchedExisting}`);
  console.log(`New customers created:      ${summary.createdNew}`);
  console.log(`Shipment records linked:    ${summary.shipmentsLinked}`);
  console.log(`Skipped (pre-flagged junk section): ${summary.skippedSection}`);
  console.log(`Needs review (bad phone):   ${summary.needsReview}`);

  if (reviewRows.length) {
    console.log('\n--- Rows needing review ---');
    for (const r of reviewRows.slice(0, 20)) {
      console.log(`  ${r.senderName}: "${r.rawPhone}" (${r.reason})`);
    }
    if (reviewRows.length > 20) {
      console.log(`  ...and ${reviewRows.length - 20} more`);
    }
  }
}

run().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
