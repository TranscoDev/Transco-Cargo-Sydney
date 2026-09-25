import { API_BASE_URL } from "./config";
import { getAuthToken } from "./auth";
import type {
  Booking,
  BookingStatus,
  BookingUpdateInput,
  CampaignAttachment,
  Consolidation,
  ConsolidationDetail,
  ConsolidationDates,
  ConsolidationFinancials,
  ConsolidationTotals,
  Conversation,
  ConversationChannel,
  ConversationMode,
  CustomerProfile,
  CustomerSource,
  CustomerStatus,
  EmailCampaignResult,
  ImportResult,
  MediaType,
  Message,
  MessageStatus,
  ReceiverProfile,
  Segment,
  SegmentFilter,
  SenderType,
  Shipment,
  ShipmentBoxBreakdown,
  ShipmentCreateInput,
  ShipmentHistoryEntry,
  ShipmentHistoryPoint,
  ShipmentReceiverProfile,
  ShipmentStatus,
  ShipmentUpdateInput,
} from "./types";

/**
 * REST client for the transco_be backend, plus the mapping layer between its
 * document shape (customers/messages collections) and this UI's Conversation/
 * Message types.
 */

export interface BackendMessage {
  _id: string;
  customerId: string;
  senderType: SenderType;
  content: string;
  isRead: boolean;
  replyToMessageId: string | null;
  whatsappStatus: MessageStatus | null;
  failureReason?: string | null;
  createdAt: string;
  mediaUrl?: string | null;
  mediaType?: MediaType | null;
}

export interface BackendCustomer {
  _id: string;
  phoneNumber: string;
  name: string;
  mode: ConversationMode;
  channel?: ConversationChannel;
  needsAttention?: boolean;
  needsAttentionMessage?: { content: string; createdAt: string } | null;
  email?: string;
  notes?: string;
  sources?: CustomerSource[];
  status?: CustomerStatus;
  totalBookings?: number;
  totalShipments?: number;
  totalRevenue?: number;
  outstandingBalance?: number | null;
}

export interface BackendShipment {
  _id: string;
  batchNumber: string | null;
  receiverName: string;
  receiverAddress: string;
  receiverPhone: string | null;
  receiverEmail: string | null;
  importedAt: string;
}

export interface BackendCustomerWithMessages extends BackendCustomer {
  messages: BackendMessage[];
  shipments?: BackendShipment[];
}

export interface BackendBooking {
  _id: string;
  customerId: string;
  customerName: string;
  phoneNumber: string;
  requestedDay: string;
  requestedTime: string;
  status: BookingStatus;
  createdAt: string;
  boxSummary?: string | null;
  resolvedDate: string;
  serviceType?: string | null;
  origin?: string | null;
  destination?: string | null;
  cargoType?: string | null;
  boxCount?: number | null;
  weight?: number | null;
  cbm?: number | null;
  price?: number | null;
  paymentStatus?: string | null;
  notes?: string | null;
  shipmentId?: string | null;
}

export function mapBooking(b: BackendBooking): Booking {
  return {
    id: b._id,
    customerId: b.customerId,
    customerName: b.customerName,
    phoneNumber: b.phoneNumber,
    requestedDay: b.requestedDay,
    requestedTime: b.requestedTime,
    status: b.status,
    createdAt: b.createdAt,
    boxSummary: b.boxSummary,
    resolvedDate: b.resolvedDate,
    serviceType: b.serviceType,
    origin: b.origin,
    destination: b.destination,
    cargoType: b.cargoType,
    boxCount: b.boxCount,
    weight: b.weight,
    cbm: b.cbm,
    price: b.price,
    paymentStatus: b.paymentStatus,
    notes: b.notes,
    shipmentId: b.shipmentId,
  };
}

export function mapMessage(m: BackendMessage): Message {
  return {
    id: m._id,
    conversationId: m.customerId,
    sender: m.senderType,
    body: m.content,
    createdAt: m.createdAt,
    status: m.whatsappStatus ?? undefined,
    read: m.senderType === "CUSTOMER" ? m.isRead : undefined,
    failureReason: m.failureReason ?? undefined,
    mediaUrl: m.mediaUrl,
    mediaType: m.mediaType,
  };
}

