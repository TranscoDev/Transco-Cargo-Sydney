import { API_BASE_URL } from "./config";
import { getAuthToken } from "./auth";

/**
 * CRM → My Transco: staff view of customers' online accounts
 * (/api/my-transco/* on transco_be — see staffPortalRoutes.js there).
 * Kept in its own module since none of this is part of the conversation
 * store: these pages fetch on open and refetch after each action.
 */

export type StageStatus = "received" | "not_received";
export type StatusTone = "pending" | "active" | "done" | "muted";

export interface PortalStatus {
  key: string;
  label: string;
  tone: StatusTone;
}

export interface PortalStep {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
  attention?: boolean;
}

export interface PortalAccountSummary {
  id: string;
  customerCode: string | null;
  name: string | null;
  phoneNumber: string;
  email: string | null;
  phoneVerified: boolean;
  hasPassword: boolean;
  passwordSetByStaff: string | null;
  locked: boolean;
  lockedUntil: string | null;
  joinedAt: string | null;
  lastSignInAt: string | null;
  source: "warehouse_qr" | "website" | "direct" | "staff" | string | null;
  sources: string[];
  preferredLanguage: "en" | "si" | "ta" | string;
  hasWhatsAppConversation: boolean;
}

export interface PortalAccountRow extends PortalAccountSummary {
  bookings: { total: number; open: number; online: number; needsDeclaration: number; lastAt: string | null };
  shipments: { total: number; withBl: number };
}

export interface PortalAccountStats {
  accounts: number;
  joinedThisWeek: number;
  verified: number;
  unverified: number;
  withBookings: number;
  needsDeclaration: number;
  fromQr: number;
  locked: number;
}

export interface PortalAddress {
  line1: string;
  suburb: string;
  state: string;
  postcode: string;
}

export interface PortalAccountDetail extends PortalAccountSummary {
  address: PortalAddress;
  contactPreference: "whatsapp" | "phone" | "email" | string;
  createdAt: string | null;
  profileUpdatedAt: string | null;
  phoneVerifiedAt: string | null;
  passwordUpdatedAt: string | null;
  staffNotes: string | null;
  previousPhoneNumbers: { phoneNumber: string; changedAt: string | null }[];
}

export interface PortalBooking {
  id: string;
  code: string | null;
  createdAt: string | null;
  country: string | null;
  service: string | null;
  items: string | null;
  destination: string | null;
  delivery: string | null;
  dropOff: { date: string | null; day: string; time: string | null } | null;
  notes: string | null;
  status: PortalStatus;
  declaration: { status: "received" | "needed"; formUrl: string };
  blNumber: string | null;
  shipmentId: string | null;
  steps: PortalStep[];
  channel: string | null;
  rawStatus: string | null;
  declarationStatus: StageStatus;
  warehouseStatus: StageStatus;
  staffNotes: string | null;
}

export interface PortalShipment {
  id: string;
  blNumber: string | null;
  bookingCode: string | null;
  destination: string | null;
  items: string | null;
  receiverName: string | null;
  batchLabel: string | null;
  status: PortalStatus;
  updatedAt: string | null;
  steps: PortalStep[];
}

export interface PortalChatSession {
  id: string;
  startedAt: string | null;
  messageCount: number;
  lastMessageAt: string | null;
}

export interface PortalAccountFull {
  customer: PortalAccountDetail;
  bookings: PortalBooking[];
  shipments: PortalShipment[];
  chatSessions: PortalChatSession[];
}

export interface PortalProfileUpdate {
  name?: string;
  email?: string;
  address?: PortalAddress;
  preferredLanguage?: string;
  contactPreference?: string;
}

function headers(json = false): Record<string, string> {
  const token = getAuthToken();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/my-transco${path}`, {
    method,
    headers: headers(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export function fetchPortalAccounts(): Promise<{ stats: PortalAccountStats; customers: PortalAccountRow[] }> {
  return request("GET", "/customers");
}

export function fetchPortalAccount(customerId: string): Promise<PortalAccountFull> {
  return request("GET", `/customers/${customerId}`);
}

export function updatePortalAccount(customerId: string, update: PortalProfileUpdate): Promise<{ success: true }> {
  return request("PATCH", `/customers/${customerId}`, update);
}

export function verifyPortalPhone(customerId: string): Promise<{ success: true }> {
  return request("POST", `/customers/${customerId}/verify-phone`);
}

export function signOutPortalAccount(customerId: string): Promise<{ success: true }> {
  return request("POST", `/customers/${customerId}/sign-out`);
}

/** The customer has a new mobile number. Refused (with the other
 * customer named) if the number already belongs to someone else. */
export function changePortalPhone(
  customerId: string,
  countryCode: string,
  phone: string,
): Promise<{ success: true; phoneNumber: string }> {
  return request("POST", `/customers/${customerId}/change-phone`, { countryCode, phone });
}

export function unlockPortalAccount(customerId: string): Promise<{ success: true }> {
  return request("POST", `/customers/${customerId}/unlock`);
}

export const SOURCE_LABELS: Record<string, string> = {
  warehouse_qr: "Warehouse QR",
  website: "Website",
  direct: "Direct link",
  staff: "Set up by staff",
};

export const LANGUAGE_LABELS: Record<string, string> = { en: "English", si: "Sinhala", ta: "Tamil" };

export const CONTACT_LABELS: Record<string, string> = { whatsapp: "WhatsApp", phone: "Phone call", email: "Email" };

export function formatPhone(digits: string): string {
  return digits ? `+${digits}` : "";
}

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}
