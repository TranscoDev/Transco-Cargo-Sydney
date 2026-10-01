import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, ExternalLink, QrCode, Search } from "lucide-react";

import { BookingDetailsSheet } from "@/components/transco/booking-details-sheet";
import { EmptyState, PageHeader, PageShell, StatusBadge } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useConversations } from "@/lib/transco/store";
import type { Booking } from "@/lib/transco/types";

export const Route = createFileRoute("/console/walk-ins")({
  component: WalkInsPage,
});

const FORM_URL = "https://transco-agent-site.transcocargo.workers.dev/dropoff.html";

type View = "confirm" | "today" | "all";

function todayKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function dayLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
}

const toConfirm = (b: Booking) => b.walkInStatus !== "finalised" && b.status !== "cancelled";

/**
 * Customers who came without a booking and filled the drop-off form on
 * their phone (the QR code at the counter). Staff check the boxes, value
 * each item and assign the BL to confirm — all from the panel a row opens.
 */
function WalkInsPage() {
  const { bookings, shipments } = useConversations();
  const today = useMemo(() => todayKey(), []);
  const walkIns = useMemo(() => bookings.filter((b) => b.channel === "walk_in"), [bookings]);
  const counts = useMemo(
    () => ({
      confirm: walkIns.filter(toConfirm).length,
      today: walkIns.filter((b) => b.resolvedDate === today && b.status !== "cancelled").length,
      all: walkIns.length,
    }),
    [walkIns, today],
  );
  const [view, setView] = useState<View>(counts.confirm > 0 ? "confirm" : "today");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const blByShipment = useMemo(() => new Map(shipments.map((s) => [s.id, s.hblNumber ?? null])), [shipments]);

  const q = query.trim().toLowerCase();
  const list = walkIns
    .filter((b) => (view === "confirm" ? toConfirm(b) : view === "today" ? b.resolvedDate === today : true))
    .filter((b) => {
      if (!q) return true;
      const bl = b.shipmentId ? blByShipment.get(b.shipmentId) ?? "" : "";
      return [b.customerName, b.phoneNumber, b.bookingCode, b.receiver?.fullName, bl].some((v) => (v ?? "").toLowerCase().includes(q));
    })
    .sort((a, b) => (b.resolvedDate + b.requestedTime).localeCompare(a.resolvedDate + a.requestedTime));

  // Group by day so "All" reads like a diary.
  const groups = new Map<string, Booking[]>();
  for (const b of list) {
    const bucket = groups.get(b.resolvedDate);
    if (bucket) bucket.push(b);
    else groups.set(b.resolvedDate, [b]);
  }

  const tabs: { key: View; label: string; count: number; attention?: boolean }[] = [
    { key: "confirm", label: "To confirm", count: counts.confirm, attention: counts.confirm > 0 },
    { key: "today", label: "Today", count: counts.today },
    { key: "all", label: "All", count: counts.all },
  ];

  return (
    <PageShell width="narrow">
      <PageHeader
        icon={QrCode}
        title="Walk-ins (QR)"
        description="Customers who came without a booking and filled the drop-off form on their phone."
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={FORM_URL} target="_blank" rel="noreferrer">
              Open the form <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </a>
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg bg-secondary p-1" role="tablist" aria-label="Which walk-ins">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={view === t.key}
              onClick={() => setView(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                view === t.key ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-xs font-semibold leading-5 tabular-nums",
                    t.attention ? "bg-attention-soft text-attention-foreground" : "bg-background text-muted-foreground",
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, BL"
            aria-label="Search walk-ins"
            className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
          />
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={view === "confirm" && !q ? Check : QrCode}
            title={q ? "No walk-ins found" : view === "confirm" ? "Nothing to confirm" : view === "today" ? "No walk-ins today" : "No walk-ins yet"}
            description={
              q
                ? "Try a name, phone number or BL."
                : view === "confirm"
                  ? "New walk-in forms appear here the moment a customer sends one."
                  : "When a customer fills the QR form at the counter, it shows up here."
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {[...groups.entries()].map(([day, items]) => (
            <section key={day}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{dayLabel(day)}</h2>
                {day === today && <StatusBadge tone="info">Today</StatusBadge>}
                <span className="text-sm text-muted-foreground">· {items.length}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {items.map((b) => (
                  <WalkInRow key={b.id} booking={b} bl={b.shipmentId ? blByShipment.get(b.shipmentId) ?? null : null} onOpen={() => setOpen(b.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {open && <BookingDetailsSheet bookingId={open} open onOpenChange={(o) => !o && setOpen(null)} />}
    </PageShell>
  );
}

function WalkInRow({ booking: b, bl, onOpen }: { booking: Booking; bl: string | null; onOpen: () => void }) {
  const pending = toConfirm(b);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 rounded-xl border bg-card px-4 py-3 text-left shadow-xs transition-colors hover:border-primary/40"
      >
        <span className="w-12 shrink-0 text-center text-base font-semibold tabular-nums text-foreground">{b.requestedTime}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-base font-semibold text-foreground">{b.customerName || b.phoneNumber}</span>
            {b.walkInReturning ? <StatusBadge tone="info">Returning</StatusBadge> : <StatusBadge tone="neutral">New customer</StatusBadge>}
            {b.status === "cancelled" ? (
              <StatusBadge tone="neutral">Cancelled</StatusBadge>
            ) : pending ? (
              <StatusBadge tone="attention">To confirm</StatusBadge>
            ) : (
              <StatusBadge tone="success">Confirmed</StatusBadge>
            )}
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {[b.boxSummary, b.receiver ? `To ${b.receiver.fullName}${b.receiver.town ? `, ${b.receiver.town}` : ""}` : null, b.phoneNumber].filter(Boolean).join(" · ")}
          </span>
        </span>
        {bl ? (
          <span className="shrink-0 text-right">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">BL</span>
            <span className="block text-sm font-semibold tabular-nums text-foreground">{bl}</span>
          </span>
        ) : pending ? (
          <span className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Confirm</span>
        ) : null}
      </button>
    </li>
  );
}
