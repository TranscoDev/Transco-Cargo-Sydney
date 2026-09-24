export type ConversationMode = "CHATBOT" | "HUMAN";

/** Display label only — the underlying "HUMAN" value is unchanged
 * everywhere else (backend, comparisons, storage). Staff just reads
 * better than "Human" in a dashboard built for staff to use. */
export const MODE_LABELS: Record<ConversationMode, string> = {
  CHATBOT: "CHATBOT",
  HUMAN: "STAFF",
};

/** Absent/undefined means "whatsapp" — every conversation that existed
 * before this field was added stays implicitly WhatsApp, no backfill
 * needed. */
export type ConversationChannel = "whatsapp" | "website";

/** How this customer's record came to exist — a customer can have more
 * than one (a historical Excel import who later messages WhatsApp ends up
 * with both). Distinct from ConversationChannel, which is about the
 * conversation view; a customer can have sources with no conversation at
 * all (historical/manual). */
export type CustomerSource = "whatsapp" | "website" | "historical" | "manual";

/** Staff-controlled, independent of source — a WhatsApp customer can still
 * be marked DO_NOT_CONTACT. Absent/undefined (customers created before
 * this field existed) is treated as ACTIVE everywhere it's read. */
export type CustomerStatus = "ACTIVE" | "HISTORICAL" | "REVIEW" | "DO_NOT_CONTACT" | "BLOCKED";

export const CUSTOMER_STATUSES: CustomerStatus[] = [
  "ACTIVE",
  "HISTORICAL",
  "REVIEW",
  "DO_NOT_CONTACT",
  "BLOCKED",
];

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  ACTIVE: "Active",
  HISTORICAL: "Historical",
  REVIEW: "Needs Review",
  DO_NOT_CONTACT: "Do Not Contact",
  BLOCKED: "Blocked",
};

/** One sender→receiver shipment relationship pulled from the historical
 * Excel import — never created any other way. */
export interface ShipmentHistoryEntry {
  id: string;
  batchNumber: string | null;
  receiverName: string;
  receiverAddress: string;
  receiverPhone: string | null;
  receiverEmail: string | null;
  importedAt: string;
}

/** The Contacts page's filter tabs — "imported" means historical-only,
 * not yet matched to a live WhatsApp/website conversation. */
export type ContactSourceFilter = "all" | "whatsapp" | "website" | "imported";

/** A saved, reusable combination of Contacts filters — shared across
 * whoever's logged into the console (persisted server-side), not a
 * per-browser preference. */
export interface SegmentFilter {
  sourceFilter: ContactSourceFilter;
  statusFilter: CustomerStatus | "any";
  hasEmailOnly: boolean;
}

export interface Segment {
  id: string;
  name: string;
  filter: SegmentFilter;
}

/** A flyer/image/PDF attached to a campaign email — read client-side via
 * FileReader into base64, no separate upload step. */
export interface CampaignAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}

/** Result of a bulk Excel/CSV customer import — see importLogic.js. */
export interface ImportSummary {
  processed: number;
  matchedExisting: number;
  createdNew: number;
  shipmentsLinked: number;
  skippedSection: number;
  needsReview: number;
}

export interface ImportReviewRow {
  reason: string;
  senderName: string;
  rawPhone: string | number;
}

export interface ImportResult {
  summary: ImportSummary;
  reviewRows: ImportReviewRow[];
  reviewRowsTruncated: boolean;
}

/** Result of one "Email Selected" send — DO_NOT_CONTACT/BLOCKED customers
 * are always excluded server-side, counted in skippedExcludedStatus even
 * if they were part of the original selection. */
export interface EmailCampaignResult {
  requested: number;
  sent: number;
  skippedNoEmail: number;
  skippedExcludedStatus: number;
  failed: number;
}

export type SenderType = "CUSTOMER" | "CHATBOT" | "HUMAN";

export type MessageStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

/** Mirrors the WhatsApp message type a staff attachment gets sent as —
 * determined server-side from the uploaded file's mimetype. */
