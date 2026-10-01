import { API_BASE_URL } from "./config";
import { getAuthToken } from "./auth";

/**
 * A booking's declaration: the details (GET /api/my-transco/bookings/:id/
 * declaration — staff only; see getDeclarationForPrint in
 * transco_be/customerTools.js), the filled ORIGINAL paper form as a PDF
 * (GET /api/forms/:id/declaration.pdf — see transco_be/formsPdf.js), and
 * "Send email" (the forms to the office inbox, once the BL is assigned).
 *
 * The PDF is made by the backend so the printout and the emailed forms
 * are always the same thing: Transco's real Shipping Declaration with each
 * detail in its box — names/addresses in capitals, long text wrapped to
 * fit, the drawn signature, and blanks left for anything to fill by hand.
 */

export interface DeclarationPerson {
  fullName: string;
  address: string;
  mobile: string;
  email: string;
  town?: string;
  idNumber?: string;
  homePhone?: string;
}

export interface DeclarationContentRow {
  description: string;
  condition: "new" | "used";
  qty: number;
  /** Staff-entered at Confirm (the customer never enters values). */
  value: number | null;
}

export interface DeclarationPrintData {
  bookingId: string;
  bookingCode: string | null;
  createdAt: string | null;
  country: string | null;
  service: string | null;
  delivery: string | null;
  countryKey: string | null;
  serviceKey: string | null;
  deliveryKey: string | null;
  destination: string | null;
  items: { type: string; label: string; qty: number }[];
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
  contents: DeclarationContentRow[];
  insurance: boolean | null;
  signature: { name: string | null; image: string | null; signedAt: string | null } | null;
  weight: number | null;
  cbm: number | null;
  officeUse: { freight: number | null; pickup: number | null; doorToDoor: number | null; discount: number | null; total: number | null } | null;
  collectionCentre: string | null;
  walkIn: {
    status: "submitted" | "finalised";
    submittedAt: string | null;
    finalisedAt: string | null;
    finalisedBy: string | null;
    returning: boolean;
  } | null;
  /** Staff confirmation at drop-off (values + BL) — walk-ins and bookings with a full online declaration. */
  confirm: { status: "submitted" | "finalised"; finalisedAt: string | null; finalisedBy: string | null } | null;
  /** "Send email" history (office inbox), oldest first. */
  formEmails: { at: string; by: string | null }[];
  customer: { id: string | null; customerCode: string | null; name: string | null; phoneNumber: string | null };
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchDeclaration(bookingId: string): Promise<DeclarationPrintData> {
  const res = await fetch(`${API_BASE_URL}/api/my-transco/bookings/${bookingId}/declaration`, { headers: authHeaders() });
  const data = (await res.json().catch(() => ({}))) as { error?: string; declaration?: DeclarationPrintData };
  if (!res.ok || !data.declaration) throw new Error(data.error || `Could not load the declaration (${res.status})`);
  // Older backends / bookings: make the newer fields safe to read.
  const d = data.declaration;
  return {
    ...d,
    items: d.items ?? [],
    contents: d.contents ?? [],
    insurance: d.insurance ?? null,
    signature: d.signature ?? null,
    weight: d.weight ?? null,
    cbm: d.cbm ?? null,
    officeUse: d.officeUse ?? null,
    collectionCentre: d.collectionCentre ?? null,
    walkIn: d.walkIn ?? null,
    formEmails: d.formEmails ?? [],
    confirm: d.confirm ?? null,
    countryKey: d.countryKey ?? null,
    serviceKey: d.serviceKey ?? null,
    deliveryKey: d.deliveryKey ?? null,
  };
}

/**
 * Opens the filled form (PDF) in a new tab, where staff print it. The tab
 * is opened straight away (inside the click) so pop-up blockers allow it,
 * then shows the PDF once it has downloaded.
 */
export async function printDeclaration(bookingId: string): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Your browser blocked the print window — allow pop-ups for this site and try again.");
  win.document.write('<p style="font:14px system-ui;padding:24px">Loading the declaration form…</p>');
  try {
    const res = await fetch(`${API_BASE_URL}/api/forms/${bookingId}/declaration.pdf`, { headers: authHeaders() });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Could not make the form (${res.status})`);
    }
    const url = URL.createObjectURL(await res.blob());
    win.location.href = url;
    win.focus();
    // The tab keeps its own copy; free ours after it has loaded.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    win.close();
    throw err;
  }
}

/** "Send email": the filled forms to the office inbox (never the customer). */
export async function sendFormsEmail(bookingId: string): Promise<{ sentAt: string; to: string }> {
  const res = await fetch(`${API_BASE_URL}/api/forms/${bookingId}/send-email`, {
    method: "POST",
    headers: authHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; sentAt?: string; to?: string };
  if (!res.ok || !data.sentAt) throw new Error(data.error || `Could not send the email (${res.status})`);
  return { sentAt: data.sentAt, to: data.to ?? "" };
}
