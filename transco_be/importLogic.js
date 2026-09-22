// Shared parsing/matching/dedup logic for the historical Excel/CSV
// customer import — used by both the developer-run CLI script
// (importHistoricalCustomers.js) and the staff-facing upload endpoint
// (POST /api/imports/customers in server.js). Kept in one place so the
// two paths can never quietly drift apart on how a row gets classified.

const XLSX = require('xlsx');
const { normalizePhoneNumber } = require('./normalizePhone');

const COLUMNS = {
  shipmentNumber: 'SHIPMENT NUMBER',
  whatsappFlyer: 'Whatsapp flyer',
  loyalty: 'Loyalty',
  senderName: 'SENDERS NAME',
  senderAddress: 'SENDERS ADDRESS',
  senderNumber: 'SENDERS NUMBER',
  senderEmail: 'SENDERS E MAIL',
  receiverName: 'RECEIVERS NAME',
  receiverAddress: 'RECEIVERS ADDRESS',
  receiverNumber: 'RECEIVERS NUMBER',
  receiverEmail: 'RECEIVERS E MAIL'
};

// Section-marker rows (plain text dropped into the Senders Name column by
// whoever maintained the sheet) change how the rows under them default —
// never guessed at from content, only ever set from an explicit marker
// like this, per the "don't invent do-not-contact" rule.
const SECTION_MARKERS = [
  { pattern: /duplicate.*invalid/i, sectionStatus: 'SKIP' },
  { pattern: /^bad exp/i, sectionStatus: 'DO_NOT_CONTACT' },
  { pattern: /^new customers/i, sectionStatus: null } // just a progress note, not a real section change
];

function readRowsFromFile(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false });
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
}

function readRowsFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
}

function cell(row, key) {
  const val = row[COLUMNS[key]];
  return typeof val === 'string' ? val.trim() : (val ?? '');
}

// The xlsx library silently converts a scientific-notation cell like
// "9.19248E+11" into the plain JS number 919248000000 — by the time our
// code sees it, the "E+11" is gone and it looks like a perfectly normal
// 12-digit number, not corrupted data. A real phone number essentially
// never ends in 4+ zeros, so that's the only signal left to catch this:
// treat a suspiciously round numeric cell as unrecoverable, same as if
// we'd seen the raw scientific notation directly.
function looksLikePrecisionLossArtifact(rawCellValue) {
  if (typeof rawCellValue !== 'number') return false;
  return /0{4,}$/.test(String(Math.trunc(rawCellValue)));
}

function normalizeEmail(raw) {
  const str = String(raw ?? '').trim().toLowerCase();
  if (!str || !str.includes('@') || str === '-') return null;
  return str;
}

