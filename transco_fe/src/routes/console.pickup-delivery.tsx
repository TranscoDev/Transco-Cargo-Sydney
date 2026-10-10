import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ExternalLink, MapPin, Phone, Truck } from "lucide-react";

import {
  EmptyState,
  PageHeader,
  PageShell,
  StatusBadge,
  type StatusTone,
} from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { friendlyError, notify } from "@/lib/transco/notify";
import { formatPhone } from "@/lib/transco/phone";
import { useConversations } from "@/lib/transco/store";
import type {
  Booking,
  PickupDeliveryKind,
  PickupDeliveryStatus,
  PickupDeliveryUpdate,
} from "@/lib/transco/types";

export const Route = createFileRoute("/console/pickup-delivery")({
  component: PickupDeliveryPage,
});

/**
 * Home pickups (handover "pickup") and door deliveries (deliveryType
 * "door"), straight from the bookings — no separate records. A booking
 * can be both, and then shows once as each. The day and status staff
 * arrange live on the booking itself (pickupJob / deliveryJob).
 */

// ---------------------------------------------------------------
// Dates (local YYYY-MM-DD keys, weeks run Monday–Sunday)
// ---------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (key: string) => new Date(`${key}T00:00:00`);
function addDays(key: string, n: number) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}
function mondayOf(key: string) {
  const day = fromKey(key).getDay(); // 0 = Sunday
  return addDays(key, day === 0 ? -6 : 1 - day);
}
function dayLabel(key: string) {
  return fromKey(key).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
function shortDay(key: string) {
  return fromKey(key).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ---------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------

interface Job {
  key: string;
  kind: PickupDeliveryKind;
  booking: Booking;
  /** The arranged day, or the booking's own day until staff set one. */
  date: string;
  dateSet: boolean;
  time: string | null;
  status: PickupDeliveryStatus;
}

const KIND_LABEL: Record<PickupDeliveryKind, string> = {
  pickup: "Pickup",
  delivery: "Door delivery",
};

function statusLabel(kind: PickupDeliveryKind, status: PickupDeliveryStatus) {
  if (status === "completed") return kind === "pickup" ? "Picked up" : "Delivered";
  return status === "cancelled" ? "Cancelled" : "Pending";
}
const STATUS_TONE: Record<PickupDeliveryStatus, StatusTone> = {
  pending: "pending",
  completed: "success",
  cancelled: "neutral",
};

function toJobs(bookings: Booking[], deliveredShipments: Set<string>): Job[] {
  const jobs: Job[] = [];
  for (const b of bookings) {
    const kinds: PickupDeliveryKind[] = [];
    if (b.handover === "pickup") kinds.push("pickup");
    if (b.deliveryType === "door") kinds.push("delivery");
    for (const kind of kinds) {
      const job = kind === "pickup" ? b.pickupJob : b.deliveryJob;
      // A cancelled booking cancels its pickup/delivery too. Otherwise
      // staff's own status wins; before they set one, boxes already at
      // the warehouse mean the pickup happened, and a delivered shipment
      // means the door delivery did.
      let status: PickupDeliveryStatus = "pending";
      if (b.status === "cancelled") status = "cancelled";
      else if (job?.status) status = job.status;
      else if (
        kind === "pickup" &&
        (b.warehouseStatus === "received" || b.status === "completed" || b.shipmentId)
      )
        status = "completed";
      else if (kind === "delivery" && b.shipmentId && deliveredShipments.has(b.shipmentId))
        status = "completed";
      jobs.push({
        key: `${b.id}:${kind}`,
        kind,
        booking: b,
        date: job?.date || b.resolvedDate,
        dateSet: !!job?.date,
        time: job?.time || null,
        status,
      });
    }
  }
  return jobs;
}

const byDateTime = (a: Job, b: Job) =>
  a.date.localeCompare(b.date) ||
  (a.time ?? "99:99").localeCompare(b.time ?? "99:99") ||
  a.kind.localeCompare(b.kind);

type Period = "this" | "next" | "custom" | "all";
type TypeFilter = "all" | PickupDeliveryKind;
type StatusFilter = "all" | PickupDeliveryStatus;

// ---------------------------------------------------------------
// Page
// ---------------------------------------------------------------

function PickupDeliveryPage() {
  const { bookings, shipments } = useConversations();
  const today = toKey(new Date());
  const thisWeek = { from: mondayOf(today), to: addDays(mondayOf(today), 6) };
  const nextWeek = { from: addDays(thisWeek.from, 7), to: addDays(thisWeek.to, 7) };

  const [period, setPeriod] = useState<Period>("this");
  const [custom, setCustom] = useState({ from: thisWeek.from, to: addDays(thisWeek.to, 7) });
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const deliveredShipments = useMemo(
    () => new Set(shipments.filter((s) => s.status === "delivered").map((s) => s.id)),
    [shipments],
  );
  const jobs = useMemo(() => toJobs(bookings, deliveredShipments), [bookings, deliveredShipments]);
  const openJob = openKey ? (jobs.find((j) => j.key === openKey) ?? null) : null;

  // Overall totals — a rough idea of the whole workload, whatever dates
  // are picked below (cancelled ones left out).
  const count = (kind: PickupDeliveryKind, s?: PickupDeliveryStatus) =>
    jobs.filter((j) => j.kind === kind && (s ? j.status === s : j.status !== "cancelled")).length;
  const totals = {
    pickups: count("pickup"),
    deliveries: count("delivery"),
    pendingPickups: count("pickup", "pending"),
    pendingDeliveries: count("delivery", "pending"),
    donePickups: count("pickup", "completed"),
    doneDeliveries: count("delivery", "completed"),
  };
  const showAll = (t: TypeFilter, s: StatusFilter) => {
    setPeriod("all");
    setType(t);
    setStatus(s);
  };

  const range =
    period === "this"
      ? thisWeek
      : period === "next"
        ? nextWeek
        : period === "all"
          ? { from: "0000-01-01", to: "9999-12-31" }
          : custom;
  const matches = (j: Job) =>
    (type === "all" || j.kind === type) && (status === "all" || j.status === status);
  const showPending = status === "all" || status === "pending";
  // Pending with no day set yet: always shown, whatever dates are picked —
  // a door delivery happens weeks after the drop-off day, so it would
  // otherwise fall out of every week view until someone sets its day.
  const notSet = showPending
    ? jobs.filter((j) => matches(j) && j.status === "pending" && !j.dateSet).sort(byDateTime)
    : [];
  const unscheduled = (j: Job) => j.status === "pending" && !j.dateSet;
  const inRange = jobs
    .filter((j) => matches(j) && !unscheduled(j) && j.date >= range.from && j.date <= range.to)
    .sort(byDateTime);
  // A set day that passed without the job being done still needs doing —
  // kept in view instead of dropping off the list.
  const earlier =
    range.from <= today && showPending
      ? jobs
          .filter((j) => matches(j) && j.status === "pending" && j.dateSet && j.date < range.from)
          .sort(byDateTime)
      : [];

  const groups = new Map<string, Job[]>();
  for (const j of inRange) {
    const bucket = groups.get(j.date);
    if (bucket) bucket.push(j);
    else groups.set(j.date, [j]);
  }

  return (
    <PageShell width="narrow">
      <PageHeader
        icon={Truck}
        title="Pickup & Delivery"
        description="Home pickups in Sydney and door deliveries to the receiver — taken straight from the bookings."
      />

      {/* Overall totals — each tile shows its bookings below (all dates). */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label="Pickups"
          value={totals.pickups}
          hint={`${totals.pendingPickups} pending · ${totals.donePickups} done`}
          onClick={() => showAll("pickup", "all")}
        />
        <Tile
          label="Door deliveries"
          value={totals.deliveries}
          hint={`${totals.pendingDeliveries} pending · ${totals.doneDeliveries} delivered`}
          onClick={() => showAll("delivery", "all")}
        />
        <Tile
          label="Pending"
          value={totals.pendingPickups + totals.pendingDeliveries}
          attention={totals.pendingPickups + totals.pendingDeliveries > 0}
          hint={`${totals.pendingPickups} pickups · ${totals.pendingDeliveries} deliveries`}
          onClick={() => showAll("all", "pending")}
        />
        <Tile
          label="Completed"
          value={totals.donePickups + totals.doneDeliveries}
          hint={`${totals.donePickups} picked up · ${totals.doneDeliveries} delivered`}
          onClick={() => showAll("all", "completed")}
        />
      </div>

      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="When"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "this", label: "This week" },
              { value: "next", label: "Next week" },
              { value: "custom", label: "Dates…" },
              { value: "all", label: "All dates" },
            ]}
          />
          {period === "custom" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Input
                type="date"
                aria-label="From"
                value={custom.from}
                onChange={(e) =>
                  e.target.value &&
                  setCustom((c) => ({
                    from: e.target.value,
                    to: c.to < e.target.value ? e.target.value : c.to,
                  }))
                }
                className="h-9 w-40"
              />
              to
              <Input
                type="date"
                aria-label="To"
                value={custom.to}
                min={custom.from}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
                className="h-9 w-40"
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Type"
            value={type}
            onChange={setType}
            options={[
              { value: "all", label: "All" },
              { value: "pickup", label: "Pickup" },
              { value: "delivery", label: "Door delivery" },
            ]}
          />
          <Segmented
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Any status" },
              { value: "pending", label: "Pending" },
              { value: "completed", label: "Completed" },
              { value: "cancelled", label: "Cancelled" },
            ]}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {period === "all" ? "All dates" : `${shortDay(range.from)} – ${shortDay(range.to)}`}
        </p>
      </div>

      {inRange.length === 0 && earlier.length === 0 && notSet.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={status === "pending" ? Check : Truck}
            title={status === "pending" ? "Nothing pending" : "Nothing in these dates"}
            description="Bookings with a home pickup or door delivery show up here. Try another week or filter."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {notSet.length > 0 && (
            <JobGroup
              heading="Day not set yet"
              tone="attention"
              jobs={notSet}
              showDate
              dateCaption="booked"
              onOpen={setOpenKey}
            />
          )}
          {earlier.length > 0 && (
            <JobGroup
              heading="Still pending from earlier"
              tone="attention"
              jobs={earlier}
              showDate
              onOpen={setOpenKey}
            />
          )}
          {[...groups.entries()].map(([day, items]) => (
            <JobGroup
              key={day}
              heading={dayLabel(day)}
              badge={day === today ? "Today" : undefined}
              jobs={items}
              onOpen={setOpenKey}
            />
          ))}
        </div>
      )}

      <JobSheet job={openJob} onClose={() => setOpenKey(null)} />
    </PageShell>
  );
}

