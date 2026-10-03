import { API_BASE_URL } from "./config";
import { getAuthToken } from "./auth";

/**
 * A booking's declaration: the details (GET /api/my-transco/bookings/:id/
 * declaration — staff only; see getDeclarationForPrint in
 * transco_be/customerTools.js), the filled ORIGINAL paper form as a PDF
 * (GET /api/forms/:id/forms.pdf — every form the booking gets: the
 * declaration, plus the UPB customs form and delivery agreement for Sri
 * Lanka or the packing list for India; see transco_be/formsPdf.js), and
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

export interface DangerousGoods {
  /** True only when all five "NO …" lines were ticked. */
  noProhibited: boolean;
  /** Each "NO …" line: true = confirmed not in the boxes, false = may be in them (staff to check). */
  notInBoxes?: boolean[];
  medications: boolean;
  lithium: boolean;
  lithiumDetails: string;
  liquids: boolean;
  liquidsDetails: string;
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
  items: { type: string; label: string; qty: number; sizes?: string[]; dims?: { l: number; w: number; h: number }[] }[];
  itemsText: string | null;
  boxCount: number | null;
  dropOff: { date: string | null; time: string | null } | null;
  /** Staff costing: cost lines, discount and total (the total is also the booking's price). */
  costing: BookingCosting | null;
  /** "pickup" = home pickup (the customer calls Sajith to arrange it). */
  handover: "dropoff" | "pickup" | null;
  pickupNote: string | null;
  notes: string | null;
  sender: DeclarationPerson | null;
  senderIsAccountHolder: boolean;
  receiver: DeclarationPerson | null;
  declarationSubmittedAt: string | null;
  declarationStatus: "received" | "not_received";
  blNumber: string | null;
  /** The customer's BL record, and which shipment (container) it's in. */
  shipmentId: string | null;
  batchNumber: number | null;
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
  /** Air Freight: the customer's Dangerous Goods Checklist answers. */
  dangerousGoods: DangerousGoods | null;
  /** Air Freight + lithium: the configuration staff chose for the transport document. */
  lithiumDoc: { configs: string[]; phone: string } | null;
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
    shipmentId: d.shipmentId ?? null,
    batchNumber: d.batchNumber ?? null,
    confirm: d.confirm ?? null,
    dangerousGoods: d.dangerousGoods ?? null,
    lithiumDoc: d.lithiumDoc ?? null,
    countryKey: d.countryKey ?? null,
    serviceKey: d.serviceKey ?? null,
    deliveryKey: d.deliveryKey ?? null,
    handover: d.handover ?? null,
    pickupNote: d.pickupNote ?? null,
    costing: d.costing ?? null,
  };
}

export interface BookingCosting {
  lines: { label: string; amount: number }[];
  discount: number;
  total: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Saves the booking's costing (lines + discount); the server works out the total. */
export async function saveCosting(bookingId: string, body: { lines: { label: string; amount: number }[]; discount: number }): Promise<BookingCosting> {
  const res = await fetch(`${API_BASE_URL}/api/my-transco/bookings/${bookingId}/costing`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; costing?: BookingCosting };
  if (!res.ok || !data.costing) throw new Error(data.error || `Could not save the costing (${res.status})`);
  return data.costing;
}

/**
 * Opens the filled form (PDF) in a new tab, where staff print it. The tab
 * is opened straight away (inside the click) so pop-up blockers allow it,
 * then shows the PDF once it has downloaded.
 */
export async function printDeclaration(bookingId: string): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Your browser blocked the print window — allow pop-ups for this site and try again.");
  win.document.write('<p style="font:14px system-ui;padding:24px">Loading the forms…</p>');
  try {
    const res = await fetch(`${API_BASE_URL}/api/forms/${bookingId}/forms.pdf`, { headers: authHeaders() });
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

/** A form this booking gets (key used by fetchFormPdf). */
export interface BookingForm {
  key: string;
  title: string;
}

/** Which forms this booking gets — Sri Lanka: declaration, UPB, delivery agreement; India: declaration, packing list. */
export async function fetchFormsList(bookingId: string): Promise<BookingForm[]> {
  const res = await fetch(`${API_BASE_URL}/api/forms/${bookingId}/list`, { headers: authHeaders() });
  const data = (await res.json().catch(() => ({}))) as { error?: string; forms?: BookingForm[] };
  if (!res.ok || !data.forms) throw new Error(data.error || `Could not load the forms (${res.status})`);
  return data.forms;
}

/** One filled form ("all" = every form in one PDF), as a PDF blob for the preview. */
export async function fetchFormPdf(bookingId: string, key: string): Promise<Blob> {
  const url = key === "all" ? `${API_BASE_URL}/api/forms/${bookingId}/forms.pdf` : `${API_BASE_URL}/api/forms/${bookingId}/forms/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Could not make the form (${res.status})`);
  }
  return res.blob();
}

/** Air Freight: staff update the dangerous goods answers and/or the lithium battery document. */
export async function saveDangerousGoods(
  bookingId: string,
  body: { dangerousGoods?: DangerousGoods; lithiumDoc?: { configs: string[]; phone: string } },
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/forms/${bookingId}/dangerous-goods`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Could not save (${res.status})`);
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
