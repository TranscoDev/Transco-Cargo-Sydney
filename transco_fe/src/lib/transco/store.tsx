import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createMessage, getMockConversations, simulatedInbound } from "./mock-data";
import {
  deleteBooking as deleteBookingRequest,
  fetchBookings,
  fetchConversations,
  mapMessage,
  markConversationRead,
  sendHumanMessage,
  setCustomerMode,
} from "./api";
import {
  connectConsoleSocket,
  type BookingCreatedPayload,
  type BookingDeletedPayload,
  type MessageCreatedPayload,
  type ModeChangedPayload,
  type NeedsAttentionPayload,
  type ReadStateChangedPayload,
  type StatusChangedPayload,
} from "./socket";
import type {
  Booking,
  Conversation,
  ConversationMode,
  ConversationSummary,
  Message,
  MessageStatus,
} from "./types";

/**
 * Conversation/message state layer, backed by the real transco_be API and
 * its WebSocket event stream (message.created, message.status_changed,
 * customer.mode_changed, message.read_state_changed, customer.needs_attention).
 * All updates flow
 * through this one place — components only ever read via useConversations()
 * and never see raw WS events.
 *
 * If the backend is unreachable on load, this falls back to local mock data
 * (mock-data.ts) so the UI still works standalone; the fake inbound-message
 * simulation only runs in that fallback mode.
 */

interface ConversationsApi {
  conversations: Conversation[];
  summaries: ConversationSummary[];
  selectedId: string | null;
  selectedConversation: Conversation | null;
  selectConversation: (id: string | null) => void;
  sendMessage: (conversationId: string, body: string) => void;
  setMode: (conversationId: string, mode: ConversationMode) => void;
  markAsRead: (conversationId: string) => void;
  /** Simulates an inbound WhatsApp event; stands in for a socket push. */
  receiveCustomerMessage: (conversationId: string, body: string) => void;
  updateMessageStatus: (messageId: string, status: MessageStatus) => void;
  sending: boolean;
  /** Weekday drop-off bookings collected by the chatbot, newest first. */
  bookings: Booking[];
  deleteBooking: (bookingId: string) => void;
}

const ConversationsContext = createContext<ConversationsApi | null>(null);

function lastActivity(c: Conversation): string {
  const last = c.messages[c.messages.length - 1];
  return last ? last.createdAt : new Date(0).toISOString();
}

function toSummary(c: Conversation): ConversationSummary {
  const last = c.messages[c.messages.length - 1];
  return {
    id: c.id,
    customerName: c.customerName,
    phoneNumber: c.phoneNumber,
    mode: c.mode,
    channel: c.channel,
    lastMessage: last,
    lastActivityAt: lastActivity(c),
    unreadCount: c.messages.filter((m) => m.sender === "CUSTOMER" && m.read === false).length,
    needsAttention: c.needsAttention === true,
    needsAttentionMessage: c.needsAttentionMessage,
  };
}