export type MediaType = "image" | "video" | "audio" | "document";

export interface Message {
  id: string;
  conversationId: string;
  sender: SenderType;
  body: string;
  /** ISO / UTC timestamp. Never store local time here. */
  createdAt: string;
  status?: MessageStatus | undefined;
  read?: boolean | undefined;
  /** Plain-English reason a FAILED status happened (e.g. the WhatsApp
   * 24-hour messaging window) — set only when status is FAILED. */
  failureReason?: string | null | undefined;
  /** Set only for a staff-sent attachment (flyer/video/document) — body
   * is used as the caption when present, empty otherwise. */
  mediaUrl?: string | null | undefined;
  mediaType?: MediaType | null | undefined;
}

/** The message that triggered a needs-attention flag, kept around so
 * staff can see exactly what was flagged even after later messages push
 * it out of view. */
export interface NeedsAttentionMessage {
  content: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  customerName: string;
  phoneNumber: string;
  mode: ConversationMode;
  channel?: ConversationChannel | undefined;
  messages: Message[];
  /** True once the chatbot has flagged this conversation for staff follow-up
   * (customer.needs_attention). Persisted server-side; cleared when mode
   * switches to HUMAN. */
  needsAttention?: boolean | undefined;
  needsAttentionMessage?: NeedsAttentionMessage | undefined;
  /** Staff-entered contact details — never collected automatically from
   * conversation content. Shown/edited in the Contacts directory. */
  email?: string | undefined;
  notes?: string | undefined;
  /** Absent means this predates the CRM fields — treat as ["whatsapp"] or
   * ["website"] per `channel` when displaying, never as "no source". */
  sources?: CustomerSource[] | undefined;
  /** Absent means ACTIVE (see CustomerStatus doc comment). */
  status?: CustomerStatus | undefined;
  /** Only populated for customers with historical-import shipment records. */
  shipments?: ShipmentHistoryEntry[] | undefined;
  /** CRM aggregate fields — computed server-side at read time from
   * bookings/shipments/(later invoices+payments), never stored on the
   * customer record itself. totalRevenue/outstandingBalance are 0/null
   * until Finance ships (Phase 5); see financeDataAvailable on
   * CustomerProfile for the explicit "not built yet" flag. */
  totalBookings?: number | undefined;
  totalShipments?: number | undefined;
  totalRevenue?: number | undefined;
  outstandingBalance?: number | null | undefined;
}

/** GET /api/customers/:id/profile — the CRM detail view. A superset of
 * Conversation: same customer fields, plus this customer's own booking
 * history and an explicit flag for whether the finance fields are real
 * data yet (they're not, until Phase 5). */
export interface CustomerProfile extends Conversation {
  bookings: Booking[];
  /** Live shipments (Phase 2) for this customer — separate from the
   * inherited `shipments` field (historical import), which is untouched. */
  liveShipments: Shipment[];
  financeDataAvailable: boolean;
}

export interface ConversationSummary {
  id: string;
  customerName: string;
  phoneNumber: string;
  mode: ConversationMode;
  channel?: ConversationChannel | undefined;
  lastMessage?: Message | undefined;
  lastActivityAt: string;
  unreadCount: number;
  needsAttention?: boolean | undefined;
  needsAttentionMessage?: NeedsAttentionMessage | undefined;
}

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

