// ============================================================
// FILLED PAPER FORMS (PDF) — Transco's ORIGINAL forms with a booking's
// details printed into their boxes, the way the old Fillout form did.
// One layout, used by both the console's Print button and the office
// email ("Send email"), so the two can never differ.
// ============================================================
//
// The scanned form is the page background (media/forms/*.jpg, with the
// pre-printed serial number whited out); every value is drawn at its box
// in millimetres, measured from the scan.
// - Names, addresses and descriptions print in CAPITALS (block letters).
// - Long text shrinks, or wraps onto the form's next line, to stay inside
//   its box; anything still too long ends with "…" rather than spilling.
// - Missing details (reference no., office figures not entered yet) stay
//   blank to be filled by hand.

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const MM = 72 / 25.4;
const PAGE_W = 210 * MM;
const PAGE_H = 297 * MM;
const INK = rgb(0.07, 0.19, 0.54);
const MIN_SIZE = 5.5;

// Australian mobiles print the local 4-3-3 way (0402 750 571), whether
// stored as 0402750571 or 61402750571. Anything else prints as typed.
function ph(raw) {
  const text = String(raw || '').trim();
  const digits = text.replace(/\D/g, '');
  if (!/^\+?[\d\s()-]+$/.test(text)) return text;
  let au = null;
  if (/^614\d{8}$/.test(digits)) au = `0${digits.slice(2)}`;
  else if (/^04\d{8}$/.test(digits)) au = digits;
  return au ? `${au.slice(0, 4)} ${au.slice(4, 7)} ${au.slice(7)}` : text;
}

let declarationJpg = null;
function declarationBackground() {
  if (!declarationJpg) declarationJpg = fs.readFileSync(path.join(__dirname, 'media', 'forms', 'shipping-declaration.jpg'));
  return declarationJpg;
}

// The other forms are Transco's original (vector) PDFs, used as-is as the
// page background — so they print exactly as designed.
const templateCache = {};
function templateBytes(file) {
  if (!templateCache[file]) templateCache[file] = fs.readFileSync(path.join(__dirname, 'media', 'forms', file));
  return templateCache[file];
}

// Some originals' page box doesn't start at 0,0 (the UPB form's starts at
// -9,-9) — the form is drawn shifted back by that, so the measured
// positions (from the page's top-left corner) line up.
const boxCache = {};
async function templateBox(file) {
  if (!boxCache[file]) {
    const src = await PDFDocument.load(templateBytes(file));
    boxCache[file] = src.getPage(0).getMediaBox();
  }
  return boxCache[file];
}

/** A new page in `doc` with the original form `file` as its background. */
async function formPage(doc, file) {
  const box = await templateBox(file);
  const [tpl] = await doc.embedPdf(templateBytes(file));
  const page = doc.addPage([box.width, box.height]);
  page.drawPage(tpl, { x: -box.x, y: -box.y, width: tpl.width, height: tpl.height });
  return page;
}

// The standard PDF font only has Western characters — swap the common
// typographic ones and replace anything else, so a stray character never
// stops a form from printing.
function printable(text) {
  return String(text ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7E -ÿ]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}
const caps = s => printable(s).toUpperCase();

