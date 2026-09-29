import { API_BASE_URL } from "./config";
import { getAuthToken, getCurrentUser } from "./auth";

/**
 * "Print declaration" — one booking's declaration form (sender, receiver,
 * contents) as a clean A4 page, from GET /api/my-transco/bookings/:id/declaration
 * (staff only; see getDeclarationForPrint in transco_be/customerTools.js).
 *
 * Bookings made before the declaration moved into the online booking form
 * have no sender/receiver details: those sections print as blank lines to
 * be filled in by hand at the counter.
 */

export interface DeclarationPerson {
  fullName: string;
  address: string;
  mobile: string;
  email: string;
  town?: string;
  idNumber?: string;
}

export interface DeclarationPrintData {
  bookingId: string;
  bookingCode: string | null;
  createdAt: string | null;
  country: string | null;
  service: string | null;
  delivery: string | null;
  destination: string | null;
  items: { label: string; qty: number }[];
  itemsText: string | null;
  boxCount: number | null;
  dropOff: { date: string | null; time: string | null } | null;
  notes: string | null;
  sender: DeclarationPerson | null;
  senderIsAccountHolder: boolean;
  receiver: DeclarationPerson | null;
  declarationSubmittedAt: string | null;
  declarationStatus: "received" | "not_received";
  blNumber: string | null;
  channel: string | null;
  status: string | null;
  customer: { id: string | null; customerCode: string | null; name: string | null; phoneNumber: string | null };
}

export async function fetchDeclaration(bookingId: string): Promise<DeclarationPrintData> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE_URL}/api/my-transco/bookings/${bookingId}/declaration`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; declaration?: DeclarationPrintData };
  if (!res.ok || !data.declaration) throw new Error(data.error || `Could not load the declaration (${res.status})`);
  return data.declaration;
}

/** Official Transco Cargo logo, served publicly by the backend (/media). */
const LOGO_URL = `${API_BASE_URL}/media/transco-logo.png`;

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function personTable(title: string, p: DeclarationPerson | null, withId: boolean, note?: string): string {
  const rows: [string, string | undefined][] = [
    ["Full name (as on passport/NIC)", p?.fullName],
    ["Address", p ? [p.address, p.town].filter(Boolean).join(", ") : undefined],
    ["Mobile", p?.mobile],
    ["Email", p?.email],
  ];
  if (withId) rows.push(["Passport / NIC number", p?.idNumber]);
  return `
    <section>
      <h2>${esc(title)}${note ? ` <span class="note">${esc(note)}</span>` : ""}</h2>
      <table class="kv">
        ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v ? esc(v) : '<span class="fill"></span>'}</td></tr>`).join("")}
      </table>
    </section>`;
}

/** Who printed it and when — fills the office Date line and the footer note. */
export interface PrintInfo {
  printedAt: Date;
  printedBy: string | null;
}

