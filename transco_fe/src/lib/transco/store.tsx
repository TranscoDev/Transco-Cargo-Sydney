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
import { logout as clearSession } from "./auth";
import {
  createManualContact,
  createSegment as createSegmentRequest,
  deleteBooking as deleteBookingRequest,
  deleteSegment as deleteSegmentRequest,
  fetchBookings,
  fetchConversations,
  fetchPauseState,
  fetchSegments,
  fetchShipments,
  importCustomersFile,
  mapMessage,
  markConversationRead,
  sendEmailCampaign as sendEmailCampaignRequest,
  sendAttachment as sendAttachmentRequest,
  sendHumanMessage,
  setCustomerMode,
  setPauseState as setPauseStateRequest,
  updateBooking as updateBookingRequest,
  assignBookingBl as assignBookingBlRequest,
  updateBookingStatus as updateBookingStatusRequest,
  updateContactInfo as updateContactInfoRequest,
  updateCustomerStatus as updateCustomerStatusRequest,
  type PauseState,
} from "./api";
import {
  connectConsoleSocket,
  type BookingCreatedPayload,
  type BookingDeletedPayload,
  type BookingStatusChangedPayload,
  type ContactUpdatedPayload,
  type PauseStateChangedPayload,
  type MessageCreatedPayload,
  type ModeChangedPayload,
  type NeedsAttentionPayload,
  type ReadStateChangedPayload,
  type StatusChangedPayload,
} from "./socket";
import type {
  Booking,
  BookingStatus,
  BookingUpdateInput,
  CampaignAttachment,
  Conversation,
  ConversationMode,
  ConversationSummary,
  CustomerStatus,
  EmailCampaignResult,
  ImportResult,
  Message,
  MessageStatus,
  Segment,
  SegmentFilter,
  Shipment,
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
  /** WhatsApp only for now — throws if the conversation isn't in HUMAN
   * mode or there's no live backend. See sendAttachment in api.ts. */
  sendAttachment: (conversationId: string, file: File, caption?: string) => Promise<void>;
  setMode: (conversationId: string, mode: ConversationMode) => void;
  markAsRead: (conversationId: string) => void;
  /** Simulates an inbound WhatsApp event; stands in for a socket push. */
  receiveCustomerMessage: (conversationId: string, body: string) => void;
  updateMessageStatus: (messageId: string, status: MessageStatus) => void;
  sending: boolean;
  /** Weekday drop-off bookings collected by the chatbot, newest first. */
  bookings: Booking[];
  /** Live operational shipments (Phase 2), newest first — loaded once
   * for the whole console so the conversation context panel doesn't
   * need its own fetch. */
  shipments: Shipment[];
  deleteBooking: (bookingId: string) => void;
  updateBookingStatus: (bookingId: string, status: BookingStatus) => void;
  /** General field update (Phase 2 extended fields) — separate from
   * updateBookingStatus above, which is untouched. */
  updateBooking: (bookingId: string, updates: BookingUpdateInput) => void;
  /** Assigns the customer's BL to a booking (creates/links its shipment).
   * Not optimistic — rejects with the backend's message (e.g. a BL that's
   * already taken) so the form can show it. */
  assignBookingBl: (bookingId: string, hblNumber: string, batchNumber?: number | null) => Promise<void>;
  /** True while the website bot is paused — website visitors get a friendly
   * pause notice instead of an AI reply. Independent of whatsappPaused. */
  websitePaused: boolean;
  /** True while the WhatsApp bot is paused — independent of websitePaused. */
  whatsappPaused: boolean;
  /** Send only the flag(s) you want to change — e.g. `{ websitePaused: true }`
   * for "Pause Website Bot", or both together for "Stop All"/"Resume All". */
  updatePauseState: (partial: Partial<PauseState>) => void;
  /** Staff-entered contact details, editable from the Contacts directory. */
  updateContact: (conversationId: string, info: { email?: string; notes?: string }) => void;
  /** Independent of Source — staff-controlled classification (Active,
   * Historical, Needs Review, Do Not Contact, Blocked). */
  updateStatus: (conversationId: string, status: CustomerStatus) => void;
  /** Adds a staff-entered contact with no prior conversation. Resolves once
   * the backend confirms creation/match so the caller can close its form. */
  addContact: (info: {
    name: string;
    phone: string;
    email?: string | undefined;
    notes?: string | undefined;
  }) => Promise<void>;
  /** Sends a promo email to the given customer ids via Resend — WhatsApp
   * broadcast is intentionally not offered here (see the Contacts CRM
   * plan: blocked on Meta template approval + opt-in). */
  sendEmailCampaign: (
    customerIds: string[],
    subject: string,
    body: string,
    attachment?: CampaignAttachment | undefined,
  ) => Promise<EmailCampaignResult>;
  /** Staff-saved, reusable Contacts filter combinations — shared across
   * the whole console, not per-browser. */
  segments: Segment[];
  saveSegment: (name: string, filter: SegmentFilter) => Promise<void>;
  deleteSegment: (segmentId: string) => void;
  /** Bulk Excel/CSV import — for an updated sheet from management, not for
   * a single new contact (see addContact). Refreshes the full customer
   * list on success since it may create/update many customers at once. */
  importCustomers: (file: File) => Promise<ImportResult>;
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
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [websitePaused, setWebsitePausedState] = useState(false);
  const [whatsappPaused, setWhatsappPausedState] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const websitePausedRef = useRef(false);
  websitePausedRef.current = websitePaused;
  const whatsappPausedRef = useRef(false);
  whatsappPausedRef.current = whatsappPaused;

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
        const message = err instanceof Error ? err.message : "";
        // A reachable backend that rejects the request (expired/invalid
        // session — e.g. the server's session secret rotated) must never
        // be papered over with fabricated demo customers. Only a
        // genuinely unreachable backend (no server running at all, the
        // standalone-demo case) falls back to mock data.
        if (message.includes("(401)")) {
          console.warn("Session is no longer valid — signing out.", err);
          clearSession();
          window.location.href = "/";
          return;
        }
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

  useEffect(() => {
    let cancelled = false;
    fetchShipments()
      .then((real) => {
        if (cancelled) return;
        setShipments(real);
      })
      .catch((err) => {
        console.warn("Could not load shipments.", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSegments()
      .then((real) => {
        if (cancelled) return;
        setSegments(real);
      })
      .catch((err) => {
        console.warn("Could not load saved segments.", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPauseState()
      .then((state) => {
        if (cancelled) return;
        setWebsitePausedState(state.websitePaused);
        setWhatsappPausedState(state.whatsappPaused);
      })
      .catch((err) => {
        console.warn("Could not load pause state.", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updatePauseState = useCallback((partial: Partial<PauseState>) => {
    // Optimistic: apply locally right away, roll back just the fields
    // this call touched if the request fails (a later, unrelated update
    // may have already moved local state on, so only revert what's
    // actually still equal to what we optimistically set).
    const prevWebsite = websitePausedRef.current;
    const prevWhatsapp = whatsappPausedRef.current;

    if (partial.websitePaused !== undefined) setWebsitePausedState(partial.websitePaused);
    if (partial.whatsappPaused !== undefined) setWhatsappPausedState(partial.whatsappPaused);

    setPauseStateRequest(partial).catch((err) => {
      console.error("Failed to persist pause state:", err);
      if (partial.websitePaused !== undefined) {
        setWebsitePausedState((current) => (current === partial.websitePaused ? prevWebsite : current));
      }
      if (partial.whatsappPaused !== undefined) {
        setWhatsappPausedState((current) => (current === partial.whatsappPaused ? prevWhatsapp : current));
      }
    });
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

  const updateBookingStatus = useCallback((bookingId: string, status: BookingStatus) => {
    // Optimistic; reverted on failure the same way deleteBooking is above.
    let previousStatus: BookingStatus | undefined;
    setBookings((prev) =>
      prev.map((b) => {
        if (b.id !== bookingId) return b;
        previousStatus = b.status;
        return { ...b, status };
      }),
    );
    updateBookingStatusRequest(bookingId, status).catch((err) => {
      console.error("Failed to update booking status:", err);
      if (previousStatus) {
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, status: previousStatus! } : b)),
        );
      }
    });
  }, []);

  const updateBooking = useCallback((bookingId: string, updates: BookingUpdateInput) => {
    // Optimistic; reverted on failure the same way updateBookingStatus is.
    let previous: Booking | undefined;
    setBookings((prev) =>
      prev.map((b) => {
        if (b.id !== bookingId) return b;
        previous = b;
        return { ...b, ...updates };
      }),
    );
    updateBookingRequest(bookingId, updates).catch((err) => {
      console.error("Failed to update booking:", err);
      if (previous) {
        setBookings((prevList) =>
          prevList.map((b) => (b.id === bookingId ? previous! : b)),
        );
      }
    });
  }, []);

  const assignBookingBl = useCallback(
    async (bookingId: string, hblNumber: string, batchNumber?: number | null) => {
      const { shipmentId } = await assignBookingBlRequest(bookingId, hblNumber, batchNumber);
      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, shipmentId, warehouseStatus: "received" } : b)),
      );
    },
    [],
  );

  const patch = useCallback((conversationId: string, fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? fn(c) : c)));
  }, []);

  const updateContact = useCallback(
    (conversationId: string, info: { email?: string; notes?: string }) => {
      patch(conversationId, (c) => ({
        ...c,
        email: info.email !== undefined ? info.email : c.email,
        notes: info.notes !== undefined ? info.notes : c.notes,
      }));
      updateContactInfoRequest(conversationId, info).catch((err) => {
        console.error("Failed to persist contact info:", err);
      });
    },
    [patch],
  );

  const updateStatus = useCallback(
    (conversationId: string, status: CustomerStatus) => {
      const previous = conversations.find((c) => c.id === conversationId)?.status;
      patch(conversationId, (c) => ({ ...c, status }));
      updateCustomerStatusRequest(conversationId, status).catch((err) => {
        console.error("Failed to persist customer status:", err);
        patch(conversationId, (c) => ({ ...c, status: previous }));
      });
    },
    [conversations, patch],
  );

  const addContact = useCallback(
    async (info: {
      name: string;
      phone: string;
      email?: string | undefined;
      notes?: string | undefined;
    }) => {
      const created = await createManualContact(info);
      setConversations((prev) => {
        const existingIdx = prev.findIndex((c) => c.id === created.id);
        if (existingIdx === -1) return [...prev, created];
        // Matched an existing customer (e.g. a historical import) — merge
        // rather than overwrite its conversation history with the empty
        // one this endpoint returns.
        const next = [...prev];
        next[existingIdx] = { ...prev[existingIdx]!, sources: created.sources };
        return next;
      });
    },
    [],
  );

  const importCustomers = useCallback(async (file: File) => {
    const result = await importCustomersFile(file);
    // May have created/matched many customers at once — a targeted patch
    // isn't worth the complexity here, just refetch the full list.
    try {
      const fresh = await fetchConversations();
      setConversations(fresh);
    } catch (err) {
      console.warn("Import succeeded but refreshing the contact list failed:", err);
    }
    return result;
  }, []);

  const sendEmailCampaign = useCallback(
    (customerIds: string[], subject: string, body: string, attachment?: CampaignAttachment | undefined) =>
      sendEmailCampaignRequest(customerIds, subject, body, attachment),
    [],
  );

  const saveSegment = useCallback(async (name: string, filter: SegmentFilter) => {
    const created = await createSegmentRequest(name, filter);
    setSegments((prev) => [...prev, created]);
  }, []);

  const deleteSegmentCb = useCallback(
    (segmentId: string) => {
      const previous = segments;
      setSegments((prev) => prev.filter((s) => s.id !== segmentId));
      deleteSegmentRequest(segmentId).catch((err) => {
        console.error("Failed to delete segment:", err);
        setSegments(previous);
      });
    },
    [segments],
  );

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

  const sendAttachment = useCallback(
    async (conversationId: string, file: File, caption?: string) => {
      const conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation || conversation.mode !== "HUMAN") {
        throw new Error("Switch to Staff mode before sending an attachment.");
      }
      if (!isLiveRef.current) {
        throw new Error("Attachments need a live backend connection — not available in demo mode.");
      }
      setSending(true);
      try {
        await sendAttachmentRequest(conversationId, file, caption);
        // No local append — same as sendMessage above, the message.created
        // broadcast is the single source that adds it.
      } finally {
        setSending(false);
      }
    },
    [conversations],
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
          const { customerId, messageId, whatsappStatus, failureReason } =
            event.payload as StatusChangedPayload;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === customerId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === messageId
                        ? { ...m, status: whatsappStatus, failureReason: failureReason ?? undefined }
                        : m,
                    ),
                  }
                : c,
            ),
          );
          return;
        }

        case "settings.pause_state_changed": {
          const { websitePaused: on, whatsappPaused: onWA } = event.payload as PauseStateChangedPayload;
          setWebsitePausedState(on);
          setWhatsappPausedState(onWA);
          return;
        }

        case "customer.contact_updated": {
          const { customerId, customer } = event.payload as ContactUpdatedPayload;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === customerId ? { ...c, email: customer.email, notes: customer.notes } : c,
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
                boxSummary: b.boxSummary,
                resolvedDate: b.resolvedDate,
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

        case "booking.status_changed": {
          const { _id, status } = event.payload as BookingStatusChangedPayload;
          setBookings((prev) => prev.map((b) => (b.id === _id ? { ...b, status } : b)));
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
      sendAttachment,
      setMode,
      markAsRead,
      receiveCustomerMessage,
      updateMessageStatus,
      sending,
      bookings,
      shipments,
      deleteBooking,
      updateBookingStatus,
      updateBooking,
      assignBookingBl,
      websitePaused,
      whatsappPaused,
      updatePauseState,
      updateContact,
      updateStatus,
      addContact,
      sendEmailCampaign,
      segments,
      saveSegment,
      deleteSegment: deleteSegmentCb,
      importCustomers,
    }),
    [
      bookings,
      shipments,
      conversations,
      deleteBooking,
      updateBookingStatus,
      updateBooking,
      assignBookingBl,
      websitePaused,
      whatsappPaused,
      markAsRead,
      receiveCustomerMessage,
      selectConversation,
      selectedConversation,
      selectedId,
      sendMessage,
      sendAttachment,
      sending,
      setMode,
      summaries,
      updatePauseState,
      updateContact,
      updateStatus,
      addContact,
      sendEmailCampaign,
      segments,
      saveSegment,
      deleteSegmentCb,
      importCustomers,
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
