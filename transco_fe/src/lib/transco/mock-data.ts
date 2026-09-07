import type { Conversation, Message, MessageStatus, SenderType } from "./types";

/**
 * Mock data layer. Timestamps are generated as ISO/UTC strings relative to
 * "now" so the console always looks freshly active. Replace this module with
 * real REST data — nothing in the UI depends on how it is produced.
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

let seq = 0;
export function createMessage(
  conversationId: string,
  sender: SenderType,
  body: string,
  opts: { minutesAgo?: number; status?: MessageStatus; read?: boolean } = {},
): Message {
  seq += 1;
  return {
    id: `m_${conversationId}_${seq}`,
    conversationId,
    sender,
    body,
    createdAt: minutesAgo(opts.minutesAgo ?? 0),
    status: sender === "CUSTOMER" ? undefined : (opts.status ?? "SENT"),
    read: sender === "CUSTOMER" ? (opts.read ?? true) : undefined,
  };
}

export function getMockConversations(): Conversation[] {
  const c1: Conversation = {
    id: "c1",
    customerName: "Sarah Perera",
    phoneNumber: "+94 77 214 8890",
    mode: "HUMAN",
    messages: [
      createMessage("c1", "CUSTOMER", "Hi, I ordered a blender last Friday.", { minutesAgo: 61 }),
      createMessage("c1", "CHATBOT", "Hello Sarah! Could you share your order number?", {
        minutesAgo: 60,
        status: "READ",
      }),
      createMessage("c1", "CUSTOMER", "TR-99213. The tracking hasn't moved in 3 days.", {
        minutesAgo: 58,
      }),
      createMessage("c1", "HUMAN", "Hi Sarah, Nuwan here from Transco support. Checking now.", {
        minutesAgo: 20,
        status: "READ",
      }),
      createMessage("c1", "CUSTOMER", "Thank you. I really need it before the weekend.", {
        minutesAgo: 8,
        read: false,
      }),
      createMessage("c1", "CUSTOMER", "Any update?", { minutesAgo: 3, read: false }),
      createMessage("c1", "CUSTOMER", "I need help with my order", { minutesAgo: 1, read: false }),
    ],
  };

  const c2: Conversation = {
    id: "c2",
    customerName: "John Silva",
    phoneNumber: "+94 71 908 4412",
    mode: "CHATBOT",
    messages: [
      createMessage("c2", "CUSTOMER", "Good morning", { minutesAgo: 30 }),
      createMessage("c2", "CHATBOT", "Good morning! How can I help you today?", {
        minutesAgo: 29,
        status: "READ",
      }),
      createMessage("c2", "CUSTOMER", "Where is my order?", { minutesAgo: 12, read: false }),
      createMessage("c2", "CHATBOT", "Your order TR-88410 is out for delivery today.", {
        minutesAgo: 11,
        status: "DELIVERED",
      }),
    ],
  };

  const c3: Conversation = {
    id: "c3",
    customerName: "Mike Fernando",
    phoneNumber: "+94 76 331 2087",
    mode: "HUMAN",
    messages: [
      createMessage("c3", "CUSTOMER", "The delivery guy left the parcel with a neighbour.", {
        minutesAgo: 140,
      }),
      createMessage("c3", "HUMAN", "Sorry about that Mike — I've raised it with the courier.", {
        minutesAgo: 95,
        status: "READ",
      }),
      createMessage("c3", "HUMAN", "You'll get a call within 2 hours.", {
        minutesAgo: 94,
        status: "FAILED",
      }),
      createMessage("c3", "CUSTOMER", "Alright, appreciate it.", { minutesAgo: 47 }),
    ],
  };

  const c4: Conversation = {
    id: "c4",
    customerName: "David Rajapaksa",
    phoneNumber: "+94 70 555 1123",
    mode: "CHATBOT",
    messages: [
      createMessage("c4", "CUSTOMER", "Do you deliver to Kandy?", { minutesAgo: 300 }),
      createMessage("c4", "CHATBOT", "Yes, we deliver islandwide within 2–4 working days.", {
        minutesAgo: 299,
        status: "READ",
      }),
      createMessage("c4", "CUSTOMER", "Great, thanks!", { minutesAgo: 288 }),
    ],
  };

  const c5: Conversation = {
    id: "c5",
    customerName: "Nadeesha Kumari",
    phoneNumber: "+94 78 442 7761",
    mode: "CHATBOT",
    messages: [
      createMessage("c5", "CUSTOMER", "I want to return an item", { minutesAgo: 1500 }),
      createMessage("c5", "CHATBOT", "I can start a return. Is the item unopened?", {
        minutesAgo: 1498,
        status: "SENT",
      }),
      createMessage("c5", "CUSTOMER", "Yes it is unopened.", { minutesAgo: 1450, read: false }),
      createMessage("c5", "CUSTOMER", "Please send the pickup slip.", {
        minutesAgo: 1445,
        read: false,
      }),
    ],
  };

  const c6: Conversation = {
    id: "c6",
    customerName: "Ayesha Ismail",
    phoneNumber: "+94 75 620 3390",
    mode: "HUMAN",
    messages: [
      createMessage("c6", "CUSTOMER", "My invoice has the wrong address.", { minutesAgo: 4400 }),
      createMessage("c6", "HUMAN", "Fixed and re-issued — check your email.", {
        minutesAgo: 4380,
        status: "READ",
      }),
    ],
  };

  const c7: Conversation = {
    id: "c7",
    customerName: "Ruwan Jayasuriya",
    phoneNumber: "+94 72 118 6654",
    mode: "CHATBOT",
    messages: [
      createMessage("c7", "CUSTOMER", "Is the espresso machine back in stock?", {
        minutesAgo: 8800,
      }),
      createMessage("c7", "CHATBOT", "Not yet — I'll notify you when it restocks.", {
        minutesAgo: 8799,
        status: "DELIVERED",
      }),
    ],
  };

  return [c1, c2, c3, c4, c5, c6, c7];
}

/** Canned inbound messages used by the local real-time simulation. */
export const simulatedInbound = [
  "Hello? Are you there?",
  "Can I change the delivery address?",
  "Just sent the payment receipt.",
  "Please call me when possible.",
  "Is there any discount for bulk orders?",
  "Thanks for the quick reply!",
];