function mapShipment(s: BackendShipment): ShipmentHistoryEntry {
  return {
    id: s._id,
    batchNumber: s.batchNumber,
    receiverName: s.receiverName,
    receiverAddress: s.receiverAddress,
    receiverPhone: s.receiverPhone,
    receiverEmail: s.receiverEmail,
    importedAt: s.importedAt,
  };
}

interface BackendReceiverProfileRef {
  id: string;
  name: string;
  phone: string | null;
  hblNumbers: string[];
}

/** A live, operationally-tracked shipment (Phase 2) — distinct from
 * BackendShipment above, which is historical Excel-import data only.
 * hblNumber/batchNumber/consolidationId/boxes/totalCbm/totalBoxes/
 * receiverProfile are only present on shipments imported from a batch
 * ledger — absent on shipments created manually via New Shipment. */
export interface BackendShipmentRecord {
  _id: string;
  shipmentNumber: string;
  customerId: string;
  customerName: string | null;
  phoneNumber: string | null;
  bookingId?: string | null;
  hblNumber?: string | null;
  batchNumber?: number | null;
  consolidationId?: string | null;
  serviceType?: string | null;
  origin?: string | null;
  destination?: string | null;
  blNumber?: string | null;
  containerNumber?: string | null;
  cargo?: string | null;
  boxCount?: number | null;
  boxes?: ShipmentBoxBreakdown | null;
  weight?: number | null;
  cbm?: number | null;
  totalCbm?: number | null;
  totalBoxes?: number | null;
  trackingNumber?: string | null;
  receiverProfile?: BackendReceiverProfileRef | null;
  status: ShipmentStatus;
  warehouseStatus?: string | null;
  history: ShipmentHistoryPoint[];
  createdAt: string;
  updatedAt: string;
}

function mapReceiverProfileRef(
  r?: BackendReceiverProfileRef | null,
): ShipmentReceiverProfile | null {
  if (!r) return null;
  return { id: r.id, name: r.name, phone: r.phone, hblNumbers: r.hblNumbers ?? [] };
}

export function mapShipmentRecord(s: BackendShipmentRecord): Shipment {
  return {
    id: s._id,
    shipmentNumber: s.shipmentNumber,
    customerId: s.customerId,
    customerName: s.customerName,
    phoneNumber: s.phoneNumber,
    bookingId: s.bookingId,
    hblNumber: s.hblNumber,
    batchNumber: s.batchNumber,
    consolidationId: s.consolidationId,
    serviceType: s.serviceType,
    origin: s.origin,
    destination: s.destination,
    blNumber: s.blNumber,
    containerNumber: s.containerNumber,
    cargo: s.cargo,
    boxCount: s.boxCount,
    boxes: s.boxes,
    weight: s.weight,
    cbm: s.cbm,
    totalCbm: s.totalCbm,
    totalBoxes: s.totalBoxes,
    trackingNumber: s.trackingNumber,
    receiverProfile: mapReceiverProfileRef(s.receiverProfile),
    status: s.status,
    warehouseStatus: s.warehouseStatus,
    history: s.history ?? [],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function mapConversation(c: BackendCustomerWithMessages): Conversation {
  return {
    id: c._id,
    customerName: c.name,
    phoneNumber: c.phoneNumber,
    mode: c.mode,
    channel: c.channel,
    messages: c.messages.map(mapMessage),
    needsAttention: c.needsAttention === true,
    needsAttentionMessage: c.needsAttentionMessage ?? undefined,
    email: c.email,
    notes: c.notes,
    sources: c.sources,
    status: c.status,
    shipments: c.shipments?.map(mapShipment),
    totalBookings: c.totalBookings,
    totalShipments: c.totalShipments,
    totalRevenue: c.totalRevenue,
    outstandingBalance: c.outstandingBalance,
  };
}

/** Every /api/* route except login and the public web-chat widget now
 * requires this (server-side requireAuth middleware, added Phase 0). */
function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE_URL}/api/customers`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to load conversations (${res.status})`);
  }
  const data = (await res.json()) as { customers: BackendCustomerWithMessages[] };
  return data.customers.map(mapConversation);
}