// Stable id for a shipment relationship: prefer both phones (dedupes an
// unchanged row across re-imports); fall back to receiver name+address
// when the receiver has no usable phone, so those rows still dedupe
// instead of colliding into one shared key.
function computeDedupeKey(senderPhone, receiverPhone, receiverName, receiverAddress) {
  if (receiverPhone) return `${senderPhone}|${receiverPhone}`;
  const fallback = `${receiverName}|${receiverAddress}`.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${senderPhone}|noph|${fallback}`;
}

/**
 * Processes already-parsed spreadsheet rows against the given customer/
 * shipment collections.
 *
 * @param {object[]} rows - from readRowsFromFile/readRowsFromBuffer
 * @param {object} opts - { customersColl, shipmentsColl, commit }
 *   commit defaults to true (the staff upload endpoint always means it);
 *   the CLI script passes false to preview without writing.
 * @returns {Promise<{summary: object, reviewRows: object[]}>}
 */
async function processImportRows(rows, { customersColl, shipmentsColl, commit = true }) {
  const summary = {
    processed: 0,
    matchedExisting: 0,
    createdNew: 0,
    shipmentsLinked: 0,
    skippedSection: 0,
    needsReview: 0
  };

  const reviewRows = [];
  let currentSectionStatus = 'HISTORICAL';
  let lastBatchNumber = '';

  // Cache phone -> customer _id within this run so repeat senders in the
  // same file don't hit the database once per row.
  const customerIdByPhone = new Map();

  for (const row of rows) {
    const rawSenderName = cell(row, 'senderName');
    const shipmentCell = cell(row, 'shipmentNumber');
    if (shipmentCell) lastBatchNumber = shipmentCell;

    const marker = SECTION_MARKERS.find(m => m.pattern.test(rawSenderName));
    if (marker) {
      if (marker.sectionStatus) currentSectionStatus = marker.sectionStatus;
      continue;
    }

    const rawSenderPhone = cell(row, 'senderNumber');
    if (!rawSenderName || !rawSenderPhone) {
      continue;
    }

    summary.processed += 1;

    if (currentSectionStatus === 'SKIP') {
      summary.skippedSection += 1;
      continue;
    }

    const senderPhoneCorrupted = looksLikePrecisionLossArtifact(row[COLUMNS.senderNumber]);
    const senderPhone = senderPhoneCorrupted ? null : normalizePhoneNumber(rawSenderPhone);

    if (!senderPhone) {
      summary.needsReview += 1;
      reviewRows.push({
        reason: senderPhoneCorrupted
          ? 'sender phone likely corrupted by spreadsheet scientific-notation rounding'
          : 'unparseable sender phone',
        senderName: rawSenderName,
        rawPhone: rawSenderPhone
      });
      continue;
    }

    const senderEmail = normalizeEmail(cell(row, 'senderEmail'));
    const receiverName = cell(row, 'receiverName');
    const receiverAddress = cell(row, 'receiverAddress');
    const receiverPhoneRaw = cell(row, 'receiverNumber');
    const receiverPhoneCorrupted = looksLikePrecisionLossArtifact(row[COLUMNS.receiverNumber]);
    const receiverPhone = (receiverPhoneRaw && !receiverPhoneCorrupted)
      ? normalizePhoneNumber(receiverPhoneRaw)
      : null;
    const receiverEmail = normalizeEmail(cell(row, 'receiverEmail'));
    const loyalty = cell(row, 'loyalty');
    const whatsappFlyer = cell(row, 'whatsappFlyer') === '1';

    const status = currentSectionStatus === 'DO_NOT_CONTACT' ? 'DO_NOT_CONTACT' : 'HISTORICAL';

    let customerId = customerIdByPhone.get(senderPhone);

    if (!customerId) {
      if (commit) {
        const setOnInsert = {
          phoneNumber: senderPhone,
          name: rawSenderName,
          mode: 'CHATBOT',
          status,
          importedAt: new Date()
        };
        if (senderEmail) setOnInsert.email = senderEmail;

        const result = await customersColl.findOneAndUpdate(
          { phoneNumber: senderPhone },
          {
            $setOnInsert: setOnInsert,
            $addToSet: { sources: 'historical' }
          },
          { upsert: true, returnDocument: 'after', includeResultMetadata: true }
        );
        customerId = result.value._id;
        if (result.lastErrorObject?.upserted) {
          summary.createdNew += 1;
        } else {
          summary.matchedExisting += 1;
        }
      } else {
        const existing = await customersColl.findOne({ phoneNumber: senderPhone });
        if (existing) {
          summary.matchedExisting += 1;
          customerId = existing._id;
        } else {
          summary.createdNew += 1;
          customerId = senderPhone; // placeholder key, dry run only — never written
        }
      }
      customerIdByPhone.set(senderPhone, customerId);
    }

    const dedupeKey = computeDedupeKey(senderPhone, receiverPhone, receiverName, receiverAddress);

    if (commit) {
      const result = await shipmentsColl.updateOne(
        { dedupeKey },
        {
          $setOnInsert: {
            dedupeKey,
            customerId,
            batchNumber: lastBatchNumber || null,
            senderName: rawSenderName,
            senderAddress: cell(row, 'senderAddress'),
            senderPhone,
            senderEmail,
            receiverName,
            receiverAddress,
            receiverPhone,
            receiverEmail,
            loyalty: loyalty || null,
            whatsappFlyer,
            source: 'excel_import',
            importedAt: new Date()
          }
        },
        { upsert: true }
      );
      if (result.upsertedCount > 0) {
        summary.shipmentsLinked += 1;
      }
    } else {
      summary.shipmentsLinked += 1; // optimistic count for the dry-run preview
    }
  }

  return { summary, reviewRows };
}

module.exports = {
  readRowsFromFile,
  readRowsFromBuffer,
  processImportRows
};
