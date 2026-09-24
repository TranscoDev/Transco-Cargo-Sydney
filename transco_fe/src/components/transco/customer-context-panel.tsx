import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Mail, Package, Phone, Receipt, Ship, SquareUserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  CUSTOMER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  type Booking,
  type Conversation,
  type Shipment,
} from "@/lib/transco/types";

/** Right-side context panel for the selected conversation — purely
 * additive to the existing chat view (chat-panel.tsx is untouched).
 * Recent bookings and shipments come from the already-loaded global
 * lists (useConversations()), filtered client-side by customerId — no
 * extra fetch, no duplicated data. Outstanding payments don't exist yet
 * (Phase 5), so that section says so rather than showing a fake number. */
export function CustomerContextPanel({
  conversation,
  bookings,
  shipments,
}: {
  conversation: Conversation;
  bookings: Booking[];
  shipments: Shipment[];
}) {
  const recentBookings = bookings
    .filter((b) => b.customerId === conversation.id)
    .slice(0, 3);

  const activeShipments = shipments
    .filter((s) => s.customerId === conversation.id && s.status !== "delivered")
    .slice(0, 3);

  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border bg-panel p-4 xl:block">
      <div className="mb-4">
        <p className="text-sm font-semibold text-foreground">{conversation.customerName}</p>
        <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Phone className="h-3 w-3" />
            {conversation.phoneNumber}
          </span>
          {conversation.email && (
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3 w-3" />
              {conversation.email}
            </span>
          )}
        </div>
        <span
          className={cn(
            "mt-2 inline-flex items-center rounded px-1.5 py-0.5 text-[11px]",
            conversation.status === "DO_NOT_CONTACT" || conversation.status === "BLOCKED"
              ? "bg-destructive/15 text-destructive"
              : "bg-secondary text-secondary-foreground",
          )}
        >
          {CUSTOMER_STATUS_LABELS[conversation.status ?? "ACTIVE"]}
        </span>
      </div>

      <Section icon={CalendarClock} title="Recent Bookings">
        {recentBookings.length === 0 ? (
          <EmptyLine text="No bookings yet." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {recentBookings.map((b) => (
              <div key={b.id} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{b.resolvedDate}</span>
                  <span className="capitalize text-muted-foreground">{b.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Ship} title="Active Shipments">
        {activeShipments.length === 0 ? (
          <EmptyLine text="No active shipments." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {activeShipments.map((s) => (
              <Link
                key={s.id}
                to="/console/shipments/$shipmentId"
                params={{ shipmentId: s.id }}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.shipmentNumber}</span>
                  <span className="text-muted-foreground">{SHIPMENT_STATUS_LABELS[s.status]}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Receipt} title="Outstanding Payments">
        <EmptyLine text="Available in Phase 5." />
      </Section>

      <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4">
        <Link
          to="/console/customers/$customerId"
          params={{ customerId: conversation.id }}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-primary hover:bg-secondary"
        >
          <SquareUserRound className="h-3.5 w-3.5" />
          View Customer Profile
        </Link>
        <Link
          to="/console/bookings"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-primary hover:bg-secondary"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          View Bookings
        </Link>
      </div>
    </aside>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Package; title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      {children}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">{text}</p>;
}
