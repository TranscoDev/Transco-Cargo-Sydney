import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Box, Check, History, Layers, Phone, Ship, User } from "lucide-react";

import { Breadcrumbs, EmptyState, ErrorState, PageShell, SectionHeading, StatusBadge } from "@/components/transco/page-kit";
import { MoveShipmentControl } from "@/components/transco/move-shipment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchShipment, updateShipment } from "@/lib/transco/api";
import { friendlyError, notify } from "@/lib/transco/notify";
import { formatPhone, telHref } from "@/lib/transco/phone";
import { shipmentStatus } from "@/lib/transco/status";
import { SHIPMENT_STATUSES, SHIPMENT_STATUS_LABELS, type Shipment, type ShipmentStatus } from "@/lib/transco/types";

// Sibling of index.tsx under shipments/route.tsx's Outlet — same reason
// as console/customers/$customerId.tsx (see that file's comment).
export const Route = createFileRoute("/console/shipments/$shipmentId")({
  component: ShipmentDetailPage,
});

/**
 * One shipment, most important first: which BL, whose, where it is now
 * and the next step (one button). Details — receiver, timeline, notes,
 * documents — follow below.
 */
function ShipmentDetailPage() {
  const { shipmentId } = Route.useParams();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    fetchShipment(shipmentId)
      .then(setShipment)
      .catch(() => setFailed(true));
  }, [shipmentId]);

  useEffect(() => {
    setShipment(null);
    load();
  }, [load]);

  // Staff and customers know a shipment by its number ("Shipment 57");
  // the BL identifies this customer's part of it.
  const bl = shipment?.hblNumber ? `BL ${shipment.hblNumber}` : null;
  const title = shipment
    ? [shipment.batchNumber ? `Shipment ${shipment.batchNumber}` : null, bl].filter(Boolean).join(" · ") || shipment.shipmentNumber
    : "Shipment";
  const crumbs = [
    { label: "Shipments", to: "/console/shipments" },
    ...(shipment?.consolidationId
      ? [{ label: `Shipment ${shipment.batchNumber ?? ""}`.trim(), to: "/console/shipments/batch/$batchId", params: { batchId: shipment.consolidationId } }]
      : []),
    { label: bl ?? title },
  ];

  return (
    <PageShell>
      <Breadcrumbs items={crumbs} />
      {failed ? (
        <ErrorState title="Couldn't load this shipment" onRetry={load} />
      ) : !shipment ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading shipment">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : (
        <ShipmentView key={`${shipment.id}-${shipment.consolidationId ?? "none"}`} shipment={shipment} title={title} onChange={setShipment} onReload={load} />
      )}
    </PageShell>
  );
}

