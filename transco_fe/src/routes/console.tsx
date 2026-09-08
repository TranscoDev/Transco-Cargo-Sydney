import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";

import { BookingsPanel } from "@/components/transco/bookings-panel";
import { ChatPanel } from "@/components/transco/chat-panel";
import { ConsoleLayout, type ConsoleTab } from "@/components/transco/console-layout";
import { ContactList } from "@/components/transco/contact-list";
import { getCurrentUser, logout } from "@/lib/transco/auth";
import { ConversationsProvider, useConversations } from "@/lib/transco/store";

export const Route = createFileRoute("/console")({
  head: () => ({
    meta: [
      { title: "Conversation Console — Transco" },
      {
        name: "description",
        content:
          "Monitor WhatsApp customer conversations, spot unread messages, and hand chats between chatbot and staff.",
      },
      { property: "og:title", content: "Conversation Console — Transco" },
      {
        property: "og:description",
        content: "Monitor WhatsApp customer conversations and hand chats between chatbot and staff.",
      },
    ],
  }),
  component: ConsolePage,
});

function ConsolePage() {
  const navigate = useNavigate();
  const [agentName, setAgentName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ConsoleTab>("conversations");

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) void navigate({ to: "/" });
    else setAgentName(user.name);
  }, [navigate]);

  if (!agentName) return null;

  return (
    <ConversationsProvider>
      <ConsoleLayout
        agentName={agentName}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={() => {
          logout();
          void navigate({ to: "/" });
        }}
      >
        {activeTab === "bookings" ? <ConsoleBookings /> : <ConsoleBody />}
      </ConsoleLayout>
    </ConversationsProvider>
  );
}

function ConsoleBookings() {
  const { bookings, deleteBooking } = useConversations();
  return <BookingsPanel bookings={bookings} onDelete={deleteBooking} />;
}

function ConsoleBody() {
  const {
    summaries,
    selectedId,
    selectedConversation,
    selectConversation,
    sendMessage,
    setMode,
    sending,
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
        />
      </aside>

      <div className={`min-w-0 flex-1 ${selectedConversation ? "block" : "hidden md:block"}`}>
        {selectedConversation ? (
          <ChatPanel
            conversation={selectedConversation}
            sending={sending}
            onSend={(body) => sendMessage(selectedConversation.id, body)}
            onModeChange={(mode) => setMode(selectedConversation.id, mode)}
            onBack={() => selectConversation(null)}
          />
        ) : (
          <div className="grid h-full place-items-center bg-chat-canvas px-6 text-center">
            <div>
              <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium text-foreground">Select a conversation</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Yellow-highlighted chats are currently handled by staff.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}