/** DD/MM/YYYY, Australian style (Sydney time). */
function dmy(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+10:00` : value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function money(n) {
  if (typeof n !== 'number') return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function createWriter(page, font) {
  const PAGE_H = page.getHeight();
  const width = (text, size) => font.widthOfTextAtSize(text, size) * 1.02;

  // Greedy word wrap across the given line widths.
  function layout(words, widths, size) {
    const lines = [];
    let i = 0;
    for (let l = 0; l < widths.length; l++) {
      let line = '';
      while (i < words.length) {
        const next = line ? `${line} ${words[i]}` : words[i];
        if (width(next, size) <= widths[l]) { line = next; i++; } else if (!line) { line = words[i]; i++; break; } else break;
      }
      lines.push(line);
    }
    return { lines, fits: i >= words.length && lines.every((t, n) => width(t, size) <= widths[n]) };
  }

  /** Writes text across one or more lines ({ x, y, w } in mm; y = centre). */
  function flow(lines, text, { size = 10, align = 'left' } = {}) {
    const clean = printable(text);
    if (!clean) return;
    const widths = lines.map(l => l.w * MM);
    const words = clean.split(' ');
    let s = size;
    let result = layout(words, widths, s);
    while (!result.fits && s > MIN_SIZE) { s -= 0.25; result = layout(words, widths, s); }
    if (!result.fits) {
      const last = result.lines.length - 1;
      while (result.lines[last] && width(`${result.lines[last]} ...`, s) > widths[last]) result.lines[last] = result.lines[last].replace(/\s*\S+$/, '');
      result.lines[last] = `${result.lines[last] || ''} ...`.trim();
    }
    result.lines.forEach((t, n) => {
      if (!t) return;
      const l = lines[n];
      const w = width(t, s);
      const x = align === 'center' ? l.x * MM + (widths[n] - w) / 2 : align === 'right' ? l.x * MM + widths[n] - w : l.x * MM;
      page.drawText(t, { x, y: PAGE_H - l.y * MM - s * 0.35, size: s, font, color: INK });
    });
  }

  const one = (x, y, w, text, opts) => flow([{ x, y, w }], text, opts);

  /** A hand-style tick centred on (x, y) mm. */
  function tick(x, y) {
    const p = (dx, dy) => ({ x: (x + dx) * MM, y: PAGE_H - (y + dy) * MM });
    page.drawLine({ start: p(-1.5, 0.1), end: p(-0.4, 1.3), thickness: 1.4, color: INK });
    page.drawLine({ start: p(-0.4, 1.3), end: p(1.7, -1.7), thickness: 1.4, color: INK });
  }

  return { flow, one, tick };
}

// ---------- Shipping Declaration (Personal Cargo) ----------

// Sender / receiver writing lines (the "/ / / /" rows on the form).
const S = {
  name: [{ x: 26, y: 44.7, w: 103 }, { x: 26, y: 50.2, w: 103 }, { x: 26, y: 55.3, w: 103 }],
  address: [{ x: 23, y: 63.1, w: 106 }, { x: 23, y: 68.8, w: 106 }],
  mobile: { x: 26, y: 73.6, w: 39 },
  home: { x: 80, y: 73.6, w: 49 },
  email: { x: 26, y: 78.9, w: 103 }
};
const R = {
  name: [{ x: 26, y: 86.7, w: 103 }, { x: 26, y: 91.9, w: 103 }, { x: 26, y: 97.0, w: 103 }],
  address: [{ x: 23, y: 105.2, w: 106 }, { x: 23, y: 111.0, w: 106 }],
  mobile: { x: 26, y: 116.9, w: 39 },
  home: { x: 80, y: 116.9, w: 49 },
  email: { x: 26, y: 122.4, w: 103 },
  id: { x: 33, y: 128.1, w: 96 }
};
// Contents table: 8 rows between these lines, then the TOTAL row.
const ROW_LINES = [145.7, 152.5, 159.4, 166.3, 173.2, 180.0, 186.9, 193.8, 200.7];
const ROW_CENTRES = ROW_LINES.slice(0, -1).map((top, i) => (top + ROW_LINES[i + 1]) / 2);
const COL = { no: [32.2, 46.6], type: [46.6, 65.4], desc: [65.4, 114.3], weight: [114.3, 130.8], cbm: [130.8, 160.2] };
const TOTAL_Y = 203.5;
// "Package Sizes/Type" checkbox centres (y 209.2).
const PACKAGE_TICK_X = { quarter_cbm: 93.9, tea_chest: 111.8, gift_box: 134.5, wine_box: 150.8, other: 167.1 };

function contentsSummary(d) {
  if (d.contents && d.contents.length) {
    return d.contents.map(c => `${c.description}${c.condition === 'used' ? ' (used)' : ''}`).join(', ');
  }
  return d.notes || '';
}

async function drawSignature(doc, page, image, box) {
  const m = /^data:image\/png;base64,(.+)$/.exec(image || '');
  if (!m) return;
  try {
    const png = await doc.embedPng(Buffer.from(m[1], 'base64'));
    const scale = Math.min((box.w * MM) / png.width, (box.h * MM) / png.height);
    const w = png.width * scale;
    const h = png.height * scale;
    page.drawImage(png, { x: box.x * MM + (box.w * MM - w) / 2, y: page.getHeight() - (box.y + box.h) * MM, width: w, height: h });
  } catch (err) {
    console.error('Signature could not be added to the form:', err.message);
  }
}

/** One booking's Shipping Declaration as PDF bytes. `d` = getDeclarationForPrint(). */
async function shippingDeclarationPdf(d) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Shipping declaration ${d.blNumber ? `BL ${d.blNumber}` : d.bookingCode || ''}`.trim());
  doc.setAuthor('Transco Cargo Sydney');
  await addShippingDeclaration(doc, d);
  return Buffer.from(await doc.save());
}

