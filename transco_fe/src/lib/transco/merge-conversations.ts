import type { Conversation, ConversationSummary, Message } from "./types";

/**
 * One row per customer in Conversations. A website chat where the visitor
 * was signed in to My Transco (linkedAccount) belongs to that customer, so
 * it is folded into the customer's WhatsApp row. Never by name: two people
 * called "Nimal Perera" stay two rows, and a website visitor who isn't
 * signed in always keeps a row of their own (we don't know who they are).
 */
export function mergeSummaries(summaries: ConversationSummary[]): ConversationSummary[] {
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const folded = new Map<string, ConversationSummary[]>(); // primary id → website chats folded into it
  const out: ConversationSummary[] = [];

  for (const s of summaries) {
    const owner = s.channel === "website" && s.linkedAccount ? byId.get(s.linkedAccount.id) : undefined;
    if (owner && owner.channel !== "website") {
      folded.set(owner.id, [...(folded.get(owner.id) ?? []), s]);
    }
  }
  for (const s of summaries) {
    const owner = s.channel === "website" && s.linkedAccount ? byId.get(s.linkedAccount.id) : undefined;
    if (owner && owner.channel !== "website") continue; // shown inside its customer's row
    const web = folded.get(s.id) ?? [];
    if (!web.length) {
      out.push({
        ...s,
        channels: [s.channel === "website" ? "website" : "whatsapp"],
        customerCode: s.linkedAccount?.customerCode ?? s.customerCode ?? null,
      });
      continue;
    }
    const all = [s, ...web];
    const latest = all.reduce((a, b) => (Date.parse(b.lastActivityAt) > Date.parse(a.lastActivityAt) ? b : a));
    out.push({
      ...s,
      lastMessage: latest.lastMessage,
      lastActivityAt: latest.lastActivityAt,
      unreadCount: all.reduce((n, x) => n + x.unreadCount, 0),
      needsAttention: all.some((x) => x.needsAttention),
      needsAttentionMessage: all.find((x) => x.needsAttention)?.needsAttentionMessage ?? s.needsAttentionMessage,
      mergedIds: web.map((w) => w.id),
      channels: ["whatsapp", "website"],
      customerCode: web.find((w) => w.linkedAccount?.customerCode)?.linkedAccount?.customerCode ?? s.customerCode ?? null,
    });
  }
  return out.sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
}

/** Every message of a customer's chats, in time order, each marked with where it came from. */
export function mergedMessages(conversations: Conversation[]): Message[] {
  return conversations
    .flatMap((c) => c.messages.map((m) => ({ ...m, via: c.channel === "website" ? ("website" as const) : ("whatsapp" as const) })))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