interface BackendCustomerProfile extends BackendCustomerWithMessages {
  bookings: BackendBooking[];
  liveShipments: BackendShipmentRecord[];
  totalBookings: number;
  totalShipments: number;
  totalRevenue: number;
  outstandingBalance: number | null;
  financeDataAvailable: boolean;
}

/** GET /api/customers/:id/profile — the CRM detail view. Separate from
 * fetchConversations() (the list endpoint) since this pulls a fuller,
 * single-customer aggregate (booking history, finance placeholder
 * fields) that would be wasteful to compute for every row in the list. */
export async function fetchCustomerProfile(customerId: string): Promise<CustomerProfile> {
  const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}/profile`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load customer profile (${res.status})`);
  }
  const data = (await res.json()) as { customer: BackendCustomerProfile };
  const c = data.customer;
  return {
    ...mapConversation(c),
    bookings: c.bookings.map(mapBooking),
    liveShipments: c.liveShipments.map(mapShipmentRecord),
    financeDataAvailable: c.financeDataAvailable,
  };
}

export async function markConversationRead(customerId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}/read`, {
    method: "PATCH",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to mark conversation read (${res.status})`);
  }
}

export async function sendHumanMessage(
  customerId: string,
  content: string,
  replyToMessageId?: string,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(replyToMessageId ? { content, replyToMessageId } : { content }),
  });
  if (!res.ok) {
    throw new Error(`Failed to send message (${res.status})`);
  }
}

/** WhatsApp only for now — the website widget has no live-push channel
 * for a staff-initiated message at all yet, so this isn't offered for
 * website customers (the caller should hide the attach button there). */
export async function sendAttachment(
  customerId: string,
  file: File,
  caption?: string,
  replyToMessageId?: string,
): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  if (caption) formData.append("caption", caption);
  if (replyToMessageId) formData.append("replyToMessageId", replyToMessageId);
  const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}/attachments`, {
    method: "POST",
    headers: authHeaders(), // no Content-Type — fetch sets the multipart boundary itself
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to send attachment (${res.status})`);
  }
}

export async function fetchBookings(): Promise<Booking[]> {
  const res = await fetch(`${API_BASE_URL}/api/bookings`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to load bookings (${res.status})`);
  }
  const data = (await res.json()) as { bookings: BackendBooking[] };
  return data.bookings.map(mapBooking);
}

export async function deleteBooking(bookingId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/bookings/${bookingId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to delete booking (${res.status})`);
  }
}

export async function updateBookingStatus(bookingId: string, status: BookingStatus): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/bookings/${bookingId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update booking status (${res.status})`);
  }
}

/** General field update (Phase 2) — separate endpoint from the
 * status-only PATCH above, which is untouched. Returns the updated
 * booking so the caller can reconcile local state without a refetch. */
export async function updateBooking(
  bookingId: string,
  updates: BookingUpdateInput,
): Promise<Booking> {
  const res = await fetch(`${API_BASE_URL}/api/bookings/${bookingId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    throw new Error(`Failed to update booking (${res.status})`);
  }
  const data = (await res.json()) as { booking: BackendBooking };
  return mapBooking(data.booking);
}

// ============================================================
// SHIPMENTS (Phase 2) — live operational tracking
// ============================================================

