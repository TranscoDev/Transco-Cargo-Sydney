import { CalendarClock, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Booking } from "@/lib/transco/types";

const DAY_ORDER = ["tuesday", "wednesday", "thursday", "friday"];

function dayLabel(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

function groupByDay(bookings: Booking[]): Map<string, Booking[]> {
  const groups = new Map<string, Booking[]>();
  for (const booking of bookings) {
    const key = booking.requestedDay.toLowerCase();
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
}: {
  bookings: Booking[];
  onDelete: (bookingId: string) => void;
}) {
  const grouped = groupByDay(bookings);
  const days = [...grouped.keys()].sort(
    (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b),
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-chat-canvas">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-5 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold text-foreground">Weekday Drop-off Bookings</h1>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {bookings.length} total
          </span>
        </div>

        {bookings.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
            No drop-off bookings yet. They'll show up here live as customers book through the
            chatbot.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {days.map((day) => (
              <div key={day}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {dayLabel(day)}
                </h2>
                <div className="flex flex-col gap-2">
                  {grouped.get(day)!.map((booking) => (
                    <div
                      key={booking.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {booking.customerName || booking.phoneNumber}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {booking.phoneNumber}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {booking.requestedTime}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                            booking.status === "confirmed"
                              ? "bg-primary text-primary-foreground"
                              : booking.status === "cancelled"
                                ? "bg-secondary text-muted-foreground line-through"
                                : "bg-human-soft text-human-foreground",
                          )}
                        >
                          {booking.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => onDelete(booking.id)}
                          aria-label="Delete booking"
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
