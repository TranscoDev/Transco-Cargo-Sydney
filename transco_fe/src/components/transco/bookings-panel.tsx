import { useMemo, useState } from "react";
import { CalendarClock, Check, Package, PenLine, RotateCcw, Search, ShipIcon, Trash2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { BookingCalendar } from "@/components/transco/booking-calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Booking, BookingStageStatus, BookingStatus, BookingUpdateInput } from "@/lib/transco/types";

const PAYMENT_STATUS_OPTIONS = [
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
];

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

type AssignBl = (bookingId: string, hblNumber: string, batchNumber?: number | null) => Promise<void>;

export function BookingsPanel({
  bookings,
  onDelete,
  onUpdateStatus,
  onUpdateBooking,
  onAssignBl,
}: {
  bookings: Booking[];
  onDelete: (bookingId: string) => void;
  onUpdateStatus: (bookingId: string, status: BookingStatus) => void;
  onUpdateBooking: (bookingId: string, updates: BookingUpdateInput) => void;
  onAssignBl: AssignBl;
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
        (b.bookingCode || "").toLowerCase().includes(q) ||
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
            placeholder="Search name, phone or BK number"
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
                        onUpdateBooking={onUpdateBooking}
                        onAssignBl={onAssignBl}
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
  onUpdateBooking,
  onAssignBl,
}: {
  booking: Booking;
  highlighted: boolean;
  onDelete: (bookingId: string) => void;
  onUpdateStatus: (bookingId: string, status: BookingStatus) => void;
  onUpdateBooking: (bookingId: string, updates: BookingUpdateInput) => void;
  onAssignBl: AssignBl;
}) {
  const [editOpen, setEditOpen] = useState(false);
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
          {booking.channel === "portal" && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              My Transco
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {booking.bookingCode && (
            <span className="font-medium tabular-nums text-foreground">{booking.bookingCode} · </span>
          )}
          {booking.phoneNumber}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
          <span>Declaration {booking.declarationStatus === "received" ? "✓" : "—"}</span>
          <span>Boxes {booking.warehouseStatus === "received" || booking.status === "completed" ? "✓" : "—"}</span>
          <span>BL {booking.shipmentId ? "✓" : "—"}</span>
        </p>
        {booking.boxSummary && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Package className="h-3 w-3 shrink-0" />
            {booking.boxSummary}
          </p>
        )}
        {(booking.origin || booking.destination || booking.price != null || booking.shipmentId) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {(booking.origin || booking.destination) && (
              <span>
                {booking.origin || "?"} → {booking.destination || "?"}
              </span>
            )}
            {booking.price != null && (
              <span>
                ${booking.price}
                {booking.paymentStatus ? ` · ${booking.paymentStatus}` : ""}
              </span>
            )}
            {booking.shipmentId && (
              <Link
                to="/console/shipments/$shipmentId"
                params={{ shipmentId: booking.shipmentId }}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <ShipIcon className="h-3 w-3" />
                View Shipment
              </Link>
            )}
          </div>
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
          onClick={() => setEditOpen(true)}
          aria-label="Edit booking details"
          title="Edit booking details"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <PenLine className="h-3.5 w-3.5" />
        </button>

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

      <BookingEditSheet
        booking={booking}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={onUpdateBooking}
        onAssignBl={onAssignBl}
      />
    </div>
  );
}

/** Editor for the optional Phase 2 fields (serviceType/origin/destination/
 * cargoType/boxCount/weight/cbm/price/paymentStatus/notes) — never touches
 * status, which is controlled by the buttons above and the existing
 * status-only PATCH. Local form state is re-seeded from the booking prop
 * each time the sheet opens. */
function BookingEditSheet({
  booking,
  open,
  onOpenChange,
  onSave,
  onAssignBl,
}: {
  booking: Booking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (bookingId: string, updates: BookingUpdateInput) => void;
  onAssignBl: AssignBl;
}) {
  const [form, setForm] = useState(() => bookingToFormState(booking));
  const [bl, setBl] = useState(EMPTY_BL_FORM);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setForm(bookingToFormState(booking));
      setBl(EMPTY_BL_FORM);
    }
    onOpenChange(next);
  };

  // Separate from "Save Details": assigning a BL creates/updates the
  // booking's shipment right away, and can fail (e.g. a BL that's
  // already taken) — so it's its own action with its own feedback.
  const handleAssignBl = async () => {
    const hblNumber = bl.hblNumber.trim();
    if (!/^[A-Za-z0-9-]{1,32}$/.test(hblNumber)) {
      setBl((s) => ({ ...s, error: "Enter the BL number (letters, numbers or hyphens)." }));
      return;
    }
    const batchNumber = bl.batchNumber.trim() === "" ? null : Number(bl.batchNumber);
    if (batchNumber !== null && (!Number.isInteger(batchNumber) || batchNumber < 1)) {
      setBl((s) => ({ ...s, error: "Batch number must be a whole number." }));
      return;
    }
    setBl((s) => ({ ...s, saving: true, error: "", done: "" }));
    try {
      await onAssignBl(booking.id, hblNumber, batchNumber);
      setBl({ ...EMPTY_BL_FORM, done: `BL ${hblNumber} saved — the customer can see it now.` });
      setForm((f) => ({ ...f, warehouseStatus: "received" }));
    } catch (err) {
      setBl((s) => ({ ...s, saving: false, error: err instanceof Error ? err.message : "Failed to assign BL" }));
    }
  };

  const handleSave = () => {
    // Only send a stage that actually changed, so opening and saving the
    // sheet never re-stamps a stage's "updated at" time.
    const stageUpdates: BookingUpdateInput = {};
    if (form.declarationStatus !== (booking.declarationStatus ?? "not_received")) {
      stageUpdates.declarationStatus = form.declarationStatus;
    }
    if (form.warehouseStatus !== (booking.warehouseStatus ?? "not_received")) {
      stageUpdates.warehouseStatus = form.warehouseStatus;
    }
    onSave(booking.id, {
      ...stageUpdates,
      serviceType: form.serviceType || null,
      origin: form.origin || null,
      destination: form.destination || null,
      cargoType: form.cargoType || null,
      boxCount: form.boxCount === "" ? null : Number(form.boxCount),
      weight: form.weight === "" ? null : Number(form.weight),
      cbm: form.cbm === "" ? null : Number(form.cbm),
      price: form.price === "" ? null : Number(form.price),
      paymentStatus: form.paymentStatus || null,
      notes: form.notes || null,
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Booking Details — {booking.customerName || booking.phoneNumber}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-4">
          {booking.customerNotes && (
            <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-foreground">
              <span className="font-medium">Customer note:</span> {booking.customerNotes}
            </p>
          )}

          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold text-foreground">Customer progress</p>
            <p className="mb-3 text-[11px] text-muted-foreground">
              Shown to the customer in My Transco — a stage only shows as done once it is recorded here.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="declarationStatus">Declaration</Label>
                <Select
                  value={form.declarationStatus}
                  onValueChange={(v) => setForm((f) => ({ ...f, declarationStatus: v as BookingStageStatus }))}
                >
                  <SelectTrigger id="declarationStatus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_received">Not received</SelectItem>
                    <SelectItem value="received">Received</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="warehouseStatus">Boxes at warehouse</Label>
                <Select
                  value={form.warehouseStatus}
                  onValueChange={(v) => setForm((f) => ({ ...f, warehouseStatus: v as BookingStageStatus }))}
                >
                  <SelectTrigger id="warehouseStatus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_received">Not received</SelectItem>
                    <SelectItem value="received">Received</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs font-semibold text-foreground">
                {booking.shipmentId ? "Change BL number" : "Assign BL number"}
              </p>
              <p className="mb-2 text-[11px] text-muted-foreground">
                After the boxes are received and checked. Creates this booking's shipment for the same
                customer — no need to re-enter their details.
              </p>
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="hblNumber">BL number</Label>
                  <Input
                    id="hblNumber"
                    value={bl.hblNumber}
                    onChange={(e) => setBl((s) => ({ ...s, hblNumber: e.target.value, error: "", done: "" }))}
                    placeholder="203115"
                    autoComplete="off"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="batchNumber">Batch (optional)</Label>
                  <Input
                    id="batchNumber"
                    type="number"
                    min="1"
                    value={bl.batchNumber}
                    onChange={(e) => setBl((s) => ({ ...s, batchNumber: e.target.value, error: "", done: "" }))}
                    placeholder="57"
                  />
                </div>
              </div>
              {bl.error && <p className="mt-2 text-[11px] font-medium text-destructive">{bl.error}</p>}
              {bl.done && (
                <p className="mt-2 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{bl.done}</p>
              )}
              <Button type="button" size="sm" className="mt-2" onClick={handleAssignBl} disabled={bl.saving}>
                {bl.saving ? "Saving…" : "Save BL"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="serviceType">Service Type</Label>
              <Input
                id="serviceType"
                value={form.serviceType}
                onChange={(e) => setForm((f) => ({ ...f, serviceType: e.target.value }))}
                placeholder="Sea Freight"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cargoType">Cargo Type</Label>
              <Input
                id="cargoType"
                value={form.cargoType}
                onChange={(e) => setForm((f) => ({ ...f, cargoType: e.target.value }))}
                placeholder="Personal effects"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="origin">Origin</Label>
              <Input
                id="origin"
                value={form.origin}
                onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value }))}
                placeholder="Sydney"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="destination">Destination</Label>
              <Input
                id="destination"
                value={form.destination}
                onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))}
                placeholder="Colombo"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="boxCount">Boxes</Label>
              <Input
                id="boxCount"
                type="number"
                min="0"
                value={form.boxCount}
                onChange={(e) => setForm((f) => ({ ...f, boxCount: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="weight">Weight (kg)</Label>
              <Input
                id="weight"
                type="number"
                min="0"
                value={form.weight}
                onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cbm">CBM</Label>
              <Input
                id="cbm"
                type="number"
                min="0"
                step="0.01"
                value={form.cbm}
                onChange={(e) => setForm((f) => ({ ...f, cbm: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="price">Price ($)</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paymentStatus">Payment Status</Label>
              <Select
                value={form.paymentStatus}
                onValueChange={(v) => setForm((f) => ({ ...f, paymentStatus: v }))}
              >
                <SelectTrigger id="paymentStatus">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Staff notes about this booking…"
              rows={3}
            />
          </div>

          {form.price !== "" && (
            <p className="text-[11px] text-muted-foreground">
              Price/payment status are staff-entered for now — Finance (Phase 5) will derive these
              from real invoices and payments instead.
            </p>
          )}
        </div>

        <SheetFooter className="mt-6">
          <SheetClose asChild>
            <Button variant="outline" type="button">
              Cancel
            </Button>
          </SheetClose>
          <Button type="button" onClick={handleSave}>
            Save Details
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function bookingToFormState(booking: Booking) {
  return {
    serviceType: booking.serviceType ?? "",
    origin: booking.origin ?? "",
    destination: booking.destination ?? "",
    cargoType: booking.cargoType ?? "",
    boxCount: booking.boxCount != null ? String(booking.boxCount) : "",
    weight: booking.weight != null ? String(booking.weight) : "",
    cbm: booking.cbm != null ? String(booking.cbm) : "",
    price: booking.price != null ? String(booking.price) : "",
    paymentStatus: booking.paymentStatus ?? "",
    notes: booking.notes ?? "",
    declarationStatus: (booking.declarationStatus ?? "not_received") as BookingStageStatus,
    warehouseStatus: (booking.warehouseStatus ?? "not_received") as BookingStageStatus,
  };
}

const EMPTY_BL_FORM = { hblNumber: "", batchNumber: "", saving: false, error: "", done: "" };