export async function fetchShipments(filters?: {
  status?: ShipmentStatus;
  customerId?: string;
}): Promise<Shipment[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.customerId) params.set("customerId", filters.customerId);
  const query = params.toString();
  const res = await fetch(`${API_BASE_URL}/api/shipments${query ? `?${query}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load shipments (${res.status})`);
  }
  const data = (await res.json()) as { shipments: BackendShipmentRecord[] };
  return data.shipments.map(mapShipmentRecord);
}

export async function fetchShipment(shipmentId: string): Promise<Shipment> {
  const res = await fetch(`${API_BASE_URL}/api/shipments/${shipmentId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load shipment (${res.status})`);
  }
  const data = (await res.json()) as { shipment: BackendShipmentRecord };
  return mapShipmentRecord(data.shipment);
}

export async function fetchShipmentTimeline(shipmentId: string): Promise<ShipmentHistoryPoint[]> {
  const res = await fetch(`${API_BASE_URL}/api/shipments/${shipmentId}/timeline`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load shipment timeline (${res.status})`);
  }
  const data = (await res.json()) as { history: ShipmentHistoryPoint[] };
  return data.history;
}

export async function createShipment(input: ShipmentCreateInput): Promise<Shipment> {
  const res = await fetch(`${API_BASE_URL}/api/shipments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to create shipment (${res.status})`);
  }
  const data = (await res.json()) as { shipment: BackendShipmentRecord };
  return mapShipmentRecord(data.shipment);
}

export async function updateShipment(
  shipmentId: string,
  updates: ShipmentUpdateInput,
): Promise<Shipment> {
  const res = await fetch(`${API_BASE_URL}/api/shipments/${shipmentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to update shipment (${res.status})`);
  }
  const data = (await res.json()) as { shipment: BackendShipmentRecord };
  return mapShipmentRecord(data.shipment);
}

// ============================================================
// CONSOLIDATIONS (shipment batches) + RECEIVERS
// ============================================================

interface BackendConsolidation {
  _id: string;
  batchNumber: number;
  label: string;
  peNumber: string | null;
  hblRange: { from: string; to: string };
  totals: ConsolidationTotals;
  paymentTotals: { zeller: number; eft: number; cash: number };
  financials: ConsolidationFinancials;
  financialsNote?: string | null;
  dates: ConsolidationDates;
  importedShipmentCount: number;
  createdAt: string;
  updatedAt: string;
}

function mapConsolidation(c: BackendConsolidation): Consolidation {
  return {
    id: c._id,
    batchNumber: c.batchNumber,
    label: c.label,
    peNumber: c.peNumber,
    hblRange: c.hblRange,
    totals: c.totals,
    paymentTotals: c.paymentTotals,
    financials: c.financials,
    financialsNote: c.financialsNote,
    dates: c.dates,
    importedShipmentCount: c.importedShipmentCount,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function fetchConsolidations(): Promise<Consolidation[]> {
  const res = await fetch(`${API_BASE_URL}/api/consolidations`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to load shipment batches (${res.status})`);
  }
  const data = (await res.json()) as { consolidations: BackendConsolidation[] };
  return data.consolidations.map(mapConsolidation);
}

interface BackendConsolidationDetail extends BackendConsolidation {
  shipments: BackendShipmentRecord[];
}

export async function fetchConsolidation(consolidationId: string): Promise<ConsolidationDetail> {
  const res = await fetch(`${API_BASE_URL}/api/consolidations/${consolidationId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load batch (${res.status})`);
  }
  const data = (await res.json()) as { consolidation: BackendConsolidationDetail };
  return {
    ...mapConsolidation(data.consolidation),
    shipments: data.consolidation.shipments.map(mapShipmentRecord),
  };
}

interface BackendReceiverProfile {
  _id: string;
  name: string;
  phone: string | null;
  email: string | null;
  identityDocument: { type: string; number: string } | null;
  address: string | null;
  hblNumbers: string[];
  shipments: BackendShipmentRecord[];
}

export async function fetchReceiver(receiverId: string): Promise<ReceiverProfile> {
  const res = await fetch(`${API_BASE_URL}/api/receivers/${receiverId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load receiver (${res.status})`);
  }
  const data = (await res.json()) as { receiver: BackendReceiverProfile };
  const r = data.receiver;
  return {
    id: r._id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    identityDocument: r.identityDocument,
    address: r.address,
    hblNumbers: r.hblNumbers ?? [],
    shipments: r.shipments.map(mapShipmentRecord),
  };
}

export async function setCustomerMode(customerId: string, mode: ConversationMode): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}/mode`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update mode (${res.status})`);
  }
}

export interface PauseState {
  websitePaused: boolean;
  whatsappPaused: boolean;
}

export async function fetchPauseState(): Promise<PauseState> {
  const res = await fetch(`${API_BASE_URL}/api/settings/pause-state`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to load pause state (${res.status})`);
  }
  return (await res.json()) as PauseState;
}

export interface DashboardSummary {
  todaysBookings: number;
  newCustomersToday: number;
  unreadConversations: number;
  attentionConversations: number;
  activeShipments: number;
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const res = await fetch(`${API_BASE_URL}/api/dashboard/summary`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to load dashboard summary (${res.status})`);
  }
  return (await res.json()) as DashboardSummary;
}

/** Send only the flag(s) you want to change — e.g. `{ websitePaused: true }`
 * to pause just the website bot, or both flags together for "Stop All"/
 * "Resume All". Whatever isn't included is left as it was. */
export async function setPauseState(partial: Partial<PauseState>): Promise<PauseState> {
  const res = await fetch(`${API_BASE_URL}/api/settings/pause-state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(partial),
  });
  if (!res.ok) {
    throw new Error(`Failed to update pause state (${res.status})`);
  }
  return (await res.json()) as PauseState;
}

export async function updateContactInfo(
  customerId: string,
  info: { email?: string; notes?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}/contact-info`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(info),
  });
  if (!res.ok) {
    throw new Error(`Failed to update contact info (${res.status})`);
  }
}

export async function updateCustomerStatus(
  customerId: string,
  status: CustomerStatus,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update customer status (${res.status})`);
  }
}

