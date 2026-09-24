import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  DollarSign,
  MessageSquareDot,
  Package,
  Receipt,
  UserPlus,
  Wallet,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchDashboardSummary, type DashboardSummary } from "@/lib/transco/api";

export const Route = createFileRoute("/console/dashboard")({
  component: DashboardPage,
});

interface MetricCard {
  label: string;
  icon: typeof CalendarClock;
  value: number | null;
  /** Shown instead of a number when the underlying module hasn't
   * shipped yet — never a fake 0 that could be mistaken for real data. */
  unavailableReason?: string;
  to?: string;
}

function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDashboardSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load dashboard");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards: MetricCard[] = [
    { label: "Today's Bookings", icon: CalendarClock, value: summary?.todaysBookings ?? null, to: "/console/bookings" },
    { label: "New Customers Today", icon: UserPlus, value: summary?.newCustomersToday ?? null, to: "/console/customers" },
    { label: "Unread Conversations", icon: MessageSquareDot, value: summary?.unreadConversations ?? null, to: "/console/conversations" },
    { label: "Flagged for Attention", icon: AlertTriangle, value: summary?.attentionConversations ?? null, to: "/console/conversations" },
    { label: "Active Shipments", icon: Package, value: summary?.activeShipments ?? null, to: "/console/shipments" },
    { label: "Revenue", icon: DollarSign, value: null, unavailableReason: "Available in Phase 5" },
    { label: "Payments Received", icon: Wallet, value: null, unavailableReason: "Available in Phase 5" },
    { label: "Outstanding Payments", icon: Receipt, value: null, unavailableReason: "Available in Phase 5" },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <h1 className="mb-1 text-lg font-semibold text-foreground">Dashboard</h1>
      <p className="mb-5 text-sm text-muted-foreground">A quick snapshot of what needs attention today.</p>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const body = (
            <Card key={card.label} className="transition-colors hover:border-primary/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{card.label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {card.unavailableReason ? (
                  <p className="text-xs text-muted-foreground">{card.unavailableReason}</p>
                ) : (
                  <p className="text-2xl font-semibold tabular-nums text-foreground">
                    {card.value === null && !error ? "—" : (card.value ?? 0)}
                  </p>
                )}
              </CardContent>
            </Card>
          );
          return card.to ? (
            <Link key={card.label} to={card.to}>
              {body}
            </Link>
          ) : (
            body
          );
        })}
      </div>

      <div className="mt-6 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
        Low-stock alerts, pending staff actions, and recent activity will appear here once Inventory
        (Phase 3) and the remaining modules ship.
      </div>
    </div>
  );
}