async function addShippingDeclaration(doc, d) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const bg = await doc.embedJpg(declarationBackground());
  page.drawImage(bg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const { flow, one, tick } = createWriter(page, font);

  const sender = d.sender;
  const receiver = d.receiver;
  const signedName = (d.signature && d.signature.name) || (sender && sender.fullName) || '';
  const signedDate = (d.signature && d.signature.signedAt) || d.declarationSubmittedAt;

  // Select service.
  if (d.serviceKey === 'sea') tick(116.9, 21.6);
  if (d.serviceKey === 'air') tick(116.9, 28.9);

  if (sender) {
    flow(S.name, caps(sender.fullName));
    flow(S.address, caps(sender.address));
    one(S.mobile.x, S.mobile.y, S.mobile.w, ph(sender.mobile));
    one(S.home.x, S.home.y, S.home.w, ph(sender.homePhone));
    one(S.email.x, S.email.y, S.email.w, sender.email);
  }
  if (receiver) {
    flow(R.name, caps(receiver.fullName));
    flow(R.address, caps([receiver.address, receiver.town].filter(Boolean).join(', ')));
    one(R.mobile.x, R.mobile.y, R.mobile.w, ph(receiver.mobile));
    one(R.home.x, R.home.y, R.home.w, ph(receiver.homePhone));
    one(R.email.x, R.email.y, R.email.w, receiver.email);
    one(R.id.x, R.id.y, R.id.w, caps(receiver.idNumber));
  }

  // Packages: one row per box type; the description of what's inside
  // flows down the Description column.
  (d.items || []).slice(0, ROW_CENTRES.length).forEach((item, i) => {
    one(COL.no[0], ROW_CENTRES[i], COL.no[1] - COL.no[0], String(item.qty), { align: 'center' });
    one(COL.type[0] + 1, ROW_CENTRES[i], COL.type[1] - COL.type[0] - 2, caps(item.label), { size: 9 });
  });
  if (!(d.items || []).length && d.itemsText) {
    one(COL.type[0] + 1, ROW_CENTRES[0], COL.type[1] - COL.type[0] - 2, caps(d.itemsText), { size: 9 });
  }
  flow(ROW_CENTRES.map(y => ({ x: COL.desc[0] + 1, y, w: COL.desc[1] - COL.desc[0] - 2 })), caps(contentsSummary(d)), { size: 9 });

  // TOTAL row: packages, weight, CBM.
  const totalPackages = d.boxCount || (d.items || []).reduce((n, i) => n + i.qty, 0) || null;
  if (totalPackages) one(COL.no[0], TOTAL_Y, COL.no[1] - COL.no[0], String(totalPackages), { align: 'center' });
  if (typeof d.weight === 'number') one(COL.weight[0], TOTAL_Y, COL.weight[1] - COL.weight[0], money(d.weight), { align: 'center' });
  if (typeof d.cbm === 'number') one(COL.cbm[0], TOTAL_Y, COL.cbm[1] - COL.cbm[0], money(d.cbm), { align: 'center' });

  // Package Sizes/Type ticks.
  const ticked = new Set((d.items || []).map(i => (PACKAGE_TICK_X[i.type] !== undefined ? i.type : 'other')));
  for (const key of ticked) tick(PACKAGE_TICK_X[key], 209.2);

  // Insured? Y / N.  Door delivery at destination? Yes.
  if (d.insurance === true) tick(169.2, 216.7);
  if (d.insurance === false) tick(178.6, 216.7);
  if (d.deliveryKey === 'door') tick(144.7, 229.2);

  // Office use.
  const o = d.officeUse;
  if (o) {
    const box = (x0, x1, n) => { if (typeof n === 'number') one(x0, 228.1, x1 - x0, money(n), { align: 'center' }); };
    box(6.8, 21.9, o.freight);
    box(26.8, 42.2, o.pickup);
    box(46.3, 61.7, o.doorToDoor);
    box(65.6, 80.9, o.discount);
    box(84.8, 100.2, o.total);
  }
  one(36, 235.3, 62, caps(d.collectionCentre));
  one(19, 241.1, 79, caps(d.blNumber));

  // Remarks: our form number + pickup/delivery (as the old form did).
  const remark = [
    d.bookingCode,
    d.deliveryKey === 'collect' ? 'Pickup from the destination warehouse' : d.deliveryKey === 'door' ? 'Door delivery' : null
  ].filter(Boolean).join(' - ');
  flow([{ x: 9, y: 253.8, w: 88 }, { x: 9, y: 258.0, w: 88 }], remark, { size: 9 });

  // Declarant: name (two short lines), signature, date.
  flow([{ x: 104.5, y: 244.9, w: 32 }, { x: 104.5, y: 248.0, w: 32 }], caps(signedName), { size: 8, align: 'center' });
  if (d.signature && d.signature.image) await drawSignature(doc, page, d.signature.image, { x: 141, y: 241.6, w: 31, h: 7.8 });
  one(178, 247.6, 20, dmy(signedDate), { size: 9, align: 'center' });

  // Bottom receipt slip: BL No / Date.
  one(117, 283.4, 24, caps(d.blNumber), { size: 9 });
  one(117, 290.9, 24, dmy(signedDate || d.createdAt), { size: 9 });
}

