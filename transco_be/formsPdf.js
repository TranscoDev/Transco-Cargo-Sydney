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

let declarationJpg = null;
function declarationBackground() {
  if (!declarationJpg) declarationJpg = fs.readFileSync(path.join(__dirname, 'media', 'forms', 'shipping-declaration.jpg'));
  return declarationJpg;
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
    page.drawImage(png, { x: box.x * MM + (box.w * MM - w) / 2, y: PAGE_H - (box.y + box.h) * MM, width: w, height: h });
  } catch (err) {
    console.error('Signature could not be added to the form:', err.message);
  }
}

/** One booking's Shipping Declaration as PDF bytes. `d` = getDeclarationForPrint(). */
async function shippingDeclarationPdf(d) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Shipping declaration ${d.blNumber ? `BL ${d.blNumber}` : d.bookingCode || ''}`.trim());
  doc.setAuthor('Transco Cargo Sydney');
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
    one(S.mobile.x, S.mobile.y, S.mobile.w, sender.mobile);
    one(S.home.x, S.home.y, S.home.w, sender.homePhone || '');
    one(S.email.x, S.email.y, S.email.w, sender.email);
  }
  if (receiver) {
    flow(R.name, caps(receiver.fullName));
    flow(R.address, caps([receiver.address, receiver.town].filter(Boolean).join(', ')));
    one(R.mobile.x, R.mobile.y, R.mobile.w, receiver.mobile);
    one(R.home.x, R.home.y, R.home.w, receiver.homePhone || '');
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

  return Buffer.from(await doc.save());
}

/** File name staff and the office inbox see, e.g. "Shipping-Declaration-BL-204872.pdf". */
function declarationFileName(d) {
  const ref = d.blNumber ? `BL-${d.blNumber}` : (d.bookingCode || 'booking');
  return `Shipping-Declaration-${String(ref).replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
}

module.exports = { shippingDeclarationPdf, declarationFileName };
