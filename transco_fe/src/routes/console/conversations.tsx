import { createFileRoute } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";

import { ChatPanel } from "@/components/transco/chat-panel";
import { ContactList } from "@/components/transco/contact-list";
import { CustomerContextPanel } from "@/components/transco/customer-context-panel";
import { EmptyState } from "@/components/transco/page-kit";
import { useConversations } from "@/lib/transco/store";

// Unchanged from the old /console "conversations" tab (ConsoleBody) —
// same component, same props, same useConversations() wiring. Only
// the URL is new; every existing filter (All/Unread/Staff/Attention,
// WhatsApp/Website), chatbot/staff switching, and WebSocket-driven
// live update keeps working exactly as before.
export const Route = createFileRoute("/console/conversations")({
  component: ConversationsPage,
});

function ConversationsPage() {
  const {
    summaries,
    selectedId,
    selectedConversation,
    selectConversation,
    sendMessage,
    sendAttachment,
    setMode,
    sending,
    websitePaused,
    whatsappPaused,
    bookings,
    shipments,
  } = useConversations();

  return (
    <div className="flex h-full min-h-0">
      <aside
        className={`w-full shrink-0 border-r border-border md:block md:w-[320px] lg:w-[360px] ${
          selectedConversation ? "hidden md:block" : "block"
        }`}
      >
        <ContactList
          conversations={summaries}
          selectedId={selectedId}
          onSelect={selectConversation}
          websitePaused={websitePaused}
          whatsappPaused={whatsappPaused}
        />
      </aside>

      <div className={`min-w-0 flex-1 ${selectedConversation ? "flex" : "hidden md:flex"}`}>
        {selectedConversation ? (
          <>
            <div className="min-w-0 flex-1">
              <ChatPanel
                conversation={selectedConversation}
                sending={sending}
                onSend={(body) => sendMessage(selectedConversation.id, body)}
                onSendAttachment={(file, caption) => sendAttachment(selectedConversation.id, file, caption)}
                onModeChange={(mode) => setMode(selectedConversation.id, mode)}
                onBack={() => selectConversation(null)}
              />
            </div>
            <CustomerContextPanel conversation={selectedConversation} bookings={bookings} shipments={shipments} />
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
