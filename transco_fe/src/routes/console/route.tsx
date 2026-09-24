import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";

import { ConsoleLayout } from "@/components/transco/console-layout";
import { getCurrentUser, logout } from "@/lib/transco/auth";
import { ConversationsProvider, useConversations } from "@/lib/transco/store";

// This used to be a single flat route (src/routes/console.tsx) that
// switched between Conversations/Bookings/Contacts via local tab
// state. It's now the shared layout for every /console/* page (sidebar
// + auth + live data), with each former tab moved to its own child
// route below. Deliberately kept the SAME client-side-effect auth
// check as before (not a router beforeLoad guard) — this is a
// server-rendered app and getCurrentUser() reads sessionStorage, which
// doesn't exist during SSR, so a beforeLoad guard would incorrectly
// redirect a genuinely logged-in user on first load.
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
  component: ConsoleRouteComponent,
});

function ConsoleRouteComponent() {
  const navigate = useNavigate();
  const [agentName, setAgentName] = useState<string | null>(null);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) void navigate({ to: "/" });
    else setAgentName(user.name);
  }, [navigate]);

  if (!agentName) return null;

  return (
    <ConversationsProvider>
      <ConsoleLayoutWithData
        agentName={agentName}
        onLogout={() => {
          logout();
          void navigate({ to: "/" });
        }}
      >
        <Outlet />
      </ConsoleLayoutWithData>
    </ConversationsProvider>
  );
}

function ConsoleLayoutWithData({
  children,
  ...rest
}: {
  agentName: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const { websitePaused, whatsappPaused, updatePauseState } = useConversations();
  return (
    <ConsoleLayout
      {...rest}
      websitePaused={websitePaused}
      whatsappPaused={whatsappPaused}
      onUpdatePauseState={updatePauseState}
    >
      {children}
    </ConsoleLayout>
  );
}