export function declarationHtml(d: DeclarationPrintData, info: PrintInfo = { printedAt: new Date(), printedBy: null }): string {
  const printedDate = info.printedAt.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  const printedTime = info.printedAt.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  const itemRows = d.items.length ? d.items : d.itemsText ? [{ label: d.itemsText, qty: 0 }] : [];
  const blankRows = Math.max(3, 8 - itemRows.length);
  const shipmentRows: [string, string | null][] = [
    ["Booking", d.bookingCode],
    ["Booked on", fmtDate(d.createdAt)],
    ["Destination", [d.destination, d.country].filter(Boolean).join(", ")],
    ["Service", d.service],
    ["Delivery", d.delivery],
    ["Drop-off", d.dropOff ? [fmtDate(d.dropOff.date), d.dropOff.time].filter(Boolean).join(" · ") : null],
    ["BL number", d.blNumber],
    ["Customer", [d.customer.customerCode, d.customer.name, d.customer.phoneNumber ? `+${d.customer.phoneNumber}` : null].filter(Boolean).join(" · ")],
  ];

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<title>Declaration ${esc(d.bookingCode ?? "")}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; }
  .page { max-width: 190mm; margin: 0 auto; padding: 16px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  header .brand { display: flex; align-items: center; gap: 12px; font-size: 16px; font-weight: 800; }
  header .brand img { height: 64px; width: auto; }
  header .brand small { display: block; font-size: 10.5px; font-weight: 400; color: #444; }
  header .doc { text-align: right; }
  header .doc h1 { margin: 0; font-size: 18px; }
  header .doc .code { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
  section { margin-bottom: 14px; break-inside: avoid; }
  h2 { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 6px; }
  h2 .note { text-transform: none; letter-spacing: 0; font-weight: 400; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 5px 8px; text-align: left; vertical-align: top; }
  table.kv th { width: 34%; background: #f3f3f3; font-weight: 600; }
  table.grid2 { table-layout: fixed; }
  table.items th { background: #f3f3f3; }
  table.items td.qty, table.items th.qty { width: 14%; text-align: center; }
  table.items tr.blank td { height: 24px; }
  .fill { display: inline-block; min-width: 60%; min-height: 18px; }
  .status { margin-top: 4px; font-size: 11px; color: #444; }
  .declare { border: 1px solid #999; padding: 8px 10px; margin-bottom: 14px; }
  .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 26px; }
  .signs .sig { font-size: 11px; }
  .signs .sig .val { display: block; height: 20px; line-height: 20px; padding: 0 2px; font-size: 12.5px; font-weight: 600; }
  .signs .sig .lbl { display: block; border-top: 1px solid #111; padding-top: 4px; }
  .printed { margin-top: 10px; font-size: 10.5px; color: #555; text-align: right; }
  .office { margin-top: 18px; border: 1px dashed #777; padding: 8px 10px; font-size: 11px; }
  .office .signs { margin-top: 20px; }
  .toolbar { position: sticky; top: 0; background: #fff; padding: 10px 16px; border-bottom: 1px solid #ddd; display: flex; gap: 8px; justify-content: flex-end; }
  .toolbar button { font: inherit; font-weight: 600; padding: 7px 14px; border-radius: 6px; border: 1px solid #111; background: #111; color: #fff; cursor: pointer; }
  .toolbar button.secondary { background: #fff; color: #111; }
  @media print { .toolbar { display: none; } .page { padding: 0; } }
</style></head>
<body>
  <div class="toolbar"><button class="secondary" onclick="window.close()">Close</button><button onclick="window.print()">Print</button></div>
  <div class="page">
    <header>
      <div class="brand"><img src="${LOGO_URL}" alt="Transco Cargo" /><div>Transco Cargo Sydney<small>Unit 1, 79 Station Road, Seven Hills NSW 2147 · 0434 842 023</small></div></div>
      <div class="doc"><h1>Declaration form</h1><div class="code">${esc(d.bookingCode ?? "—")}</div></div>
    </header>

    <section>
      <h2>Shipment</h2>
      <table class="kv">
        ${shipmentRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v ? esc(v) : '<span class="fill"></span>'}</td></tr>`).join("")}
      </table>
      <div class="status">${
        d.declarationSubmittedAt
          ? `Details submitted online by the customer on ${esc(fmtDate(d.declarationSubmittedAt))}.`
          : "Filled in at the counter."
      }${d.declarationStatus === "received" ? " Checked and marked received by staff." : ""}</div>
    </section>

    ${personTable("Sender", d.sender, false, d.sender && !d.senderIsAccountHolder ? "(sent on behalf of the account holder)" : undefined)}
    ${personTable("Receiver", d.receiver, true)}

    <section>
      <h2>Contents</h2>
      <table class="items">
        <tr><th>Box / item</th><th class="qty">Qty</th><th>Description of contents</th></tr>
        ${itemRows.map((i) => `<tr><td>${esc(i.label)}</td><td class="qty">${i.qty || ""}</td><td></td></tr>`).join("")}
        ${Array.from({ length: blankRows }, () => '<tr class="blank"><td></td><td></td><td></td></tr>').join("")}
      </table>
      ${d.notes ? `<p class="status">Customer note: ${esc(d.notes)}</p>` : ""}
    </section>

    <div class="declare">
      I declare that the details on this form are true and complete, and that the boxes contain only the goods described above.
      <div class="signs"><div class="sig"><span class="val"></span><span class="lbl">Sender's signature</span></div><div class="sig"><span class="val"></span><span class="lbl">Date</span></div></div>
    </div>

    <div class="office">
      <strong>Office use</strong> — boxes received / checked
      <div class="signs"><div class="sig"><span class="val"></span><span class="lbl">Staff name &amp; signature</span></div><div class="sig"><span class="val">${esc(printedDate)}</span><span class="lbl">Date</span></div></div>
    </div>
    <p class="printed">Printed ${esc(printedDate)}, ${esc(printedTime)}${info.printedBy ? ` by ${esc(info.printedBy)}` : ""}</p>
  </div>
</body></html>`;
}

/**
 * Opens the declaration in a new tab ready to print. The tab is opened
 * straight away (inside the click) so pop-up blockers allow it, then
 * filled once the details arrive.
 */
export async function printDeclaration(bookingId: string): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Your browser blocked the print window — allow pop-ups for this site and try again.");
  win.document.write('<p style="font:14px system-ui;padding:24px">Loading declaration…</p>');
  try {
    const data = await fetchDeclaration(bookingId);
    win.document.open();
    win.document.write(declarationHtml(data, { printedAt: new Date(), printedBy: getCurrentUser()?.name ?? null }));
    win.document.close();
    win.focus();
    // Print once the logo has loaded (or after 3s at most), so it never
    // comes out blank.
    const img = win.document.querySelector("img");
    let printed = false;
    const go = () => {
      if (printed) return;
      printed = true;
      win.print();
    };
    if (!img || img.complete) setTimeout(go, 200);
    else {
      img.addEventListener("load", () => setTimeout(go, 100));
      img.addEventListener("error", go);
      setTimeout(go, 3000);
    }
  } catch (err) {
    win.close();
    throw err;
  }
}
