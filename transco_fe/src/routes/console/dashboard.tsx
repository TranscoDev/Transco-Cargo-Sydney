import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  MapPin,
  MessageCircle,
  PackageCheck,
  Search,
  QrCode,
  Ship,
  Sunrise,
  type LucideIcon,
} from "lucide-react";

import { useWalkInsToConfirm } from "@/components/transco/console-layout";
import { EmptyState, ErrorState, PageShell, SectionHeading, StatusBadge, type StatusTone } from "@/components/transco/page-kit";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchDashboardSummary, type DashboardSummary } from "@/lib/transco/api";

export const Route = createFileRoute("/console/dashboard")({
  component: DashboardPage,
});

/**
 * The morning check-in: a greeting, today's real numbers, and the work
 * that needs doing — each item a single click from where it's done.
 * Every number comes from /api/dashboard/summary; nothing is invented,
 * and a count the backend doesn't return is simply not shown.
 */
function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    fetchDashboardSummary()
      .then(setSummary)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });

  return (
    <PageShell>
      <header className="mb-8">
        <p className="text-sm text-muted-foreground">{today}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {greeting()} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Here's what needs your attention today.</p>
      </header>

      {failed ? (
        <ErrorState
          title="Couldn't load today's overview"
          description="Everything else in Transco Admin still works — use the menu, or try again."
          onRetry={load}
        />
      ) : !summary ? (
        <DashboardSkeleton />
      ) : (
        <DashboardBody s={summary} />
      )}
    </PageShell>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// ---------------------------------------------------------------

type BookingsSearch = { show?: "declarations" | "bls" };

interface WorkItem {
  count: number;
  label: string;
  hint: string;
  to: string;
  search?: BookingsSearch;
  icon: LucideIcon;
  tone: StatusTone;
}

function DashboardBody({ s }: { s: DashboardSummary }) {
  const waiting = s.conversationsWaiting ?? s.unreadConversations;
  const dropOffs = s.todaysDropOffs ?? [];
  // Same count as the Walk-ins badge in the sidebar, so the two always agree.
  const walkIns = useWalkInsToConfirm();

  const stats: { label: string; value: number | undefined; to: string; search?: BookingsSearch; icon: LucideIcon }[] = [
    { label: "Drop-offs today", value: s.todaysBookings, to: "/console/bookings", icon: CalendarClock },
    { label: "Conversations waiting", value: waiting, to: "/console/conversations", icon: MessageCircle },
    { label: "Walk-ins to confirm", value: walkIns, to: "/console/walk-ins", icon: QrCode },
    { label: "Declarations to check", value: s.declarationsToCheck, to: "/console/bookings", search: { show: "declarations" }, icon: ClipboardCheck },
    { label: "BLs to assign", value: s.blsToAssign, to: "/console/bookings", search: { show: "bls" }, icon: PackageCheck },
  ];

  const work = ([
    {
      count: waiting,
      label: plural(waiting, "Reply to 1 conversation", `Reply to ${waiting} conversations`),
      hint: "Customers waiting for an answer, or chats the bot flagged for staff.",
      to: "/console/conversations",
      icon: MessageCircle,
      tone: "info",
    },
    {
      count: walkIns,
      label: plural(walkIns, "Confirm 1 walk-in", `Confirm ${walkIns} walk-ins`),
      hint: "Customers filled the QR form at the counter — check their boxes and confirm.",
      to: "/console/walk-ins",
      icon: QrCode,
      tone: "pending",
    },
    {
      count: s.declarationsToCheck ?? 0,
      label: plural(s.declarationsToCheck ?? 0, "Check 1 declaration", `Check ${s.declarationsToCheck} declarations`),
      hint: "Filled online by customers — open the booking, check it, mark it Checked.",
      to: "/console/bookings",
      search: { show: "declarations" },
      icon: ClipboardCheck,
      tone: "pending",
    },
    {
      count: s.blsToAssign ?? 0,
      label: plural(s.blsToAssign ?? 0, "Assign 1 BL", `Assign ${s.blsToAssign} BLs`),
      hint: "Boxes are in the warehouse — give each booking its shipment reference.",
      to: "/console/bookings",
      search: { show: "bls" },
      icon: PackageCheck,
      tone: "pending",
    },
  ] satisfies WorkItem[]).filter((w) => w.count > 0);

  return (
    <div className="flex flex-col gap-10">
      {/* TODAY */}
      <section>
        <SectionHeading>Today</SectionHeading>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats
            .filter((st) => st.value !== undefined)
            .map((st) => (
              <Link
                key={st.label}
                to={st.to}
                search={st.search ?? {}}
                className="group rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/30"
              >
                <div className="flex items-center justify-between">
                  <st.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <ChevronRight className="h-4 w-4 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" aria-hidden />
                </div>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-foreground">{st.value}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{st.label}</p>
              </Link>
            ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* YOUR WORK TODAY */}
        <section>
          <SectionHeading>Your work today</SectionHeading>
          {work.length ? (
            <ul className="flex flex-col gap-2">
              {work.map((w) => (
                <li key={w.label}>
                  <Link
                    to={w.to}
                    search={w.search ?? {}}
                    className="group flex items-center gap-4 rounded-xl border bg-card px-4 py-3.5 shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/30"
                  >
                    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", w.tone === "info" ? "bg-info-soft text-info-foreground" : "bg-warning-soft text-warning-foreground")}>
                      <w.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">{w.label}</span>
                      <span className="block text-sm text-muted-foreground">{w.hint}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border bg-card">
              <EmptyState icon={Sunrise} title="You're all caught up" description="No conversations, walk-ins, declarations or BLs are waiting. Everything is clear for now." />
            </div>
          )}
        </section>

        {/* TODAY'S DROP-OFFS */}
        <section>
          <SectionHeading
            action={
              <Link to="/console/bookings" className="text-sm font-medium text-primary hover:underline">
                All bookings
              </Link>
            }
          >
            Today's drop-offs
          </SectionHeading>
          <div className="rounded-xl border bg-card">
            {dropOffs.length ? (
              <ul className="divide-y">
                {dropOffs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-16 shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtTime(d.time)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{d.customerName ?? "Customer"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[d.bookingCode, d.boxSummary].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <BookingStatus status={d.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={CalendarClock} title="No drop-offs booked for today" description="New bookings will show up here." />
            )}
          </div>
        </section>
      </div>

      {/* QUICK ACTIONS */}
      <section>
        <SectionHeading>Quick actions</SectionHeading>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <QuickAction to="/console/customers" icon={Search} label="Find a customer" />
          <QuickAction to="/console/shipments" icon={Ship} label="Find a shipment" />
          <QuickAction to="/console/conversations" icon={MessageCircle} label="Conversations" />
          <QuickAction to="/console/bookings" icon={CalendarClock} label="Bookings" />
          <QuickAction to="/console/tracking" icon={MapPin} label="Track a BL" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {s.activeShipments} shipment{s.activeShipments === 1 ? "" : "s"} on the way · {s.newCustomersToday} new customer
          {s.newCustomersToday === 1 ? "" : "s"} today
        </p>
      </section>
    </div>
  );
}

function QuickAction({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      {label}
    </Link>
  );
}

const BOOKING_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "Pending", tone: "pending" },
  confirmed: { label: "Confirmed", tone: "info" },
  completed: { label: "Done", tone: "success" },
};

function BookingStatus({ status }: { status: string }) {
  const s = BOOKING_STATUS[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-10" aria-busy="true" aria-label="Loading today's overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

function fmtTime(t: string | null) {
  if (!t) return "—";
  const [h = NaN, m = 0] = t.split(":").map(Number);
  if (Number.isNaN(h)) return t;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}
