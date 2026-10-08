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

type Period = "this" | "next" | "custom";
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

  const inThisWeek = (j: Job) => j.date >= thisWeek.from && j.date <= thisWeek.to;
  const totals = {
    pickups: jobs.filter((j) => j.kind === "pickup" && j.status !== "cancelled" && inThisWeek(j))
      .length,
    deliveries: jobs.filter(
      (j) => j.kind === "delivery" && j.status !== "cancelled" && inThisWeek(j),
    ).length,
    // Every pickup still to do up to the end of this week, incl. overdue ones.
    pending: jobs.filter(
      (j) => j.kind === "pickup" && j.status === "pending" && j.date <= thisWeek.to,
    ).length,
    completed: jobs.filter((j) => j.kind === "pickup" && j.status === "completed" && inThisWeek(j))
      .length,
  };

  const range = period === "this" ? thisWeek : period === "next" ? nextWeek : custom;
  const matches = (j: Job) =>
    (type === "all" || j.kind === type) && (status === "all" || j.status === status);
  const inRange = jobs
    .filter((j) => matches(j) && j.date >= range.from && j.date <= range.to)
    .sort(byDateTime);
  // A pickup (or anything with a set day) not done before this period
  // still needs doing — kept in view instead of dropping off the list.
  // Door deliveries without a set day only carry the drop-off day, so
  // they don't count as late.
  const earlier =
    range.from <= today && (status === "all" || status === "pending")
      ? jobs
          .filter(
            (j) =>
              matches(j) &&
              j.status === "pending" &&
              j.date < range.from &&
              (j.kind === "pickup" || j.dateSet),
          )
          .sort(byDateTime)
      : [];

  const groups = new Map<string, Job[]>();
  for (const j of inRange) {
    const bucket = groups.get(j.date);
    if (bucket) bucket.push(j);
    else groups.set(j.date, [j]);
  }

  const showPendingPickups = () => {
    setPeriod("this");
    setType("pickup");
    setStatus("pending");
  };

  return (
    <PageShell width="narrow">
      <PageHeader
        icon={Truck}
        title="Pickup & Delivery"
        description="Home pickups in Sydney and door deliveries to the receiver — taken straight from the bookings."
      />

      {/* This week at a glance — each tile sets the filters below. */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label="Pickups this week"
          value={totals.pickups}
          onClick={() => {
            setPeriod("this");
            setType("pickup");
            setStatus("all");
          }}
        />
        <Tile
          label="Door deliveries this week"
          value={totals.deliveries}
          onClick={() => {
            setPeriod("this");
            setType("delivery");
            setStatus("all");
          }}
        />
        <Tile
          label="Pending pickups"
          value={totals.pending}
          attention={totals.pending > 0}
          onClick={showPendingPickups}
        />
        <Tile
          label="Pickups done this week"
          value={totals.completed}
          onClick={() => {
            setPeriod("this");
            setType("pickup");
            setStatus("completed");
          }}
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
          {shortDay(range.from)} – {shortDay(range.to)}
        </p>
      </div>

      {inRange.length === 0 && earlier.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={status === "pending" ? Check : Truck}
            title={status === "pending" ? "Nothing pending" : "Nothing in these dates"}
            description="Bookings with a home pickup or door delivery show up here. Try another week or filter."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-7">
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
  onClick,
}: {
  label: string;
  value: number;
  attention?: boolean;
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
  onOpen,
}: {
  heading: string;
  badge?: string | undefined;
  tone?: "attention";
  jobs: Job[];
  showDate?: boolean;
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
          <JobRow key={j.key} job={j} showDate={!!showDate} onOpen={() => onOpen(j.key)} />
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

function JobRow({ job, showDate, onOpen }: { job: Job; showDate: boolean; onOpen: () => void }) {
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
        {showDate && <p className="text-xs text-muted-foreground">{shortDay(job.date)}</p>}
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