/** Staff-entered contact with no prior conversation — matched against
 * existing customers by phone on the backend, so re-adding a number that
 * already exists merges "manual" into its sources instead of duplicating. */
export async function createManualContact(info: {
  name: string;
  phone: string;
  email?: string | undefined;
  notes?: string | undefined;
}): Promise<Conversation> {
  const res = await fetch(`${API_BASE_URL}/api/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(info),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to create contact (${res.status})`);
  }
  const data = (await res.json()) as { customer: BackendCustomer };
  return mapConversation({ ...data.customer, messages: [], shipments: [] });
}

export async function sendEmailCampaign(
  customerIds: string[],
  subject: string,
  body: string,
  attachment?: CampaignAttachment | undefined,
): Promise<EmailCampaignResult> {
  const res = await fetch(`${API_BASE_URL}/api/campaigns/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ customerIds, subject, body, attachment: attachment ?? null }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? `Failed to send campaign (${res.status})`);
  }
  return data as EmailCampaignResult;
}

interface BackendSegment {
  _id: string;
  name: string;
  filter: SegmentFilter;
}

function mapSegment(s: BackendSegment): Segment {
  return { id: s._id, name: s.name, filter: s.filter };
}

export async function fetchSegments(): Promise<Segment[]> {
  const res = await fetch(`${API_BASE_URL}/api/segments`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to load segments (${res.status})`);
  }
  const data = (await res.json()) as { segments: BackendSegment[] };
  return data.segments.map(mapSegment);
}

export async function createSegment(name: string, filter: SegmentFilter): Promise<Segment> {
  const res = await fetch(`${API_BASE_URL}/api/segments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, filter }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save segment (${res.status})`);
  }
  const data = (await res.json()) as { segment: BackendSegment };
  return mapSegment(data.segment);
}

export async function importCustomersFile(file: File): Promise<ImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/imports/customers`, {
    method: "POST",
    headers: authHeaders(), // no Content-Type — fetch sets the multipart boundary itself
    body: formData,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? `Failed to import file (${res.status})`);
  }
  return data as ImportResult;
}

export async function deleteSegment(segmentId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/segments/${segmentId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to delete segment (${res.status})`);
  }
}
