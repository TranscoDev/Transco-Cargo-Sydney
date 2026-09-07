import { API_BASE_URL } from "./config";
import { getAuthToken } from "./auth";
import type {
  Booking,
  BookingStatus,
  Conversation,
  ConversationChannel,
  ConversationMode,
  Message,
  MessageStatus,
  SenderType,
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
  createdAt: string;
}

export interface BackendCustomer {
  _id: string;
  phoneNumber: string;
  name: string;
  mode: ConversationMode;
  channel?: ConversationChannel;
  needsAttention?: boolean;
  needsAttentionMessage?: { content: string; createdAt: string } | null;
}

export interface BackendCustomerWithMessages extends BackendCustomer {
  messages: BackendMessage[];
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
  };
}

/** No endpoint currently requires this, but every real request carries it
 * so nothing needs to change here once authorization is enforced server-side. */
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
