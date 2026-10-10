import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";

import { ConsoleLayout } from "@/components/transco/console-layout";
import { canSee, getCurrentUser, logout, pageForPath, refreshAccess } from "@/lib/transco/auth";
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
      { title: "Transco Admin" },
      {
        name: "description",
        content:
          "Transco staff workspace — conversations, customers, bookings and shipments.",
      },
      { property: "og:title", content: "Transco Admin" },
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
  const [, setAccessVersion] = useState(0);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) void navigate({ to: "/" });
    else {
      setAgentName(user.name);
      // Page access may have changed since sign-in (Settings → Staff).
      void refreshAccess().then(() => setAccessVersion((n) => n + 1));
    }
  }, [navigate]);

  // A login limited to some pages lands on its first page instead of the
  // dashboard, and sees a short note on any page it doesn't have.
  const page = pageForPath(pathname);
  const firstPage = getCurrentUser()?.pages?.[0];
  useEffect(() => {
    if (!agentName || !firstPage) return;
    if (pathname === "/console" || pathname === "/console/" || (page === "dashboard" && !canSee("dashboard"))) {
      void navigate({ to: "/console/" + firstPage, replace: true });
    }
  }, [agentName, firstPage, page, pathname, navigate]);

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
        {canSee(page) ? <Outlet /> : <NoAccess home={firstPage ? "/console/" + firstPage : "/console/bookings"} />}
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

function NoAccess({ home }: { home: string }) {
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border bg-card p-6 text-center">
      <p className="text-base font-semibold text-foreground">You don't have access to this page</p>
      <p className="mt-1 text-sm text-muted-foreground">Ask the admin if you need it.</p>
      <Link to={home} className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
        Go to my pages
      </Link>
    </div>
  );
}
