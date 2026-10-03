import { HandoverTags } from "@/components/transco/handover-tags";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarClock, CalendarDays, Check, Eye, MoreHorizontal, PenLine, Printer, RotateCcw, Scale, Search, ShipIcon, Trash2, X } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";

import { BookingCalendar } from "@/components/transco/booking-calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { PrintPreviewDialog } from "@/components/transco/forms-print";
import { ShipmentPicker } from "@/components/transco/shipment-picker";
import { BookingDetailsEditor } from "@/components/transco/booking-details-editor";
import { EmptyState, StatusBadge } from "@/components/transco/page-kit";
import { bookingStatus } from "@/lib/transco/status";
import { friendlyError, notify } from "@/lib/transco/notify";
import { formatPhone, phoneMatches } from "@/lib/transco/phone";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PAYMENT_STATUS_OPTIONS = [
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
];


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

/** Kept for the route's ?show=… link from the dashboard. */
export type BookingFilter = "all" | "declarations" | "bls";

type View = "today" | "upcoming" | "attention" | "past";

function needsDeclarationCheck(b: Booking) {
  // A full declaration (filled when booking) is checked in the Confirm panel instead.
  return !!b.declarationSubmittedAt && b.declarationStatus !== "received" && b.status !== "cancelled" && b.channel !== "walk_in" && !b.declarationComplete;
}
/** Booked online with the full declaration — at drop-off staff only check, value and assign the BL. */
function needsDropOffConfirm(b: Booking) {
  return b.channel !== "walk_in" && !!b.declarationComplete && !b.staffConfirmed && b.status !== "cancelled";
}
/** A walk-in form the customer sent from their phone, not yet checked by staff. */
function needsFinalise(b: Booking) {
  return b.channel === "walk_in" && b.walkInStatus !== "finalised" && b.status !== "cancelled";
}
function needsBl(b: Booking) {
  return (b.warehouseStatus === "received" || b.status === "completed") && !b.shipmentId && b.status !== "cancelled";
}

