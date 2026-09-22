import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Booking } from "@/lib/transco/types";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toDateKey(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function todayKey(): string {
  const now = new Date();
  return toDateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * A month-grid summary of bookings, meant to sit beside the full list —
 * gives staff an at-a-glance view of which days are busy without reading
 * every card. Clicking a day filters the list next to it (bidirectional
 * with `selectedDate`/`onSelectDate`, owned by the parent).
 */
export function BookingCalendar({
  bookings,
  selectedDate,
  onSelectDate,
}: {
  bookings: Booking[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const countsByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      map.set(b.resolvedDate, (map.get(b.resolvedDate) ?? 0) + 1);
    }
    return map;
  }, [bookings]);

  const today = useMemo(() => todayKey(), []);

  const cells = useMemo(() => {
    const { year, month } = cursor;
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const list: { key: string | null; day: number | null }[] = [];
    for (let i = 0; i < firstDow; i++) list.push({ key: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) list.push({ key: toDateKey(year, month, d), day: d });
    return list;
  }, [cursor]);

  const selectedDayBookings = useMemo(
    () => (selectedDate ? bookings.filter((b) => b.resolvedDate === selectedDate) : []),
    [bookings, selectedDate],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))}
          aria-label="Previous month"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <p className="text-xs font-semibold text-foreground">
          {MONTH_LABELS[cursor.month]} {cursor.year}
        </p>
        <button
          type="button"
          onClick={() => setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))}
          aria-label="Next month"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i} className="text-[10px] font-medium text-muted-foreground">
            {w}
          </span>
        ))}
        {cells.map((cell, i) => {
          if (cell.day === null) return <span key={i} />;
          const count = countsByDate.get(cell.key!) ?? 0;
          const isToday = cell.key === today;
          const isSelected = cell.key === selectedDate;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelectDate(isSelected ? null : cell.key)}
              className={cn(
                "relative flex h-8 flex-col items-center justify-center rounded-md text-[11px] transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : isToday
                    ? "bg-primary/15 text-primary font-semibold"
                    : count > 0
                      ? "text-foreground hover:bg-secondary"
                      : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              {cell.day}
              {count > 0 && (
                <span
                  className={cn(
                    "absolute bottom-0.5 h-1 w-1 rounded-full",
                    isSelected ? "bg-primary-foreground" : "bg-primary",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="rounded-md border border-border/60 bg-secondary/20 px-2.5 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-medium text-foreground">
              {selectedDayBookings.length} booking{selectedDayBookings.length === 1 ? "" : "s"}
            </p>
            <button
              type="button"
              onClick={() => onSelectDate(null)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </div>
          {selectedDayBookings.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Nothing booked this day.</p>
          ) : (
            <ul className="space-y-1">
              {selectedDayBookings.map((b) => (
                <li key={b.id} className="flex items-center justify-between text-[11px]">
                  <span className="truncate text-foreground">{b.customerName || b.phoneNumber}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{b.requestedTime}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