function Tile({
  label,
  value,
  attention,
  hint,
  onClick,
}: {
  label: string;
  value: number;
  attention?: boolean;
  hint?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border bg-card px-4 py-3 text-left shadow-xs transition-colors hover:border-primary/40"
    >
      <span
        className={cn(
          "block text-2xl font-semibold tabular-nums",
          attention ? "text-warning-foreground" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="block text-xs text-muted-foreground">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted-foreground/80">{hint}</span>}
    </button>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-secondary p-1"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function JobGroup({
  heading,
  badge,
  tone,
  jobs,
  showDate,
  dateCaption,
  onOpen,
}: {
  heading: string;
  badge?: string | undefined;
  tone?: "attention";
  jobs: Job[];
  showDate?: boolean;
  /** Small word before the date, e.g. "booked" when it isn't the job's own day. */
  dateCaption?: string;
  onOpen: (key: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2
          className={cn(
            "text-sm font-semibold",
            tone === "attention" ? "text-warning-foreground" : "text-foreground",
          )}
        >
          {heading}
        </h2>
        {badge && <StatusBadge tone="info">{badge}</StatusBadge>}
        <span className="text-sm text-muted-foreground">· {jobs.length}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {jobs.map((j) => (
          <JobRow
            key={j.key}
            job={j}
            showDate={!!showDate}
            dateCaption={dateCaption}
            onOpen={() => onOpen(j.key)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Where the job happens and who to call there. */
function jobPlace(job: Job) {
  const b = job.booking;
  if (job.kind === "pickup") return { address: b.senderAddress ?? null, phone: b.phoneNumber };
  const town = b.receiver?.town;
  return {
    address: b.receiverAddress ?? (town ? town : null),
    phone: b.receiverPhone ?? null,
  };
}

function JobRow({
  job,
  showDate,
  dateCaption,
  onOpen,
}: {
  job: Job;
  showDate: boolean;
  dateCaption?: string | undefined;
  onOpen: () => void;
}) {
  const { updatePickupDelivery } = useConversations();
  const b = job.booking;
  const place = jobPlace(job);
  const done = job.status !== "pending";

  const markDone = async () => {
    try {
      await updatePickupDelivery(b.id, job.kind, { status: "completed" });
      notify.success(job.kind === "pickup" ? "Marked as picked up" : "Marked as delivered");
    } catch (err) {
      notify.error(
        "Couldn't update this",
        friendlyError(err, "Nothing was changed. Please try again."),
      );
    }
  };

  return (
    <li
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, a")) onOpen();
      }}
      className={cn(
        "flex cursor-pointer items-center gap-4 rounded-xl border bg-card px-4 py-3 shadow-xs transition-colors hover:border-primary/40",
        done && "opacity-70",
      )}
    >
      <div className="w-14 shrink-0 text-center">
        <p className="text-base font-semibold tabular-nums text-foreground">{job.time ?? "—"}</p>
        {showDate && (
          <p className="text-xs text-muted-foreground">
            {dateCaption && <span className="block">{dateCaption}</span>}
            {shortDay(job.date)}
          </p>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={onOpen}
            className="truncate text-left text-base font-semibold text-foreground hover:underline"
          >
            {b.customerName || formatPhone(b.phoneNumber)}
          </button>
          {b.bookingCode && (
            <span className="text-sm tabular-nums text-muted-foreground">{b.bookingCode}</span>
          )}
          <StatusBadge tone={job.kind === "pickup" ? "info" : "neutral"}>
            {KIND_LABEL[job.kind]}
          </StatusBadge>
          <StatusBadge tone={STATUS_TONE[job.status]}>
            {statusLabel(job.kind, job.status)}
          </StatusBadge>
          {!job.dateSet && job.status === "pending" && (
            <span className="text-xs text-warning-foreground">· day not set</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {[
            job.kind === "delivery" && b.receiver ? `To ${b.receiver.fullName}` : null,
            place.address,
            formatPhone(place.phone),
          ]
            .filter(Boolean)
            .join(" · ") || "No address yet"}
        </p>
        {job.kind === "pickup" && b.pickupNote && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Customer prefers: {b.pickupNote}
          </p>
        )}
      </div>

      {job.status === "pending" && (
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={markDone}>
          <Check className="mr-1.5 h-4 w-4" aria-hidden />
          {job.kind === "pickup" ? "Picked up" : "Delivered"}
        </Button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------
// Details + update
// ---------------------------------------------------------------

function JobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const { updatePickupDelivery } = useConversations();
  const [form, setForm] = useState({
    date: "",
    time: "",
    note: "",
    status: "pending" as PickupDeliveryStatus,
  });
  const [saving, setSaving] = useState(false);

  const saved = job
    ? job.kind === "pickup"
      ? job.booking.pickupJob
      : job.booking.deliveryJob
    : null;
  // Re-seed whenever a different job is opened.
  useEffect(() => {
    if (!job) return;
    setForm({
      date: saved?.date ?? "",
      time: saved?.time ?? "",
      note: saved?.note ?? "",
      status: job.status,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.key]);

  if (!job) return <Sheet open={false} />;

  const b = job.booking;
  const place = jobPlace(job);
  const bookingCancelled = b.status === "cancelled";

  const save = async () => {
    const updates: PickupDeliveryUpdate = {};
    if (form.date !== (saved?.date ?? "")) updates.date = form.date || null;
    if (form.time !== (saved?.time ?? "")) updates.time = form.time || null;
    if (form.note.trim() !== (saved?.note ?? "")) updates.note = form.note.trim() || null;
    if (form.status !== job.status || (!saved?.status && form.status !== "pending"))
      updates.status = form.status;
    if (!Object.keys(updates).length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await updatePickupDelivery(b.id, job.kind, updates);
      notify.success(job.kind === "pickup" ? "Pickup updated" : "Door delivery updated");
      onClose();
    } catch (err) {
      notify.error(
        "Couldn't save this",
        friendlyError(err, "Nothing was changed. Please try again."),
      );
    } finally {
      setSaving(false);
    }
  };

  const statuses: PickupDeliveryStatus[] = ["pending", "completed", "cancelled"];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {KIND_LABEL[job.kind]} — {b.customerName || formatPhone(b.phoneNumber)}
          </SheetTitle>
        </SheetHeader>

        <dl className="mt-4 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">Booking</dt>
          <dd>
            <Link
              to="/console/bookings/$bookingId"
              params={{ bookingId: b.id }}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              {b.bookingCode ?? "Open booking"} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </dd>

          {job.kind === "delivery" && (
            <>
              <dt className="text-muted-foreground">Receiver</dt>
              <dd className="text-foreground">{b.receiver?.fullName ?? "—"}</dd>
            </>
          )}

          <dt className="text-muted-foreground">
            {job.kind === "pickup" ? "Pickup address" : "Deliver to"}
          </dt>
          <dd className="flex items-start gap-1.5 text-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {place.address ?? "Not given — ask the customer"}
          </dd>

          <dt className="text-muted-foreground">
            {job.kind === "pickup" ? "Phone" : "Receiver phone"}
          </dt>
          <dd>
            {place.phone ? (
              <a
                href={`tel:${place.phone}`}
                className="inline-flex items-center gap-1.5 text-foreground hover:underline"
              >
                <Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {formatPhone(place.phone)}
              </a>
            ) : (
              "—"
            )}
          </dd>

          {job.kind === "delivery" && (
            <>
              <dt className="text-muted-foreground">Sender phone</dt>
              <dd>
                <a href={`tel:${b.phoneNumber}`} className="text-foreground hover:underline">
                  {formatPhone(b.phoneNumber)}
                </a>
              </dd>
            </>
          )}

          {job.kind === "pickup" && (
            <>
              <dt className="text-muted-foreground">Customer prefers</dt>
              <dd className="text-foreground">{b.pickupNote || "No preference given"}</dd>
            </>
          )}

          {b.boxSummary && (
            <>
              <dt className="text-muted-foreground">Boxes</dt>
              <dd className="text-foreground">{b.boxSummary}</dd>
            </>
          )}
        </dl>

        {bookingCancelled ? (
          <p className="mt-6 rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">
            This booking was cancelled, so there is nothing to arrange. Restore the booking from
            Bookings if that was a mistake.
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-4 rounded-lg border p-3">
            <div>
              <p className="text-xs font-semibold text-foreground">
                {job.kind === "pickup" ? "Arranged pickup" : "Arranged delivery"}
              </p>
              <p className="text-xs text-muted-foreground">
                {job.dateSet
                  ? "The day agreed with the customer."
                  : `No day set yet — listed on the booking day (${shortDay(b.resolvedDate)}) until you set one.`}
              </p>
            </div>
            <div className="grid grid-cols-[1fr_8rem] gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pd-date">Date</Label>
                <Input
                  id="pd-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pd-time">Time</Label>
                <Input
                  id="pd-time"
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Segmented
                label="Status"
                value={form.status}
                onChange={(s) => setForm((f) => ({ ...f, status: s }))}
                options={statuses.map((s) => ({ value: s, label: statusLabel(job.kind, s) }))}
              />
              {form.status === "cancelled" && (
                <p className="text-xs text-muted-foreground">
                  Only the {job.kind === "pickup" ? "pickup" : "door delivery"} is cancelled — the
                  booking itself stays as it is.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pd-note">Staff note</Label>
              <Textarea
                id="pd-note"
                rows={2}
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder={
                  job.kind === "pickup"
                    ? "e.g. Driver to call 30 min before"
                    : "e.g. Agent confirmed delivery for Saturday"
                }
              />
            </div>
          </div>
        )}

        <SheetFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onClose}>
            {bookingCancelled ? "Close" : "Cancel"}
          </Button>
          {!bookingCancelled && (
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
