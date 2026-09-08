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

export type BookingStatus = "pending" | "confirmed" | "cancelled";

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