export function BookingsPanel({
  bookings,
  onDelete,
  onUpdateStatus,
  onUpdateBooking,
  onAssignBl,
  initialFilter = "all",
}: {
  bookings: Booking[];
  onDelete: (bookingId: string) => void;
  onUpdateStatus: (bookingId: string, status: BookingStatus) => void;
  onUpdateBooking: (bookingId: string, updates: BookingUpdateInput) => void;
  onAssignBl: AssignBl;
  /** "declarations"/"bls" when arriving from the dashboard's work list. */
  initialFilter?: BookingFilter;
}) {
  const today = useMemo(() => todayKey(), []);
  const [view, setView] = useState<View>(initialFilter === "all" ? "today" : "attention");
  const [query, setQuery] = useState("");
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (initialFilter !== "all") setView("attention");
  }, [initialFilter]);

  const counts = useMemo(() => {
    let todayN = 0, upcoming = 0, declarations = 0, bls = 0, walkIns = 0;
    for (const b of bookings) {
      if (b.status !== "cancelled" && b.resolvedDate === today) todayN += 1;
      if (b.status !== "cancelled" && b.resolvedDate > today) upcoming += 1;
      if (needsDeclarationCheck(b)) declarations += 1;
      if (needsBl(b)) bls += 1;
      if (needsFinalise(b)) walkIns += 1;
    }
    return { today: todayN, upcoming, attention: walkIns + declarations + bls, declarations, bls, walkIns };
  }, [bookings, today]);

  const byTime = (a: Booking, b: Booking) => a.requestedTime.localeCompare(b.requestedTime);
  const q = query.trim().toLowerCase();
  const matches = (b: Booking) =>
    (b.customerName || "").toLowerCase().includes(q) ||
    (b.bookingCode || "").toLowerCase().includes(q) ||
    phoneMatches(b.phoneNumber, q) ||
    (b.receiver?.fullName || "").toLowerCase().includes(q);

  // What to show, as ordered groups of { heading, bookings }.
  let groups: { key: string; heading: string; badge?: string | undefined; items: Booking[] }[] = [];
  let emptyTitle = "";
  let emptyText = "";
  if (q) {
    const found = bookings.filter(matches);
    const g = groupByDate(found);
    groups = [...g.keys()].sort().reverse().map((d) => ({ key: d, heading: dayLabel(d), badge: d === today ? "Today" : undefined, items: g.get(d)!.sort(byTime) }));
    emptyTitle = "No bookings found";
    emptyText = "Try a name, phone number or BK number.";
  } else if (pickedDate) {
    groups = [{ key: pickedDate, heading: dayLabel(pickedDate), badge: pickedDate === today ? "Today" : undefined, items: bookings.filter((b) => b.resolvedDate === pickedDate).sort(byTime) }];
    emptyTitle = "No bookings on this day";
    emptyText = "Pick another day, or clear the date.";
  } else if (view === "today") {
    groups = [{ key: today, heading: dayLabel(today), items: bookings.filter((b) => b.resolvedDate === today).sort(byTime) }];
    emptyTitle = "No drop-offs today";
    emptyText = counts.upcoming ? `There ${counts.upcoming === 1 ? "is 1 booking" : `are ${counts.upcoming} bookings`} coming up — see Upcoming.` : "New bookings will appear here.";
  } else if (view === "upcoming") {
    const g = groupByDate(bookings.filter((b) => b.resolvedDate > today && b.status !== "cancelled"));
    groups = [...g.keys()].sort().map((d) => ({ key: d, heading: dayLabel(d), items: g.get(d)!.sort(byTime) }));
    emptyTitle = "Nothing coming up";
    emptyText = "Future bookings will appear here.";
  } else if (view === "attention") {
    groups = [
      { key: "walkins", heading: "Walk-ins to confirm", items: bookings.filter(needsFinalise).sort((a, b) => a.resolvedDate.localeCompare(b.resolvedDate) || byTime(a, b)) },
      { key: "decl", heading: "Declarations to check", items: bookings.filter(needsDeclarationCheck).sort((a, b) => a.resolvedDate.localeCompare(b.resolvedDate)) },
      { key: "bls", heading: "BLs to assign", items: bookings.filter(needsBl).sort((a, b) => a.resolvedDate.localeCompare(b.resolvedDate)) },
    ].filter((g) => g.items.length);
    emptyTitle = "All clear";
    emptyText = "No walk-ins to confirm, no declarations to check and no BLs to assign.";
  } else {
    const g = groupByDate(bookings.filter((b) => b.resolvedDate < today || b.status === "cancelled"));
    groups = [...g.keys()].sort().reverse().map((d) => ({ key: d, heading: dayLabel(d), items: g.get(d)!.sort(byTime) }));
    emptyTitle = "No past bookings";
    emptyText = "";
  }
  groups = groups.filter((g) => g.items.length);

  const tabs: { key: View; label: string; count?: number; attention?: boolean }[] = [
    { key: "today", label: "Today", count: counts.today },
    { key: "upcoming", label: "Upcoming", count: counts.upcoming },
    { key: "attention", label: "Needs attention", count: counts.attention, attention: counts.attention > 0 },
    { key: "past", label: "Past" },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-4xl px-4 py-5 md:px-8 md:py-7">
        <header className="mb-5">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <CalendarClock className="h-5 w-5 text-muted-foreground" aria-hidden />
            Bookings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Drop-off appointments at our Seven Hills warehouse.</p>
        </header>

        {/* One control row: views on the left, search + date on the right. */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-secondary p-1" role="tablist" aria-label="Which bookings">
            {tabs.map((t) => {
              const active = !q && !pickedDate && view === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setView(t.key);
                    setPickedDate(null);
                    setQuery("");
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  {t.count !== undefined && t.count > 0 && (
                    <span
                      className={cn(
                        "min-w-5 rounded-full px-1.5 text-xs font-semibold leading-5 tabular-nums",
                        t.attention ? "bg-warning-soft text-warning-foreground" : "bg-background text-muted-foreground",
                      )}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="relative flex-1 sm:w-64 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, phone or BK"
                aria-label="Search bookings"
                className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
              />
            </div>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-9 shrink-0">
                  <CalendarDays className="mr-1.5 h-4 w-4" aria-hidden />
                  {pickedDate ? shortDay(pickedDate) : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <BookingCalendar
                  bookings={bookings}
                  selectedDate={pickedDate}
                  onSelectDate={(d) => {
                    setPickedDate(d);
                    setQuery("");
                    setCalendarOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {(pickedDate || q) && (
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            {q ? <>Search results for “{query.trim()}”</> : <>Showing {dayLabel(pickedDate!)}</>}
            <button
              type="button"
              onClick={() => {
                setPickedDate(null);
                setQuery("");
              }}
              className="font-medium text-primary hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        {groups.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <EmptyState
              icon={view === "attention" && !q && !pickedDate ? Check : CalendarClock}
              title={bookings.length === 0 ? "No bookings yet" : emptyTitle}
              description={bookings.length === 0 ? "Bookings appear here as customers book online or through the chat." : emptyText}
              action={
                view === "today" && !q && !pickedDate && counts.upcoming > 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setView("upcoming")}>
                    See upcoming bookings
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {groups.map((g) => (
              <section key={g.key}>
                {/* The Today tab needs no day heading — the tab already says it. */}
                {!(view === "today" && !q && !pickedDate) && (
                  <div className="mb-2.5 flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">{g.heading}</h2>
                    {g.badge && <StatusBadge tone="info">{g.badge}</StatusBadge>}
                    <span className="text-sm text-muted-foreground">· {g.items.length}</span>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {g.items.map((booking) => (
                    <BookingCard
                      key={booking.id}
                      booking={booking}
                      showDate={view === "attention" && !q && !pickedDate}
                      onDelete={onDelete}
                      onUpdateStatus={onUpdateStatus}
                      onUpdateBooking={onUpdateBooking}
                      onAssignBl={onAssignBl}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function shortDay(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

/** The one next thing to do for this booking (null = nothing left). */
function nextAction(b: Booking): { label: string; kind: "confirm" | "done" | "bl" | "restore" | "finalise" } | null {
  if (b.status === "cancelled") return { label: "Restore", kind: "restore" };
  if (needsFinalise(b)) return { label: "Confirm", kind: "finalise" };
  if (b.status === "pending") return { label: "Confirm", kind: "confirm" };
  if (b.status === "confirmed" && needsDropOffConfirm(b)) return { label: "Check boxes & BL", kind: "finalise" };
  if (b.status === "confirmed") return { label: "Mark done", kind: "done" };
  if (!b.shipmentId) return { label: "Assign BL", kind: "bl" };
  return null;
}

function BookingCard({
  booking,
  showDate,
  onDelete,
  onUpdateStatus,
  onUpdateBooking,
  onAssignBl,
}: {
  booking: Booking;
  showDate: boolean;
  onDelete: (bookingId: string) => void;
  onUpdateStatus: (bookingId: string, status: BookingStatus) => void;
  onUpdateBooking: (bookingId: string, updates: BookingUpdateInput) => void;
  onAssignBl: AssignBl;
}) {
  const [editOpen, setEditOpen] = useState(false);
  // The booking opens as a full page (lots of drop-off work happens there).
  const navigate = useNavigate();
  const openBooking = () => void navigate({ to: "/console/bookings/$bookingId", params: { bookingId: booking.id } });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [changeDetailsOpen, setChangeDetailsOpen] = useState(false);
  const isCancelled = booking.status === "cancelled";
  const finished = booking.status === "completed" && !!booking.shipmentId;
  const st = bookingStatus(booking.status);
  const next = nextAction(booking);
  const declarationToCheck = needsDeclarationCheck(booking);

  // Clicking the card opens the details — except its own buttons/menus, and
  // clicks from the sheets/dialogs (React bubbles portal events up to here).
  const openDetailsFromCard = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target) || target.closest("button, a, input, [role='dialog'], [role='alertdialog'], [role='menu']")) return;
    openBooking();
  };

  const runNext = () => {
    if (!next) return;
    if (next.kind === "confirm") onUpdateStatus(booking.id, "confirmed");
    else if (next.kind === "done") onUpdateStatus(booking.id, "completed");
    else if (next.kind === "restore") onUpdateStatus(booking.id, "pending");
    else if (next.kind === "finalise") openBooking();
    else setEditOpen(true);
  };
  const walkInToFinalise = needsFinalise(booking);

  // Every print goes through a preview first.
  const [previewAll, setPreviewAll] = useState(false);
  const printIt = () => setPreviewAll(true);

  const details = [
    booking.boxSummary,
    booking.receiver ? `To ${booking.receiver.fullName}${booking.receiver.town ? `, ${booking.receiver.town}` : ""}` : null,
    formatPhone(booking.phoneNumber),
  ].filter(Boolean).join(" · ");

  return (
    <div
      onClick={openDetailsFromCard}
      className={cn(
        "cursor-pointer rounded-xl border bg-card shadow-xs transition-colors hover:border-primary/40",
        (isCancelled || finished) && "opacity-65",
      )}
    >
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="w-14 shrink-0 text-center">
          <p className="text-base font-semibold tabular-nums text-foreground">{booking.requestedTime || "—"}</p>
          {showDate && <p className="text-xs text-muted-foreground">{shortDay(booking.resolvedDate)}</p>}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => openBooking()}
              className="truncate text-left text-base font-semibold text-foreground hover:underline"
            >
              {booking.customerName || formatPhone(booking.phoneNumber)}
            </button>
            {booking.bookingCode && <span className="text-sm tabular-nums text-muted-foreground">{booking.bookingCode}</span>}
            {walkInToFinalise ? (
              <StatusBadge tone="attention">Walk-in · to confirm</StatusBadge>
            ) : (
              <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
            )}
            {booking.channel === "portal" && <span className="text-xs text-muted-foreground">· booked online</span>}
            <span className="text-sm text-foreground"><HandoverTags booking={booking} /></span>
            {booking.channel !== "walk_in" && booking.declarationComplete && (
              <span className="text-xs font-medium text-success-foreground">· Declaration ✓</span>
            )}
            {booking.channel === "walk_in" && !walkInToFinalise && <span className="text-xs text-muted-foreground">· walk-in</span>}
          </div>
          {details && <p className="mt-0.5 truncate text-sm text-muted-foreground">{details}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {next && (
            <Button type="button" size="sm" variant={next.kind === "restore" ? "outline" : "default"} onClick={runNext}>
              {next.label}
            </Button>
          )}
          {finished && booking.shipmentId && (
            <Button asChild type="button" size="sm" variant="ghost">
              <Link to="/console/shipments/$shipmentId" params={{ shipmentId: booking.shipmentId }}>
                <ShipIcon className="mr-1.5 h-4 w-4" aria-hidden />
                Shipment
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => openBooking()}>
                <Eye className="mr-2 h-4 w-4" /> View details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={printIt}>
                <Printer className="mr-2 h-4 w-4" /> Print forms
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setChangeDetailsOpen(true)}>
                <PenLine className="mr-2 h-4 w-4" /> Change boxes or details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Scale className="mr-2 h-4 w-4" /> Weights, price & BL
              </DropdownMenuItem>
              {booking.declarationStatus === "received" && (
                <DropdownMenuItem onClick={() => onUpdateBooking(booking.id, { declarationStatus: "not_received" })}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Mark declaration not checked
                </DropdownMenuItem>
              )}
              {booking.status === "completed" && (
                <DropdownMenuItem onClick={() => onUpdateStatus(booking.id, "confirmed")}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Undo mark done
                </DropdownMenuItem>
              )}
              {(booking.status === "pending" || booking.status === "confirmed") && (
                <DropdownMenuItem onClick={() => onUpdateStatus(booking.id, "cancelled")}>
                  <X className="mr-2 h-4 w-4" /> Cancel booking
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setConfirmDelete(true)} className="text-attention-foreground focus:text-attention-foreground">
                <Trash2 className="mr-2 h-4 w-4" /> Delete booking…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {walkInToFinalise && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-attention/25 bg-attention-soft/60 px-4 py-2">
          <p className="text-sm text-attention-foreground">Walk-in form sent from the customer's phone — check the boxes with them, then assign the BL to confirm it.</p>
        </div>
      )}

      {/* Only when there's something to do about the declaration. */}
      {declarationToCheck && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-warning/25 bg-warning-soft/60 px-4 py-2">
          <p className="text-sm text-warning-foreground">Declaration filled online — check it with the customer at drop-off.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-warning/50 bg-card"
            onClick={() => onUpdateBooking(booking.id, { declarationStatus: "received" })}
          >
            <Check className="mr-1.5 h-4 w-4" /> Mark checked
          </Button>
        </div>
      )}

      {previewAll && <PrintPreviewDialog bookingId={booking.id} form={{ key: "all", title: "All forms" }} onClose={() => setPreviewAll(false)} />}


      <BookingDetailsEditor bookingId={booking.id} open={changeDetailsOpen} onOpenChange={setChangeDetailsOpen} />

      <BookingEditSheet
        booking={booking}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={onUpdateBooking}
        onAssignBl={onAssignBl}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {booking.bookingCode ?? "This booking"} for {booking.customerName || booking.phoneNumber} will be removed permanently. If the customer
              just isn't coming, use Cancel booking instead — that keeps the record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep booking</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => onDelete(booking.id)}>
              Delete booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      setBl((s) => ({ ...s, error: "The shipment number must be a whole number, e.g. 57." }));
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
            <p className="mb-3 text-xs text-muted-foreground">
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
                    <SelectItem value="not_received">Not checked yet</SelectItem>
                    <SelectItem value="received">Checked</SelectItem>
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
              <p className="mb-2 text-xs text-muted-foreground">
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
                  <Label htmlFor="batchNumber">Shipment no. (optional)</Label>
                  <ShipmentPicker
                    id="batchNumber"
                    value={bl.batchNumber}
                    onChange={(v) => setBl((s) => ({ ...s, batchNumber: v, error: "", done: "" }))}
                  />
                </div>
              </div>
              {bl.error && <p className="mt-2 text-xs font-medium text-destructive">{bl.error}</p>}
              {bl.done && (
                <p className="mt-2 text-xs font-medium text-success-foreground">{bl.done}</p>
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
            <p className="text-xs text-muted-foreground">
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
