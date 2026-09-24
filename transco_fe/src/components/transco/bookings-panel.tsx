import { useMemo, useState } from "react";
import { CalendarClock, Check, Package, RotateCcw, Search, Trash2, X } from "lucide-react";

import { BookingCalendar } from "@/components/transco/booking-calendar";
import { cn } from "@/lib/utils";
import type { Booking, BookingStatus } from "@/lib/transco/types";

const STATUS_FILTERS: (BookingStatus | "all")[] = ["all", "pending", "confirmed", "completed", "cancelled"];

const STATUS_BADGE: Record<BookingStatus, string> = {
  pending: "bg-human-soft text-human-foreground",
  confirmed: "bg-primary text-primary-foreground",
  completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  cancelled: "bg-secondary text-muted-foreground",
};

/** "Tuesday, 23 September" from a YYYY-MM-DD resolvedDate — every booking
 * shown under one header genuinely happened on this one calendar day, not
 * just "some Tuesday" (see groupByDate below — that used to be the bug). */
function dayLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function todayKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Groups by the actual resolved calendar date, not the recurring weekday
 * name — grouping by "tuesday" merged every Tuesday that ever had a
 * booking into one bucket, regardless of which week it was. */
function groupByDate(bookings: Booking[]): Map<string, Booking[]> {
  const groups = new Map<string, Booking[]>();
  for (const booking of bookings) {
    const key = booking.resolvedDate;
    const bucket = groups.get(key);
    if (bucket) bucket.push(booking);
    else groups.set(key, [booking]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.requestedTime.localeCompare(b.requestedTime));
  }
  return groups;
}

export function BookingsPanel({
  bookings,
  onDelete,
  onUpdateStatus,
}: {
  bookings: Booking[];
  onDelete: (bookingId: string) => void;
  onUpdateStatus: (bookingId: string, status: BookingStatus) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BookingStatus | "all">("all");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const today = useMemo(() => todayKey(), []);

  const stats = useMemo(() => {
    const s = { total: bookings.length, pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
    for (const b of bookings) s[b.status] += 1;
    return s;
  }, [bookings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookings.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (selectedDate && b.resolvedDate !== selectedDate) return false;
      if (!q) return true;
      return (
        (b.customerName || "").toLowerCase().includes(q) ||
        b.phoneNumber.replace(/\s/g, "").toLowerCase().includes(q.replace(/\s/g, ""))
      );
    });
  }, [bookings, query, statusFilter, selectedDate]);

  const grouped = groupByDate(filtered);
  // YYYY-MM-DD strings sort correctly as plain strings — no weekday
  // lookup table needed. Descending so the newest date shows first,
  // same as most activity feeds — older bookings scroll further down.
  const days = [...grouped.keys()].sort().reverse();

  return (
    <div className="flex h-full min-h-0 bg-chat-canvas">
      <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-border bg-panel px-4 py-6 lg:block">
        <p className="mb-3 text-xs font-semibold text-foreground">Calendar</p>
        <BookingCalendar bookings={bookings} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      </aside>

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-1 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold text-foreground">Weekday Drop-off Bookings</h1>
          <span className="ml-auto text-[11px] text-muted-foreground">{bookings.length} total</span>
        </div>

        {selectedDate && (
          <div className="mb-3 flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-[11px] text-primary">
            Showing bookings for{" "}
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-AU", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
            <button
              type="button"
              onClick={() => setSelectedDate(null)}
              className="ml-auto underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        <div className="mb-4 mt-3 flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", "Total", stats.total],
              ["pending", "Pending", stats.pending],
              ["confirmed", "Confirmed", stats.confirmed],
              ["completed", "Completed", stats.completed],
              ["cancelled", "Cancelled", stats.cancelled],
            ] as [BookingStatus | "all", string, number][]
          ).map(([key, label, value]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                statusFilter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
              )}
            >
              <span className="font-semibold">{value}</span> {label}
            </button>
          ))}
        </div>

        <div className="relative mb-5 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or phone"
            aria-label="Search bookings"
            className="h-9 w-full rounded-md border border-input bg-secondary/60 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:bg-panel"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
            {bookings.length === 0
              ? "No drop-off bookings yet. They'll show up here live as customers book through the chatbot."
              : "No bookings match this filter."}
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {days.map((day) => {
              const isToday = day === today;
              return (
                <div key={day}>
                  <div className="mb-2 flex items-center gap-2">
                    <h2
                      className={cn(
                        "text-xs font-semibold uppercase tracking-wide",
                        isToday ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {dayLabel(day)}
                    </h2>
                    {isToday && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        Today
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {grouped.get(day)!.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {grouped.get(day)!.map((booking) => (
                      <BookingCard
                        key={booking.id}
                        booking={booking}
                        highlighted={isToday}
                        onDelete={onDelete}
                        onUpdateStatus={onUpdateStatus}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function BookingCard({
  booking,
  highlighted,
  onDelete,
  onUpdateStatus,
}: {
  booking: Booking;
  highlighted: boolean;
  onDelete: (bookingId: string) => void;
  onUpdateStatus: (bookingId: string, status: BookingStatus) => void;
}) {
  const isCompleted = booking.status === "completed";
  const isCancelled = booking.status === "cancelled";
  const isPending = booking.status === "pending";
  const isConfirmed = booking.status === "confirmed";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-panel px-3.5 py-3 shadow-sm transition-colors",
        highlighted ? "border-primary/30" : "border-border",
        (isCompleted || isCancelled) && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "truncate text-sm font-medium text-foreground",
              isCompleted && "line-through",
            )}
          >
            {booking.customerName || booking.phoneNumber}
          </p>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
            {booking.requestedTime}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              STATUS_BADGE[booking.status],
            )}
          >
            {booking.status}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{booking.phoneNumber}</p>
        {booking.boxSummary && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Package className="h-3 w-3 shrink-0" />
            {booking.boxSummary}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isPending && (
          <>
            <button
              type="button"
              onClick={() => onUpdateStatus(booking.id, "confirmed")}
              className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => onUpdateStatus(booking.id, "cancelled")}
              aria-label="Cancel booking"
              title="Cancel booking"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {isConfirmed && (
          <>
            <button
              type="button"
              onClick={() => onUpdateStatus(booking.id, "completed")}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
            >
              <Check className="h-3 w-3" />
              Mark Done
            </button>
            <button
              type="button"
              onClick={() => onUpdateStatus(booking.id, "cancelled")}
              aria-label="Cancel booking"
              title="Cancel booking"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {isCompleted && (
          <button
            type="button"
            onClick={() => onUpdateStatus(booking.id, "pending")}
            aria-label="Reopen booking"
            title="Reopen booking"
            className="inline-flex items-center gap-1 rounded-md p-1.5 text-emerald-600 hover:bg-secondary dark:text-emerald-400"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}

        {isCancelled && (
          <button
            type="button"
            onClick={() => onUpdateStatus(booking.id, "pending")}
            aria-label="Restore booking"
            title="Restore booking"
            className="inline-flex items-center gap-1 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => onDelete(booking.id)}
          aria-label="Delete booking"
          title="Delete booking"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