// ---------- shared bits for the other forms ----------

const signedDateOf = d => (d.signature && d.signature.signedAt) || d.declarationSubmittedAt || d.createdAt;
const signedNameOf = d => (d.signature && d.signature.name) || (d.sender && d.sender.fullName) || '';
const itemLine = c => `${c.description} - ${c.condition === 'used' ? 'used' : 'new'}`;
const valueText = v => (typeof v === 'number' ? `$${money(v)}` : '');
const phones = p => [p.mobile, p.homePhone].filter(Boolean).map(ph).join(' / ');
function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length ? out : [[]];
}

// ---------- UPB / Gift Cargo Declaration (Sri Lanka Customs) ----------
// Staff-use form ("TRANSCO USE ONLY"), filled from the customer's details
// and item list with staff's values. Package No is left blank. More than
// 20 items continue on another copy of the form, as the form itself says.

const UPB_FILE = 'upb-gift-declaration-sl.pdf';
const UPB_ROWS = 20;
const UPB_ROW_TOP = 106.7;
const UPB_ROW_H = (239.1 - 106.7) / UPB_ROWS;
// The printed form numbers its rows ...9, 11, 10, 12... — so item 10 goes
// on the row printed "10." and item 11 on the row printed "11.".
const UPB_ROW_FOR_ITEM = n => (n === 10 ? 10 : n === 11 ? 9 : n - 1);

