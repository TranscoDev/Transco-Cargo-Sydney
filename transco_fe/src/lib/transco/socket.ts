import { API_BASE_URL } from "./config";
import type { BookingStatus, ConversationMode, MessageStatus } from "./types";
import type { BackendCustomer, BackendMessage } from "./api";

/**
 * WebSocket client for the transco_be backend's staff event stream.
 * `payload` is deliberately `unknown` here — the backend broadcasts several
 * event types and each consumer narrows by `type` and casts to the payload
 * shape it needs (declared below), so new event types don't require touching
 * this file.
 */
export interface ServerEvent {
  type: string;
  payload: unknown;
}

export interface MessageCreatedPayload {
  message: BackendMessage;
  customer: BackendCustomer;
  unreadCount: number;
  lastMessage: { content: string; senderType: string; createdAt: string };
  lastActivityAt: string;
}

export interface StatusChangedPayload {
  messageId: string;
  customerId: string;
  whatsappStatus: MessageStatus;
  /** Plain-English reason a "FAILED" status happened — e.g. the
   * WhatsApp 24-hour messaging window — so staff see why, not just a
   * red icon. Null/absent for non-failure status changes. */
  failureReason?: string | null;
}

export interface MaintenanceChangedPayload {
  maintenanceMode: boolean;
}

export interface ContactUpdatedPayload {
  customerId: string;
  customer: BackendCustomer;
}

export interface ModeChangedPayload {
  customerId: string;
  mode: ConversationMode;
}

export interface ReadStateChangedPayload {
  customerId: string;
  messageIds: string[];
  isRead: boolean;
  unreadCount: number;
}

export interface NeedsAttentionPayload {
  customerId: string;
  customer: BackendCustomer;
  lastMessage: { content: string; senderType: string; createdAt: string };
}

export interface BookingCreatedPayload {
  _id: string;
  customerId: string;
  customerName: string;
  phoneNumber: string;
  requestedDay: string;
  requestedTime: string;
  status: BookingStatus;
  createdAt: string;
}

export interface BookingDeletedPayload {
  _id: string;
}

export interface BookingStatusChangedPayload {
  _id: string;
  status: BookingStatus;
}

const WS_URL = API_BASE_URL.replace(/^http/, "ws");

/** Connects, auto-reconnects on drop, and returns a teardown function. */
export function connectConsoleSocket(onEvent: (event: ServerEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};

  let socket: WebSocket | null = null;
  let retryTimer: number | undefined;
  let stopped = false;

  const connect = () => {
    socket = new WebSocket(WS_URL);

    socket.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data) as ServerEvent);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      if (!stopped) retryTimer = window.setTimeout(connect, 3000);
    };
  };

  connect();

  return () => {
    stopped = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    socket?.close();
  };
}
