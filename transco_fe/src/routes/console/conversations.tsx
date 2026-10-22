import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";

import { ChatPanel } from "@/components/transco/chat-panel";
import { ContactList } from "@/components/transco/contact-list";
import { CustomerContextPanel } from "@/components/transco/customer-context-panel";
import { EmptyState } from "@/components/transco/page-kit";
import { mergeSummaries, mergedMessages } from "@/lib/transco/merge-conversations";
import { useConversations } from "@/lib/transco/store";
import { useTasks } from "@/lib/transco/tasks";
import type { Conversation } from "@/lib/transco/types";
import { cn } from "@/lib/utils";

// Same filters, chatbot/staff switching and live updates as before. One
// change: a customer's signed-in website chats are shown in their WhatsApp
// row (one row per customer — see merge-conversations.ts), and opening it
// shows both chats together, each message labelled with its channel.
export const Route = createFileRoute("/console/conversations")({
  component: ConversationsPage,
});

type View = "all" | "whatsapp" | "website";

function ConversationsPage() {
  const {
    conversations,
    summaries,
    selectedId,
    selectedConversation,
    selectConversation,
    markAsRead,
    sendMessage,
    sendAttachment,
    setMode,
    setInbox,
    sending,
    websitePaused,
    whatsappPaused,
    bookings,
    shipments,
  } = useConversations();
  const { me } = useTasks();

  const rows = useMemo(() => mergeSummaries(summaries), [summaries]);
  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;
  const web = useMemo(
    () => (selectedRow?.mergedIds ?? []).map((id) => conversations.find((c) => c.id === id)).filter((c): c is Conversation => !!c),
    [selectedRow, conversations],
  );

  const [view, setView] = useState<View>("all");
  // Which chat a staff reply goes to: the WhatsApp one, or a website chat.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // Contact info drawer (replaces the old always-on right sidebar).
  const [infoOpen, setInfoOpen] = useState(false);

  const select = (id: string | null) => {
    setView("all");
    setInfoOpen(false);
    setReplyTo(null);
    selectConversation(id);
    rows.find((r) => r.id === id)?.mergedIds?.forEach((m) => markAsRead(m));
  };

  const merged = web.length > 0 && selectedConversation;
  const target = (merged && replyTo ? conversations.find((c) => c.id === replyTo) : null) ?? selectedConversation;
  const shown: Conversation | null = !selectedConversation || !target
    ? null
    : merged
      ? {
          ...target,
          // The customer's name and number, whichever chat replies go to.
          customerName: selectedConversation.customerName,
          phoneNumber: selectedConversation.phoneNumber,
          messages: mergedMessages(
            view === "whatsapp" ? [selectedConversation] : view === "website" ? web : [selectedConversation, ...web],
          ),
        }
      : selectedConversation;

  return (
    <div className="flex h-full min-h-0">
      <aside
        className={`w-full shrink-0 border-r border-border md:block md:w-[320px] lg:w-[360px] ${
          selectedConversation ? "hidden md:block" : "block"
        }`}
      >
        <ContactList
          conversations={rows}
          selectedId={selectedId}
          onSelect={select}
          websitePaused={websitePaused}
          whatsappPaused={whatsappPaused}
          onInbox={(id, flags) => {
            setInbox(id, flags);
            // Like WhatsApp: marking the open chat unread (or deleting it) closes it.
            if (id === selectedId && (flags.markedUnread || flags.deleted)) select(null);
          }}
          onMarkRead={(id) => {
            markAsRead(id);
            rows.find((r) => r.id === id)?.mergedIds?.forEach((m) => markAsRead(m));
          }}
          canDelete={!!me?.canDeleteChats}
        />
      </aside>

      <div className={`min-w-0 flex-1 ${selectedConversation ? "flex" : "hidden md:flex"}`}>
        {shown && target ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col">
              {merged && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2 md:px-4">
                  {(["all", "whatsapp", "website"] as View[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setView(v)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium",
                        view === v ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      {v === "all" ? "All" : v === "whatsapp" ? "💬 WhatsApp" : "🌐 Website"}
                    </button>
                  ))}
                  <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    Reply on
                    <select
                      value={target.id}
                      onChange={(e) => setReplyTo(e.target.value)}
                      className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground"
                    >
                      <option value={selectedConversation.id}>WhatsApp</option>
                      {web.map((w, i) => (
                        <option key={w.id} value={w.id}>
                          Website chat{web.length > 1 ? ` ${i + 1}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <ChatPanel
                  conversation={shown}
                  sending={sending}
                  onSend={(body) => sendMessage(target.id, body)}
                  onSendAttachment={(file, caption) => sendAttachment(target.id, file, caption)}
                  onModeChange={(mode) => setMode(target.id, mode)}
                  onBack={() => select(null)}
                  onShowInfo={() => setInfoOpen(true)}
                />
              </div>
            </div>
            {infoOpen && (
              <CustomerContextPanel
                conversation={selectedConversation!}
                bookings={bookings}
                shipments={shipments}
                onClose={() => setInfoOpen(false)}
              />
            )}
          </>
        ) : (
          <div className="grid h-full place-items-center bg-chat-canvas px-6">
            <EmptyState
              icon={MessagesSquare}
              title="Choose a conversation"
              description="Pick a chat on the left to read it and reply. Chats highlighted in yellow are being handled by staff; the bot answers the rest."
            />
          </div>
        )}
      </div>
    </div>
  );
}