export interface Booking {
  id: string;
  customerId: string;
  customerName: string;
  phoneNumber: string;
  requestedDay: string;
  requestedTime: string;
  status: BookingStatus;
  createdAt: string;
  /** Short plain-English line the bot itself generated (e.g. "3 Tea Chest
   * boxes") — null when the booking was made with no box details yet. */
  boxSummary?: string | null | undefined;
  /** YYYY-MM-DD, Sydney-local — resolved server-side (same logic as the
   * Google Calendar sync): the real captured date if given, otherwise the
   * next actual occurrence of requestedDay. Always a concrete date, never
   * just a recurring weekday name, so the calendar view can place it on
   * one real cell. */
  resolvedDate: string;
  /** Optional operations/CRM fields added in Phase 2 — all staff-entered,
   * all additive. Absent on every booking that predates this phase. */
  serviceType?: string | null | undefined;
  origin?: string | null | undefined;
  destination?: string | null | undefined;
  cargoType?: string | null | undefined;
  boxCount?: number | null | undefined;
  weight?: number | null | undefined;
  cbm?: number | null | undefined;
  /** Staff-entered/provisional in Phase 2 — becomes derived from real
   * invoices/payments once Finance (Phase 5) ships. Same field name and
   * shape either way, so the UI doesn't need to change twice. */
  price?: number | null | undefined;
  paymentStatus?: string | null | undefined;
  notes?: string | null | undefined;
  /** Set once a Shipment has been created from this booking. */
  shipmentId?: string | null | undefined;
}

/** Fields a staff member can edit on a booking via PATCH
 * /api/bookings/:id — kept separate from the booking-creation shape and
 * from the existing status-only PATCH, which is untouched. */
export interface BookingUpdateInput {
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
}

/** Candidate operational stages for a live shipment (Phase 2) — a
 * straight line from booked to delivered. Not enforced as a strict state
 * machine server-side; staff can move a shipment to any of these. */
export type ShipmentStatus =
  | "booked"
  | "cargo_received"
  | "at_warehouse"
  | "loaded"
  | "in_transit"
  | "arrived"
  | "customs"
  | "ready_for_collection"
  | "delivered";

export const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "booked",
  "cargo_received",
  "at_warehouse",
  "loaded",
  "in_transit",
  "arrived",
  "customs",
  "ready_for_collection",
  "delivered",
];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  booked: "Booked",
  cargo_received: "Cargo Received",
  at_warehouse: "At Warehouse",
  loaded: "Loaded",
  in_transit: "In Transit",
  arrived: "Arrived",
  customs: "Customs",
  ready_for_collection: "Ready for Collection",
  delivered: "Delivered",
};

export interface ShipmentHistoryPoint {
  status: ShipmentStatus;
  at: string;
  note?: string | null;
}

/** A live, operationally-tracked shipment (Phase 2) — distinct from
 * ShipmentHistoryEntry above, which is historical Excel-import data only.
 * References customerId/bookingId; never duplicates either record. */
export interface Shipment {
  id: string;
  shipmentNumber: string;
  customerId: string;
  customerName: string | null;
  phoneNumber: string | null;
  bookingId?: string | null | undefined;
  serviceType?: string | null | undefined;
  origin?: string | null | undefined;
  destination?: string | null | undefined;
  blNumber?: string | null | undefined;
  containerNumber?: string | null | undefined;
  cargo?: string | null | undefined;
  boxCount?: number | null | undefined;
  weight?: number | null | undefined;
  cbm?: number | null | undefined;
  trackingNumber?: string | null | undefined;
  status: ShipmentStatus;
  warehouseStatus?: string | null | undefined;
  history: ShipmentHistoryPoint[];
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating a shipment — bookingId is optional (a shipment
 * can stand alone, or be created from an existing booking, which then
 * gets its shipmentId set server-side). */
export interface ShipmentCreateInput {
  customerId: string;
  bookingId?: string | null;
  serviceType?: string | null;
  origin?: string | null;
  destination?: string | null;
  blNumber?: string | null;
  containerNumber?: string | null;
  cargo?: string | null;
  boxCount?: number | null;
  weight?: number | null;
  cbm?: number | null;
  trackingNumber?: string | null;
}

export interface ShipmentUpdateInput {
  status?: ShipmentStatus;
  statusNote?: string | null;
  warehouseStatus?: string | null;
  serviceType?: string | null;
  origin?: string | null;
  destination?: string | null;
  blNumber?: string | null;
  containerNumber?: string | null;
  cargo?: string | null;
  boxCount?: number | null;
  weight?: number | null;
  cbm?: number | null;
  trackingNumber?: string | null;
}