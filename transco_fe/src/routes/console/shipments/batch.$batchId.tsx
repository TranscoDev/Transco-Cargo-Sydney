import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CalendarDays, Info, Layers, Package, PenLine, Trash2, User, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteConsolidation, fetchConsolidation, updateConsolidation } from "@/lib/transco/api";
import type { ConsolidationDetail } from "@/lib/transco/types";
import { Breadcrumbs, LoadingRows, PageShell, StatusBadge } from "@/components/transco/page-kit";
import { forgetShipmentList } from "@/components/transco/shipment-picker";
import { notify } from "@/lib/transco/notify";
import { shipmentStatus } from "@/lib/transco/status";
import { cn } from "@/lib/utils";

// Sibling of index.tsx under shipments/route.tsx's Outlet — same pattern
// as $shipmentId.tsx. Dot-segment file (batch.$batchId.tsx) inside the
// shipments folder maps to /console/shipments/batch/:batchId.
export const Route = createFileRoute("/console/shipments/batch/$batchId")({
  component: BatchDetailPage,
});

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 2,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Console-made shipments store YYYY-MM-DD; imported ones keep the sheet's text ("November 10"). */
function fmtDate(value: string | null) {
  if (!value) return null;
  if (!ISO_DATE.test(value)) return value;
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function BatchDetailPage() {
  const { batchId } = Route.useParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState<ConsolidationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setError(null);
    fetchConsolidation(batchId)
      .then(setBatch)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the shipment"));
  };

  useEffect(() => {
    setBatch(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  const handleDelete = async () => {
    if (!batch) return;
    const n = batch.shipments.length;
    if (n > 0) {
      notify.error(
        `Shipment ${batch.batchNumber} still has ${n} HBL${n === 1 ? "" : "s"}`,
        `Open each HBL and move it to the right shipment first. Then you can delete this one.`,
      );
      return;
    }
    if (!window.confirm(`Delete Shipment ${batch.batchNumber}? It has no HBLs, so no customer is affected.`)) return;
    setDeleting(true);
    try {
      await deleteConsolidation(batch.id);
      forgetShipmentList();
      notify.success(`Shipment ${batch.batchNumber} deleted`);
      navigate({ to: "/console/shipments" });
    } catch (err) {
      notify.error("Couldn't delete the shipment", err instanceof Error ? err.message : undefined);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageShell>
      <Breadcrumbs items={[{ label: "Shipments", to: "/console/shipments" }, { label: batch ? `Shipment ${batch.batchNumber}` : "Shipment" }]} />

      {error && (
        <p className="mb-4 rounded-lg border border-attention/20 bg-attention-soft px-4 py-3 text-sm text-attention-foreground">
          {error}
        </p>
      )}

      {!batch && !error && <LoadingRows rows={4} />}

      {batch && (
        <>
          {/* Friendly header strip — same look as Settings / Bot settings. */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-linear-to-r from-primary/10 via-card to-card p-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl font-bold tabular-nums text-primary-foreground">
                {batch.batchNumber}
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">Shipment {batch.batchNumber}</h1>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  <Chip>{batch.label}</Chip>
                  {batch.peNumber && <Chip>PE {batch.peNumber}</Chip>}
                  {batch.hblRange.from && (
                    <Chip>
                      HBL {batch.hblRange.from}
                      {batch.hblRange.to && batch.hblRange.to !== batch.hblRange.from ? `–${batch.hblRange.to}` : ""}
                    </Chip>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
                <PenLine className="h-3.5 w-3.5" />
                Edit
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>

          {/* Box counts as simple tiles. */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label="HBLs" value={batch.totals.hbl || batch.shipments.length} hint={batch.totals.hbl && batch.importedShipmentCount < batch.totals.hbl ? `${batch.importedShipmentCount} in the system so far` : undefined} />
            <Tile label="TC" value={batch.totals.tc} />
            <Tile label="GB" value={batch.totals.gb} />
            <Tile label="OB" value={batch.totals.ob} />
            <Tile label="CBM" value={batch.totals.totalCbm != null ? `${batch.totals.totalCbm} m³` : "—"} />
          </div>

          <div className="mb-8 grid items-start gap-6 lg:grid-cols-2">
            <SectionCard icon={Wallet} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" title="Money">
              <div className="flex flex-col gap-2 text-sm">
                <Line label="Income" value={AUD.format(batch.financials.grossIncome)} />
                <Line label="Expenses" value={AUD.format(batch.financials.totalExpenses)} />
                <div className="mt-1 flex items-baseline justify-between rounded-lg bg-success-soft px-3 py-2">
                  <span className="font-medium text-success-foreground">Profit</span>
                  <span className="text-xl font-semibold tabular-nums text-success-foreground">{AUD.format(batch.financials.grossProfit)}</span>
                </div>
                {batch.financialsNote && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="flex cursor-pointer items-center gap-1.5">
                      <Info className="h-3 w-3" />
                      Note from the import
                    </summary>
                    <p className="mt-2 rounded-lg bg-secondary/50 p-3 leading-snug">{batch.financialsNote}</p>
                  </details>
                )}
              </div>
            </SectionCard>

            <SectionCard icon={CalendarDays} tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" title="Key dates">
              <div className="flex flex-col gap-2 text-sm">
                <Line label="Leaves Sydney (ETD)" value={fmtDate(batch.dates.sydneyCalendarEtd)} />
                {batch.dates.sydneyCalendarEta && <Line label="Arrives (ETA)" value={fmtDate(batch.dates.sydneyCalendarEta)} />}
                <Line label="PEBL ETA" value={fmtDate(batch.dates.peblEta)} />
                <Line label="PEBL delivery" value={fmtDate(batch.dates.peblDeliveryDate)} />
              </div>
            </SectionCard>
          </div>

          <h2 className="mb-2 text-sm font-semibold text-foreground">
            Customers in this shipment <span className="font-normal text-muted-foreground">({batch.shipments.length})</span>
          </h2>

          {batch.shipments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card py-12 text-center">
              <Package className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No HBLs in this shipment yet.</p>
              <p className="text-xs text-muted-foreground">Customers join when you assign their BL and pick Shipment {batch.batchNumber}.</p>
            </div>
          ) : (
            <div className="overflow-auto rounded-xl border bg-card shadow-xs">
              <table className="w-full min-w-190 text-left text-sm">
                <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">HBL</th>
                    <th className="px-4 py-2.5 font-medium">Sender</th>
                    <th className="px-4 py-2.5 font-medium">Receiver</th>
                    <th className="px-4 py-2.5 font-medium">Boxes</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.shipments.map((s) => (
                    <tr key={s.id} className="border-t border-border hover:bg-secondary/30">
                      <td className="px-4 py-2.5">
                        <Link
                          to="/console/shipments/$shipmentId"
                          params={{ shipmentId: s.id }}
                          className="font-semibold tabular-nums text-primary hover:underline"
                        >
                          {s.hblNumber || s.shipmentNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        {s.customerName ? (
                          <Link
                            to="/console/customers/$customerId"
                            params={{ customerId: s.customerId }}
                            className="inline-flex items-center gap-1.5 text-foreground hover:text-primary hover:underline"
                          >
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            {s.customerName}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {s.receiverProfile ? (
                          <>
                            <Link
                              to="/console/shipments/receiver/$receiverId"
                              params={{ receiverId: s.receiverProfile.id }}
                              className="text-foreground hover:text-primary hover:underline"
                            >
                              {s.receiverProfile.name}
                            </Link>
                            {s.receiverProfile.hblNumbers.length > 1 && (
                              <p className="text-xs text-muted-foreground">
                                +{s.receiverProfile.hblNumbers.length - 1} other shipment
                                {s.receiverProfile.hblNumbers.length - 1 === 1 ? "" : "s"}
                              </p>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {s.boxes
                          ? [
                              s.boxes.tc ? `${s.boxes.tc} TC` : null,
                              s.boxes.gb ? `${s.boxes.gb} GB` : null,
                              s.boxes.ob ? `${s.boxes.ob} OB` : null,
                              s.boxes.wb ? `${s.boxes.wb} WB` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"
                          : (s.totalBoxes ?? "—")}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge tone={shipmentStatus(s.status).tone}>{shipmentStatus(s.status).label}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <EditShipmentDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            batch={batch}
            onSaved={() => {
              forgetShipmentList();
              load();
            }}
          />
        </>
      )}
    </PageShell>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border bg-card px-2 py-0.5 text-muted-foreground">{children}</span>;
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionCard({ icon: Icon, tone, title, children }: { icon: typeof Wallet; tone: string; title: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 p-5 pb-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone)}>
          <Icon className="h-4.5 w-4.5" />
        </span>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-2">{children}</CardContent>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value || "—"}</span>
    </div>
  );
}

const DATE_FIELDS = [
  { key: "departureDate", field: "sydneyCalendarEtd", label: "Leaves Sydney (ETD)" },
  { key: "arrivalDate", field: "sydneyCalendarEta", label: "Arrives (ETA)" },
  { key: "peblEta", field: "peblEta", label: "PEBL ETA" },
  { key: "peblDeliveryDate", field: "peblDeliveryDate", label: "PEBL delivery" },
] as const;

type DateKey = (typeof DATE_FIELDS)[number]["key"];

function EditShipmentDialog({
  open,
  onOpenChange,
  batch,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: ConsolidationDetail;
  onSaved: () => void;
}) {
  const initialDates = () =>
    Object.fromEntries(
      DATE_FIELDS.map((d) => {
        const v = batch.dates[d.field];
        return [d.key, v && ISO_DATE.test(v) ? v : ""];
      }),
    ) as Record<DateKey, string>;

  const [number, setNumber] = useState(String(batch.batchNumber));
  const [peNumber, setPeNumber] = useState(batch.peNumber ?? "");
  const [dates, setDates] = useState<Record<DateKey, string>>(initialDates);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNumber(String(batch.batchNumber));
    setPeNumber(batch.peNumber ?? "");
    setDates(initialDates());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, batch]);

  const n = Number(number);
  const numberChanged = Number.isInteger(n) && n !== batch.batchNumber;
  const hblCount = batch.shipments.length;

  const handleSave = async () => {
    if (!Number.isInteger(n) || n < 1) {
      setError("The shipment number must be a whole number, e.g. 59.");
      return;
    }
    // Send only what changed — an imported date like "November 10" stays
    // untouched unless staff pick a new one.
    const before = initialDates();
    const input: Parameters<typeof updateConsolidation>[1] = {};
    if (numberChanged) input.batchNumber = n;
    if (peNumber.trim() !== (batch.peNumber ?? "")) input.peNumber = peNumber.trim() || null;
    for (const d of DATE_FIELDS) {
      if (dates[d.key] !== before[d.key]) input[d.key] = dates[d.key] || null;
    }
    if (!Object.keys(input).length) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await updateConsolidation(batch.id, input);
      notify.success(`Shipment ${saved.batchNumber} saved`, numberChanged && hblCount ? `All ${hblCount} HBLs now show Shipment ${saved.batchNumber}.` : undefined);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the shipment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Shipment {batch.batchNumber}</DialogTitle>
          <DialogDescription>Fix a wrong number, PE number or date. Only what you change is saved.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-number">Shipment number</Label>
              <Input id="edit-number" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-pe">PE number</Label>
              <Input id="edit-pe" value={peNumber} onChange={(e) => setPeNumber(e.target.value)} placeholder="Not known yet" />
            </div>
          </div>
          {numberChanged && hblCount > 0 && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
              All {hblCount} HBL{hblCount === 1 ? "" : "s"} in this shipment will change to Shipment {n} too.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {DATE_FIELDS.map((d) => {
              const current = batch.dates[d.field];
              const isText = !!current && !ISO_DATE.test(current);
              return (
                <div key={d.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`edit-${d.key}`}>{d.label}</Label>
                  <Input
                    id={`edit-${d.key}`}
                    type="date"
                    value={dates[d.key]}
                    onChange={(e) => setDates((prev) => ({ ...prev, [d.key]: e.target.value }))}
                  />
                  {isText && <span className="text-xs text-muted-foreground">Now: {current}</span>}
                </div>
              );
            })}
          </div>
          {error && <p className="text-xs font-medium text-attention-foreground">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
