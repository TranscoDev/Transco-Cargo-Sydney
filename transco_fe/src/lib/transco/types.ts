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
}