async function addUpbGiftDeclaration(doc, d) {
  const contents = d.contents || [];
  const pages = chunks(contents, UPB_ROWS);
  for (let p = 0; p < pages.length; p++) {
    const page = await formPage(doc, UPB_FILE);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const { flow, one } = createWriter(page, font);
    const s = d.sender || {};
    const r = d.receiver || {};
    const X = 50;
    const W = 149;
    // Sender, then receiver (name / address / PP-NIC / contact).
    one(X, 39.2, W, caps(s.fullName));
    one(X, 46.2, W, caps(s.address), { size: 9 });
    one(X, 52.2, W, caps(s.idNumber));
    one(X, 58.2, W, [phones(s), s.email].filter(Boolean).join('   '), { size: 9 });
    one(X, 73.2, W, caps(r.fullName));
    one(X, 80.2, W, caps([r.address, r.town].filter(Boolean).join(', ')), { size: 9 });
    one(X, 86.2, W, caps(r.idNumber));
    one(X, 93.2, W, [phones(r), r.email].filter(Boolean).join('   '), { size: 9 });

    // Items (description - new/used, quantity, value).
    pages[p].forEach((c, i) => {
      const itemNo = i + 1;
      const y = UPB_ROW_TOP + UPB_ROW_H * (UPB_ROW_FOR_ITEM(itemNo) + 0.5);
      one(46, y, 105, caps(itemLine(c)), { size: 9 });
      one(152.6, y, 23.6, String(c.qty), { align: 'center', size: 9 });
      one(176.2, y, 23.5, valueText(c.value), { align: 'center', size: 9 });
    });

    // Total number of packages + the sender's certification.
    const totalPackages = d.boxCount || (d.items || []).reduce((n, i) => n + i.qty, 0) || null;
    if (totalPackages) one(60, 244.6, 40, String(totalPackages));
    if (d.signature && d.signature.image) await drawSignature(doc, page, d.signature.image, { x: 18, y: 250.6, w: 52, h: 7 });
    // Name, PP/NIC — one line just above its dotted line (the box runs to 108 mm).
    one(17, 268.3, 89, caps([signedNameOf(d), s.idNumber].filter(Boolean).join(', ')), { size: 7.5 });
    one(17, 279.1, 55, `${dmy(signedDateOf(d))}, SYDNEY`, { size: 7 });

    // Certification by the agent — staff's own figures, when entered.
    if (totalPackages) one(139, 259.6, 31, String(totalPackages), { size: 9 });
    if (typeof d.weight === 'number') one(139, 265.6, 31, `${money(d.weight)} kg`, { size: 9 });
    if (typeof d.cbm === 'number') one(139, 271.6, 31, `${money(d.cbm)} CBM`, { size: 9 });

    if (pages.length > 1) one(150, 294.5, 50, `Sheet ${p + 1} of ${pages.length}`, { size: 8, align: 'right' });
  }
}

// ---------- Door / Station Delivery Agreement (Sri Lanka) ----------
// Printed for every Sri Lanka booking (their usual process); "Door
// Delivery" is ticked only when they chose door delivery. Station
// delivery isn't offered yet, so that part stays blank.

const DA_FILE = 'delivery-agreement.pdf';
const DA_PACKAGE_BOX = { tea_chest: [41, 152.1], quarter_cbm: [41.1, 159.7], gift_box: [85.8, 159.8], other: [131.5, 159.8] };