export function ConversationsProvider({ children }: { children: ReactNode }) {
  // Starts empty rather than seeded with demo data, so real customer
  // conversations never get preceded by a flash of fake ones on load —
  // the mock set only appears in the fetchConversations().catch() below,
  // as a fallback for genuinely running without a reachable backend.
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  // Becomes true once the initial backend fetch succeeds. Governs whether
  // sendMessage talks to the real API (and waits for the WS echo instead of
  // appending a local fake message — see DUPLICATES note below) or keeps the
  // original local-only mock simulation for a backend-less demo.
  const isLiveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchConversations()
      .then((real) => {
        if (cancelled) return;
        isLiveRef.current = true;
        setConversations(real);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Could not reach the backend; showing local demo data instead.", err);
        setConversations(getMockConversations());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBookings()
      .then((real) => {
        if (cancelled) return;
        setBookings(real);
      })
      .catch((err) => {
        console.warn("Could not load bookings.", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const deleteBooking = useCallback((bookingId: string) => {
    // Optimistic: the WS booking.deleted echo (below) will no-op harmlessly
    // once it arrives, since the entry is already gone. If the request
    // fails, the booking is put back — otherwise it looks deleted until
    // the next reload silently brings it back, with no indication anything
    // went wrong.
    let removed: Booking | undefined;
    setBookings((prev) => {
      removed = prev.find((b) => b.id === bookingId);
      return prev.filter((b) => b.id !== bookingId);
    });
    deleteBookingRequest(bookingId).catch((err) => {
      console.error("Failed to delete booking:", err);
      if (removed) {
        setBookings((prev) =>
          prev.some((b) => b.id === bookingId) ? prev : [removed!, ...prev],
        );
      }
    });
  }, []);

  const patch = useCallback((conversationId: string, fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? fn(c) : c)));
  }, []);

  const appendMessage = useCallback(
    (conversationId: string, message: Message) => {
      patch(conversationId, (c) => ({ ...c, messages: [...c.messages, message] }));
    },
    [patch],
  );

  const markAsRead = useCallback(
    (conversationId: string) => {
      patch(conversationId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.sender === "CUSTOMER" && m.read === false ? { ...m, read: true } : m,
        ),
      }));
      if (isLiveRef.current) {
        markConversationRead(conversationId).catch((err) => {
          console.error("Failed to persist read state:", err);
        });
      }
    },
    [patch],
  );

  const selectConversation = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id) markAsRead(id);
    },
    [markAsRead],
  );

  const sendMessage = useCallback(
    (conversationId: string, body: string) => {
      const conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation) return;

      if (isLiveRef.current) {
        // Real backend: only HUMAN-mode sends are allowed (matches the
        // server's own rule). No local message is appended here — the
        // backend's message.created broadcast is the single source that
        // adds it, so there's exactly one copy, not an optimistic one plus
        // the real one (see DUPLICATES handling in the WS listener below).
        if (conversation.mode !== "HUMAN") {
          console.warn("Cannot send a manual message while a conversation is in CHATBOT mode.");
          return;
        }
        setSending(true);
        sendHumanMessage(conversationId, body)
          .catch((err) => console.error("Failed to send message:", err))
          .finally(() => setSending(false));
        return;
      }

      // No backend connected: keep the original local-only simulation so
      // the UI still demos standalone.
      const sender = conversation.mode === "HUMAN" ? "HUMAN" : "CHATBOT";
      const message = createMessage(conversationId, sender, body, { status: "SENT" });
      appendMessage(conversationId, message);
      setSending(true);

      window.setTimeout(() => {
        setSending(false);
        patch(conversationId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === message.id ? { ...m, status: "DELIVERED" as MessageStatus } : m,
          ),
        }));
      }, 600);
      window.setTimeout(() => {
        patch(conversationId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === message.id ? { ...m, status: "READ" as MessageStatus } : m,
          ),
        }));
      }, 2200);
    },
    [appendMessage, conversations, patch],
  );

  const receiveCustomerMessage = useCallback(
    (conversationId: string, body: string) => {
      const isOpen = selectedRef.current === conversationId;
      appendMessage(
        conversationId,
        createMessage(conversationId, "CUSTOMER", body, { read: isOpen }),
      );
    },
    [appendMessage],
  );

  const setMode = useCallback(
    (conversationId: string, mode: ConversationMode) => {
      // Optimistic local update; conversationId doubles as the backend
      // customer._id once a conversation is backed by real data. Errors are
      // logged, not surfaced, so the mock-data demo keeps working standalone.
      patch(conversationId, (c) => ({ ...c, mode }));
      setCustomerMode(conversationId, mode).catch((err) => {
        console.error("Failed to persist mode change:", err);
      });
    },
    [patch],
  );

  const updateMessageStatus = useCallback((messageId: string, status: MessageStatus) => {
    setConversations((prev) =>
      prev.map((c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === messageId ? { ...m, status } : m)),
      })),
    );
  }, []);

  // Local real-time simulation: an occasional inbound customer message.
  const receiveRef = useRef(receiveCustomerMessage);
  receiveRef.current = receiveCustomerMessage;
  const idsRef = useRef<string[]>([]);
  idsRef.current = conversations.map((c) => c.id);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (isLiveRef.current) return; // real inbound messages arrive over WS instead
      const ids = idsRef.current;
      if (!ids.length) return;
      const id = ids[Math.floor(Math.random() * ids.length)]!;
      const body = simulatedInbound[Math.floor(Math.random() * simulatedInbound.length)]!;
      receiveRef.current(id, body);
    }, 25_000);
    return () => window.clearInterval(timer);
  }, []);

  // The single point where WebSocket events touch state — nothing else in
  // the app reads the socket directly. Every branch matches strictly by
  // conversation/message id, never by recency, and appends/patches the same
  // `conversations` array that summaries/ordering already derive from, so a
  // new message naturally sorts to the top with no separate "reorder" step.
  useEffect(() => {
    const disconnect = connectConsoleSocket((event) => {
      switch (event.type) {
        case "message.created": {
          const { message, customer } = event.payload as MessageCreatedPayload;
          const mapped = mapMessage(message);
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === message.customerId);
            if (idx === -1) {
              // First message from a customer this client hasn't seen yet.
              return [
                ...prev,
                {
                  id: customer._id,
                  customerName: customer.name,
                  phoneNumber: customer.phoneNumber,
                  mode: customer.mode,
                  messages: [mapped],
                },
              ];
            }
            const conversation = prev[idx]!;
            // DUPLICATES: identity is the message id, never a timestamp —
            // this is what makes it safe for this same event to also be the
            // thing that lands a message this client just sent (see
            // sendMessage, which appends nothing locally).
            if (conversation.messages.some((m) => m.id === mapped.id)) return prev;
            const next = [...prev];
            next[idx] = {
              ...conversation,
              mode: customer.mode,
              messages: [...conversation.messages, mapped],
            };
            return next;
          });
          return;
        }

        case "message.status_changed": {
          const { customerId, messageId, whatsappStatus } = event.payload as StatusChangedPayload;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === customerId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === messageId ? { ...m, status: whatsappStatus } : m,
                    ),
                  }
                : c,
            ),
          );
          return;
        }

        case "customer.mode_changed": {
          const { customerId, mode } = event.payload as ModeChangedPayload;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === customerId
                ? {
                    ...c,
                    mode,
                    needsAttention: mode === "HUMAN" ? false : c.needsAttention,
                    needsAttentionMessage:
                      mode === "HUMAN" ? undefined : c.needsAttentionMessage,
                  }
                : c,
            ),
          );
          return;
        }

        case "customer.needs_attention": {
          const { customerId, lastMessage } = event.payload as NeedsAttentionPayload;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === customerId
                ? {
                    ...c,
                    needsAttention: true,
                    needsAttentionMessage: {
                      content: lastMessage.content,
                      createdAt: lastMessage.createdAt,
                    },
                  }
                : c,
            ),
          );
          return;
        }

        case "booking.created": {
          const b = event.payload as BookingCreatedPayload;
          setBookings((prev) => {
            if (prev.some((existing) => existing.id === b._id)) return prev;
            return [
              {
                id: b._id,
                customerId: b.customerId,
                customerName: b.customerName,
                phoneNumber: b.phoneNumber,
                requestedDay: b.requestedDay,
                requestedTime: b.requestedTime,
                status: b.status,
                createdAt: b.createdAt,
              },
              ...prev,
            ];
          });
          return;
        }

        case "booking.deleted": {
          const { _id } = event.payload as BookingDeletedPayload;
          setBookings((prev) => prev.filter((b) => b.id !== _id));
          return;
        }

        case "message.read_state_changed": {
          const { customerId, messageIds, isRead } = event.payload as ReadStateChangedPayload;
          const idSet = new Set(messageIds);
          setConversations((prev) =>
            prev.map((c) =>
              c.id === customerId
                ? {
                    ...c,
                    messages: c.messages.map((m) => (idSet.has(m.id) ? { ...m, read: isRead } : m)),
                  }
                : c,
            ),
          );
          return;
        }

        default:
        // Unrecognized event type — ignore, so the backend can add more later.
      }
    });
    return disconnect;
  }, []);

  const summaries = useMemo(
    () =>
      conversations
        .map(toSummary)
        .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)),
    [conversations],
  );

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const value = useMemo<ConversationsApi>(
    () => ({
      conversations,
      summaries,
      selectedId,
      selectedConversation,
      selectConversation,
      sendMessage,
      setMode,
      markAsRead,
      receiveCustomerMessage,
      updateMessageStatus,
      sending,
      bookings,
      deleteBooking,
    }),
    [
      bookings,
      conversations,
      deleteBooking,
      markAsRead,
      receiveCustomerMessage,
      selectConversation,
      selectedConversation,
      selectedId,
      sendMessage,
      sending,
      setMode,
      summaries,
      updateMessageStatus,
    ],
  );

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversations(): ConversationsApi {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error("useConversations must be used inside ConversationsProvider");
  return ctx;
}
