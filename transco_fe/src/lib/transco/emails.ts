import { API_BASE_URL } from "./config";
import { getAuthToken } from "./auth";

/** Emails to customers from Gmail / Outlook (transco_be emailRoutes.js). */

export type EmailAccount = "outlook" | "gmail";

export interface SentEmail {
  id: string;
  account: EmailAccount;
  fromAddress: string;
  to: string;
  cc: string | null;
  subject: string;
  body: string;
  customerId: string | null;
  customerName: string | null;
  bookingId: string | null;
  bookingCode: string | null;
  sentById: string;
  sentByName: string;
  aiDrafted: boolean;
  sentAt: string;
}

export interface EmailAccounts {
  isAdmin: boolean;
  aiDrafts: boolean;
  outlook: { connected: boolean; address: string; secretExpires: string | null; usable: boolean };
  gmail: {
    configured: boolean;
    connected: boolean;
    broken: boolean;
    address: string | null;
    connectedBy: string | null;
    connectedAt: string | null;
    usable: boolean;
    adminOnly: boolean;
  };
}

export interface EmailRecipient {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  code: string | null;
}

export interface EmailDraft {
  subject: string;
  body: string;
  seen: { name: string | null; phone: string | null; email: string | null };
  customer: { id: string; name: string | null; email: string | null } | null;
}

export class EmailError extends Error {
  field: string | null;
  constructor(message: string, field: string | null = null) {
    super(message);
    this.field = field;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getAuthToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/emails${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : null,
    });
  } catch {
    throw new EmailError("Couldn't reach the server. Check the internet and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string | null };
  if (!res.ok) throw new EmailError(data.error || `Something went wrong (${res.status})`, data.field ?? null);
  return data as T;
}

export function fetchEmailAccounts(): Promise<EmailAccounts> {
  return request("GET", "/accounts");
}

export function fetchEmails(filters: { customerId?: string; bookingId?: string; account?: string; sentById?: string; q?: string } = {}): Promise<{ emails: SentEmail[] }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const qs = params.toString();
  return request("GET", qs ? `?${qs}` : "");
}

export function fetchRecipients(query: { q?: string; customerId?: string }): Promise<{ recipients: EmailRecipient[] }> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.customerId) params.set("customerId", query.customerId);
  return request("GET", `/recipients?${params}`);
}

export function gmailConnectUrl(): Promise<{ url: string }> {
  return request("GET", "/gmail/connect");
}

export function disconnectGmail(): Promise<{ success: true }> {
  return request("POST", "/gmail/disconnect", {});
}

export interface SendEmailInput {
  account: EmailAccount;
  to: string;
  cc?: string | undefined;
  subject: string;
  body: string;
  customerId?: string | null | undefined;
  customerName?: string | null | undefined;
  bookingId?: string | null | undefined;
  aiDrafted?: boolean;
}

export async function sendEmail(input: SendEmailInput): Promise<SentEmail> {
  const { email } = await request<{ email: SentEmail }>("POST", "/send", input);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("transco:emails-changed"));
  return email;
}

export function draftEmail(input: {
  customerId?: string | null | undefined;
  customerIds?: string[];
  bookingId?: string | null | undefined;
  image?: string | null;
  note?: string;
}): Promise<EmailDraft> {
  return request("POST", "/draft", input);
}

/** Any "[check…]" the AI left for staff to fill in. */
export const CHECK_RE = /\[check[^\]]*\]/i;

/** Ready-made emails. {name} = customer's first name, {booking} = booking code. */
export const EMAIL_TEMPLATES: { key: string; label: string; subject: string; body: string }[] = [
  {
    key: "booking",
    label: "Booking confirmed",
    subject: "Your booking {booking} is confirmed",
    body: "Hi {name},\n\nThank you for booking with Transco Cargo. Your booking {booking} is confirmed.\n\n[check: drop-off or pickup day and time]\n\nIf anything changes, just reply to this email.\n\nKind regards,\nTransco Cargo Sydney",
  },
  {
    key: "reminder",
    label: "Drop-off reminder",
    subject: "Reminder: your drop-off with Transco Cargo",
    body: "Hi {name},\n\nA friendly reminder about your drop-off on [check: day and time].\n\nOur warehouse: Unit 1, 79 Station Rd, Seven Hills NSW 2147.\n• Saturday — walk in any time 11am–3pm\n• Tuesday to Friday — 5pm to 6pm, by appointment\n• Sunday and Monday — closed\n\nKind regards,\nTransco Cargo Sydney",
  },
  {
    key: "departed",
    label: "Shipment departed",
    subject: "Your boxes are on their way",
    body: "Hi {name},\n\nGood news — your boxes have left Sydney on [check: Shipment number].\n\nExpected arrival: [check: date]. We'll let you know when they arrive.\n\nKind regards,\nTransco Cargo Sydney",
  },
  {
    key: "documents",
    label: "Documents needed",
    subject: "Documents needed for your shipment",
    body: "Hi {name},\n\nTo send your boxes, we still need:\n• [check: which documents]\n\nYou can reply to this email with a photo or PDF.\n\nKind regards,\nTransco Cargo Sydney",
  },
];

export function fillTemplate(text: string, vars: { name?: string | null; booking?: string | null }) {
  const first = (vars.name || "").trim().split(/\s+/)[0] || "";
  return text
    .replace(/Hi \{name\},/g, first ? `Hi ${first},` : "Hi,")
    .replace(/\{name\}/g, first)
    .replace(/ ?\{booking\}/g, vars.booking ? ` ${vars.booking}` : "");
}

export const accountLabel = (a: EmailAccount) => (a === "gmail" ? "Gmail" : "Outlook");