async function addDeliveryAgreement(doc, d) {
  const page = await formPage(doc, DA_FILE);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const { flow, one, tick } = createWriter(page, font);
  const s = d.sender || {};
  const r = d.receiver || {};

  if (d.deliveryKey === 'door') tick(44.2, 27.9);
  one(34, 34.9, 53, caps(r.fullName), { size: 9 });
  // Receiver's address — and the town, which is how the destination agent finds them.
  flow([{ x: 14, y: 72.0, w: 172 }, { x: 14, y: 81.5, w: 172 }, { x: 14, y: 91.0, w: 172 }], caps([r.address, r.town].filter(Boolean).join(', ')), { size: 10 });
  one(28, 109.2, 59, ph(r.homePhone), { size: 9 });
  one(118.5, 109.2, 51, ph(r.mobile), { size: 9 });

  one(33, 124.0, 59, caps(s.fullName), { size: 9 });
  one(28.5, 132.8, 65, ph(s.homePhone), { size: 9 });
  one(118, 132.8, 51, ph(s.mobile), { size: 9 });

  // No of Packages, by type.
  const counts = {};
  for (const i of d.items || []) {
    const key = DA_PACKAGE_BOX[i.type] ? i.type : 'other';
    counts[key] = (counts[key] || 0) + i.qty;
  }
  for (const [key, n] of Object.entries(counts)) {
    const [x, y] = DA_PACKAGE_BOX[key];
    one(x - 5, y, 10, String(n), { align: 'center', size: 10 });
  }

  // "I, ____ shipper, authorise…"
  one(10, 169.6, 53, caps(s.fullName), { size: 8 });

  // Office use: shipping / transport charges, BL No, remarks.
  const o = d.officeUse || {};
  if (typeof o.freight === 'number') one(43, 236.2, 16.5, money(o.freight), { align: 'center', size: 9 });
  if (typeof o.doorToDoor === 'number') one(75, 236.2, 16.5, money(o.doorToDoor), { align: 'center', size: 9 });
  one(21, 247.3, 27.5, caps(d.blNumber), { size: 9 });
  flow([{ x: 12, y: 265.0, w: 81 }, { x: 12, y: 270.5, w: 81 }],
    [d.bookingCode, d.deliveryKey === 'collect' ? 'Pickup from the destination warehouse' : 'Door delivery'].filter(Boolean).join(' - '), { size: 8 });

  // Shipper: name, signature, date.
  one(104.5, 248.6, 49.5, caps(signedNameOf(d)), { size: 9, align: 'center' });
  if (d.signature && d.signature.image) await drawSignature(doc, page, d.signature.image, { x: 110, y: 258.4, w: 38, h: 8 });
  one(165, 264.8, 20.5, dmy(signedDateOf(d)), { size: 9, align: 'center' });
}

// ---------- Packing List (India) ----------
// Shipper, consignee and one row per item (number, item, value). More than
// 28 items continue on another copy.

const PL_FILE = 'packing-list-india.pdf';
const PL_ROWS = 28;
const PL_ROW_TOP = 106.9;
const PL_ROW_H = (252.6 - 106.9) / PL_ROWS;

async function addPackingListIndia(doc, d) {
  const pages = chunks(d.contents || [], PL_ROWS);
  for (let p = 0; p < pages.length; p++) {
    const page = await formPage(doc, PL_FILE);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const { one } = createWriter(page, font);
    const person = (q, top) => {
      if (!q) return;
      one(67, top, 113, caps(q.fullName), { size: 9 });
      one(67, top + 4.5, 113, caps([q.address, q.town].filter(Boolean).join(', ')), { size: 8 });
      one(67, top + 9, 113, `Tel: ${phones(q)}`, { size: 8 });
      one(67, top + 13.5, 113, q.email || '', { size: 8 });
    };
    one(114, 47.2, 40, dmy(signedDateOf(d)), { size: 10 });
    person(d.sender, 54.6);
    person(d.receiver, 74.9);
    pages[p].forEach((c, i) => {
      const y = PL_ROW_TOP + PL_ROW_H * (i + 0.5);
      one(29.1, y, 20.3, String(c.qty), { align: 'center', size: 9 });
      one(51, y, 101, caps(itemLine(c)), { size: 9 });
      one(153.8, y, 27.2, valueText(c.value), { align: 'center', size: 9 });
    });
    if (pages.length > 1) one(150, 290, 50, `Sheet ${p + 1} of ${pages.length}`, { size: 8, align: 'right' });
  }
}