function ShipmentView({
  shipment: s,
  title,
  onChange,
  onReload,
}: {
  shipment: Shipment;
  title: string;
  onChange: (s: Shipment) => void;
  /** Reloads the BL (after it moves to another shipment). */
  onReload: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const st = shipmentStatus(s.status);
  const idx = SHIPMENT_STATUSES.indexOf(s.status);
  const next = idx >= 0 && idx < SHIPMENT_STATUSES.length - 1 ? SHIPMENT_STATUSES[idx + 1] : null;

  const setStatus = async (status: ShipmentStatus, offerUndo = true) => {
    const before = s.status;
    setSaving(true);
    try {
      const updated = await updateShipment(s.id, { status });
      onChange(updated);
      notify.success(
        `Marked as ${SHIPMENT_STATUS_LABELS[status].toLowerCase()}`,
        undefined,
        offerUndo && before !== status ? () => void setStatus(before, false) : undefined,
      );
    } catch (err) {
      notify.error("Couldn't update the status", friendlyError(err, "Nothing was changed — please try again."));
    } finally {
      setSaving(false);
    }
  };

  const cargo = [
    s.boxCount != null ? `${s.boxCount} box${s.boxCount === 1 ? "" : "es"}` : null,
    s.weight != null ? `${s.weight} kg` : null,
    s.cbm != null ? `${s.cbm} m³` : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Ship className="h-5 w-5 text-muted-foreground" aria-hidden />
            <span className="tabular-nums">{title}</span>
            <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <Link
              to="/console/customers/$customerId"
              params={{ customerId: s.customerId }}
              className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
            >
              <User className="h-4 w-4 text-muted-foreground" aria-hidden />
              {s.customerName || "Customer"}
            </Link>
            {s.phoneNumber && (
              <a href={telHref(s.phoneNumber)} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Phone className="h-3.5 w-3.5" aria-hidden />{formatPhone(s.phoneNumber)}
              </a>
            )}
            {s.consolidationId && (
              <Link
                to="/console/shipments/batch/$batchId"
                params={{ batchId: s.consolidationId }}
                className="inline-flex items-center gap-1.5 text-primary hover:underline"
              >
                <Layers className="h-3.5 w-3.5" aria-hidden />
                All of Shipment {s.batchNumber}
              </Link>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {[[s.origin, s.destination].filter(Boolean).join(" → "), cargo, s.serviceType].filter(Boolean).join(" · ") || "No route or cargo details yet"}
          </p>
        </div>
        {/* Put in the wrong shipment? Move this same BL — never a copy. */}
        <div className="w-full sm:w-96">
          <MoveShipmentControl
            shipmentId={s.id}
            currentBatchNumber={s.consolidationId ? s.batchNumber ?? null : null}
            blNumber={s.hblNumber ?? null}
            customerName={s.customerName}
            onMoved={onReload}
          />
        </div>
      </header>

      {/* Where it is + next step */}
      <section className="mb-8 rounded-xl border bg-card p-5 shadow-xs">
        <SectionHeading>Progress</SectionHeading>
        <ol className="flex flex-wrap gap-x-1 gap-y-3" aria-label="Shipment progress">
          {SHIPMENT_STATUSES.map((status, i) => {
            const done = i <= idx;
            const current = i === idx;
            return (
              <li key={status} className="flex min-w-0 items-center gap-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs",
                    current ? "bg-primary font-semibold text-primary-foreground" : done ? "bg-success-soft text-success-foreground" : "bg-secondary text-muted-foreground",
                  )}
                  aria-current={current ? "step" : undefined}
                >
                  {done && !current && <Check className="h-3 w-3" aria-hidden />}
                  {SHIPMENT_STATUS_LABELS[status]}
                </span>
                {i < SHIPMENT_STATUSES.length - 1 && <span className="h-px w-2 bg-border" aria-hidden />}
              </li>
            );
          })}
        </ol>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent/40 px-4 py-3">
          {next ? (
            <p className="text-sm text-foreground">
              <span className="font-semibold">Next step:</span> {SHIPMENT_STATUS_LABELS[next]}
            </p>
          ) : (
            <p className="text-sm font-medium text-success-foreground">✓ Delivered — this shipment is complete.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={s.status} onValueChange={(v) => void setStatus(v as ShipmentStatus)} disabled={saving}>
              <SelectTrigger className="h-9 w-44 bg-card text-sm" aria-label="Change status">
                <SelectValue placeholder="Change status" />
              </SelectTrigger>
              <SelectContent>
                {SHIPMENT_STATUSES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {SHIPMENT_STATUS_LABELS[x]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {next && (
              <Button type="button" size="sm" onClick={() => void setStatus(next)} disabled={saving}>
                Mark as {SHIPMENT_STATUS_LABELS[next].toLowerCase()}
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Receiver */}
        <section>
          <SectionHeading>Receiver</SectionHeading>
          <div className="rounded-xl border bg-card px-4 py-3">
            {s.receiverProfile ? (
              <>
                <Link
                  to="/console/shipments/receiver/$receiverId"
                  params={{ receiverId: s.receiverProfile.id }}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  {s.receiverProfile.name}
                </Link>
                {s.receiverProfile.phone && <span className="ml-2 text-sm text-muted-foreground">{formatPhone(s.receiverProfile.phone)}</span>}
                {s.receiverProfile.hblNumbers.length > 1 && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Has received {s.receiverProfile.hblNumbers.length - 1} other shipment
                    {s.receiverProfile.hblNumbers.length - 1 === 1 ? "" : "s"} — open their page for the full list.
                  </p>
                )}
              </>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">No receiver linked to this shipment.</p>
            )}
          </div>
        </section>

        {/* Timeline */}
        <section>
          <SectionHeading>History</SectionHeading>
          <div className="rounded-xl border bg-card">
            {s.history.length === 0 ? (
              <EmptyState compact icon={History} title="No status changes yet" />
            ) : (
              <ol className="divide-y">
                {[...s.history].reverse().map((point, i) => (
                  <li key={`${point.status}-${point.at}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className={cn("font-medium", i === 0 ? "text-foreground" : "text-muted-foreground")}>{SHIPMENT_STATUS_LABELS[point.status]}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(point.at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <NotesSection shipment={s} onChange={onChange} />

        {/* Documents */}
        <section>
          <SectionHeading>Documents</SectionHeading>
          <div className="grid grid-cols-2 gap-4 rounded-xl border bg-card px-4 py-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Master BL</p>
              <p className="font-medium tabular-nums text-foreground">{s.blNumber || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Container</p>
              <p className="inline-flex items-center gap-1.5 font-medium tabular-nums text-foreground">
                <Box className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {s.containerNumber || "—"}
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function NotesSection({ shipment: s, onChange }: { shipment: Shipment; onChange: (s: Shipment) => void }) {
  const [tracking, setTracking] = useState(s.trackingNumber ?? "");
  const [warehouse, setWarehouse] = useState(s.warehouseStatus ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = tracking !== (s.trackingNumber ?? "") || warehouse !== (s.warehouseStatus ?? "");

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateShipment(s.id, { trackingNumber: tracking || null, warehouseStatus: warehouse || null });
      onChange(updated);
      notify.success("Shipment saved");
    } catch (err) {
      notify.error("Couldn't save the shipment", friendlyError(err, "Your changes were not saved — please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <SectionHeading>Warehouse & tracking</SectionHeading>
      <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="warehouseStatus">Warehouse note</Label>
          <Input id="warehouseStatus" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} placeholder="e.g. Received, 3 of 3 boxes checked in" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trackingNumber">Tracking number</Label>
          <Input id="trackingNumber" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </div>
        <Button type="button" size="sm" onClick={save} disabled={saving || !dirty} className="self-start">
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}