// ---------- Dangerous & Restricted Goods Checklist (Air Freight) ----------
// The customer's answers: all five "NO …" lines ticked, Yes/No for
// medications, lithium batteries and liquids (with type and quantity),
// then their name, signature and date.

const DG_FILE = 'dangerous-goods-checklist.pdf';

async function addDangerousGoodsChecklist(doc, d) {
  const page = await formPage(doc, DG_FILE);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const { flow, one, tick } = createWriter(page, font);
  const dg = d.dangerousGoods || null;
  if (dg) {
    // Only the lines the customer confirmed are ticked (true to what they said).
    const confirmed = Array.isArray(dg.notInBoxes) ? dg.notInBoxes : new Array(5).fill(Boolean(dg.noProhibited));
    [58.5, 68.55, 78.55, 88.55, 100.3].forEach((y, i) => { if (confirmed[i]) tick(43.6, y); });
    const yn = (value, noX, yesX, y) => { if (value === true) tick(yesX, y); else if (value === false) tick(noX, y); };
    yn(dg.medications, 125.85, 144.75, 130.7);
    yn(dg.lithium, 125.75, 145.05, 152.0);
    yn(dg.liquids, 126.45, 144.8, 178.65);
    if (dg.lithium && dg.lithiumDetails) flow([{ x: 131, y: 159.6, w: 36 }, { x: 33.5, y: 168.6, w: 133.5 }], caps(dg.lithiumDetails), { size: 9 });
    if (dg.liquids && dg.liquidsDetails) flow([{ x: 131, y: 186.6, w: 36 }, { x: 33.5, y: 195.6, w: 133.5 }], caps(dg.liquidsDetails), { size: 9 });
  }
  one(25.7, 251.4, 47.5, caps(signedNameOf(d)), { size: 8, align: 'center' });
  if (d.signature && d.signature.image) await drawSignature(doc, page, d.signature.image, { x: 90, y: 245.2, w: 44, h: 7.8 });
  one(142.8, 251.4, 29.8, dmy(signedDateOf(d)), { size: 9, align: 'center' });
}

// ---------- Lithium battery transport document (Air, staff) ----------
// For Air Freight bookings where the customer said lithium batteries are
// attached to products. Staff tick the configuration and the phone.

const LI_FILE = 'lithium-battery-document.pdf';
const LI_BOX = {
  ion_965_ii: [25.8, 127.4], ion_965_ib: [25.7, 170.5], ion_966_ii: [25.7, 191.8], ion_967_ii: [26.1, 215.0],
  metal_968_ii: [111.9, 127.4], metal_968_ib: [111.9, 170.65], metal_969_ii: [111.9, 192.1], metal_970_ii: [111.9, 216.4]
};

async function addLithiumDocument(doc, d) {
  const page = await formPage(doc, LI_FILE);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const { one, tick } = createWriter(page, font);
  const s = d.sender || {};
  const r = d.receiver || {};
  one(55, 31.2, 137, caps(d.blNumber), { size: 10 });
  const block = (q, x, w, labelEnd) => {
    one(labelEnd, 37.65, x + w - labelEnd, caps(q.fullName), { size: 9 });
    one(x, 43.45, w, caps(q.address), { size: 8 });
    one(x, 49.15, w, caps([q.town, q === r ? d.country : 'Australia'].filter(Boolean).join(', ')), { size: 8 });
    one(x, 54.85, w, phones(q), { size: 8 });
  };
  block(s, 21, 85, 35);
  block(r, 108.5, 84, 126);
  const li = d.lithiumDoc || {};
  for (const key of li.configs || []) if (LI_BOX[key]) tick(LI_BOX[key][0], LI_BOX[key][1]);
  one(22, 261.4, 114, ph(li.phone || s.mobile), { size: 9 });
  one(147, 261.4, 40, dmy(signedDateOf(d)), { size: 9 });
}

// ---------- which forms a booking gets ----------

/** The forms for this booking, in print order (one PDF each). */
function formsFor(d) {
  const list = [{ key: 'declaration', title: 'Shipping Declaration', add: addShippingDeclaration }];
  if (d.countryKey === 'sri_lanka') {
    list.push({ key: 'upb', title: 'UPB Gift Cargo Declaration', add: addUpbGiftDeclaration, file: 'upb-gift-declaration-sl.pdf' });
    list.push({ key: 'delivery', title: 'Delivery Agreement', add: addDeliveryAgreement, file: 'delivery-agreement.pdf' });
  } else if (d.countryKey === 'india') {
    list.push({ key: 'packing', title: 'Packing List', add: addPackingListIndia, file: 'packing-list-india.pdf' });
  }
  // Air Freight: the dangerous goods checklist, and the lithium battery
  // document when the customer said there are lithium batteries.
  if (d.serviceKey === 'air') {
    list.push({ key: 'dangerous', title: 'Dangerous Goods Checklist', add: addDangerousGoodsChecklist, file: 'dangerous-goods-checklist.pdf' });
    if (d.dangerousGoods && d.dangerousGoods.lithium) list.push({ key: 'lithium', title: 'Lithium Battery Document', add: addLithiumDocument, file: 'lithium-battery-document.pdf' });
  }
  // The original PDFs aren't in git (copied onto the server by hand). If one
  // is missing, that form is left out rather than breaking every print.
  return list.filter(f => !f.file || templateExists(f.file));
}

const existsCache = {};
function templateExists(file) {
  if (!(file in existsCache)) {
    existsCache[file] = fs.existsSync(path.join(__dirname, 'media', 'forms', file));
    if (!existsCache[file]) console.warn(`[forms] media/forms/${file} is missing — that form is skipped`);
  }
  return existsCache[file];
}

function refOf(d) {
  return String(d.blNumber ? `BL-${d.blNumber}` : (d.bookingCode || 'booking')).replace(/[^A-Za-z0-9-]/g, '');
}

/** File name staff and the office inbox see, e.g. "Shipping-Declaration-BL-204872.pdf". */
function declarationFileName(d) {
  return `Shipping-Declaration-${refOf(d)}.pdf`;
}

/** Every form for the booking in one PDF — what "Print forms" opens. */
async function allFormsPdf(d) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Transco forms ${refOf(d)}`);
  doc.setAuthor('Transco Cargo Sydney');
  for (const f of formsFor(d)) await f.add(doc, d);
  return Buffer.from(await doc.save());
}

/** One of the booking's forms on its own (key from formsFor), or null. */
async function singleFormPdf(d, key) {
  const f = formsFor(d).find(x => x.key === key);
  if (!f) return null;
  const doc = await PDFDocument.create();
  doc.setTitle(`${f.title} ${refOf(d)}`);
  doc.setAuthor('Transco Cargo Sydney');
  await f.add(doc, d);
  return { filename: `${f.title.replace(/[^A-Za-z0-9]+/g, '-')}-${refOf(d)}.pdf`, content: Buffer.from(await doc.save()) };
}

/** Each form as its own PDF — what "Send email" attaches. */
async function formAttachments(d) {
  const out = [];
  for (const f of formsFor(d)) {
    const doc = await PDFDocument.create();
    doc.setTitle(`${f.title} ${refOf(d)}`);
    doc.setAuthor('Transco Cargo Sydney');
    await f.add(doc, d);
    out.push({ filename: `${f.title.replace(/[^A-Za-z0-9]+/g, '-')}-${refOf(d)}.pdf`, content: Buffer.from(await doc.save()) });
  }
  return out;
}

module.exports = { shippingDeclarationPdf, declarationFileName, allFormsPdf, formAttachments, singleFormPdf, formsFor, refOf };
