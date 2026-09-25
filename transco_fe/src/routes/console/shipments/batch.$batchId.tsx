import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, Info, Layers, Package, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchConsolidation } from "@/lib/transco/api";
import { SHIPMENT_STATUS_LABELS, type ConsolidationDetail } from "@/lib/transco/types";

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

function BatchDetailPage() {
  const { batchId } = Route.useParams();
  const [batch, setBatch] = useState<ConsolidationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBatch(null);
    setError(null);
    fetchConsolidation(batchId)
      .then(setBatch)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load batch"));
  }, [batchId]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <Link
        to="/console/shipments"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Shipments
      </Link>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {!batch && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {batch && (
        <>
          <div className="mb-5">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Layers className="h-4 w-4 text-muted-foreground" />
              Batch {batch.batchNumber}
              <span className="text-sm font-normal text-muted-foreground">({batch.label})</span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              PE {batch.peNumber || "—"} · HBL {batch.hblRange.from}–{batch.hblRange.to} ·{" "}
              {batch.importedShipmentCount} of {batch.totals.hbl} shipments imported so far
            </p>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Batch Totals
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-y-4 p-4 pt-0">
                <Stat label="HBL" value={batch.totals.hbl} />
                <Stat label="TC" value={batch.totals.tc} />
                <Stat label="GB" value={batch.totals.gb} />
                <Stat label="OB" value={batch.totals.ob} />
                <Stat
                  label="CBM"
                  value={batch.totals.totalCbm != null ? `${batch.totals.totalCbm}m³` : "—"}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Financials
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 p-4 pt-0">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Income</span>
                  <span className="text-sm font-medium tabular-nums text-foreground">
                    {AUD.format(batch.financials.grossIncome)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Expenses</span>
                  <span className="text-sm font-medium tabular-nums text-foreground">
                    {AUD.format(batch.financials.totalExpenses)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between border-t border-border pt-2">
                  <span className="text-sm font-medium text-foreground">Profit</span>
                  <span className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {AUD.format(batch.financials.grossProfit)}
                  </span>
                </div>
                {batch.financialsNote && (
                  <div className="mt-1 flex items-start gap-1.5 rounded-md bg-secondary/40 p-2 text-[11px] leading-snug text-muted-foreground">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{batch.financialsNote}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Key Dates
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5 p-4 pt-0">
                <DateRow label="ETD" value={batch.dates.sydneyCalendarEtd} />
                <DateRow label="PEBL ETA" value={batch.dates.peblEta} />
                <DateRow label="PEBL Delivery" value={batch.dates.peblDeliveryDate} />
              </CardContent>
            </Card>
          </div>

          <h2 className="mb-2 text-sm font-medium text-foreground">
            Shipments in this batch ({batch.shipments.length})
          </h2>

          {batch.shipments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-12 text-center">
              <Package className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                No shipments from this batch have been imported yet.
              </p>
            </div>
          ) : (
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">HBL</th>
                    <th className="px-3 py-2 font-medium">Sender</th>
                    <th className="px-3 py-2 font-medium">Receiver</th>
                    <th className="px-3 py-2 font-medium">Boxes</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.shipments.map((s) => (
                    <tr key={s.id} className="border-t border-border hover:bg-secondary/30">
                      <td className="px-3 py-2">
                        <Link
                          to="/console/shipments/$shipmentId"
                          params={{ shipmentId: s.id }}
                          className="font-medium text-primary hover:underline"
                        >
                          {s.hblNumber || s.shipmentNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {s.customerName ? (
                          <Link
                            to="/console/customers/$customerId"
                            params={{ customerId: s.customerId }}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <User className="h-3 w-3" />
                            {s.customerName}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {s.receiverProfile ? (
                          <>
                            <Link
                              to="/console/shipments/receiver/$receiverId"
                              params={{ receiverId: s.receiverProfile.id }}
                              className="text-primary hover:underline"
                            >
                              {s.receiverProfile.name}
                            </Link>
                            {s.receiverProfile.hblNumbers.length > 1 && (
                              <p className="text-xs text-muted-foreground">
                                +{s.receiverProfile.hblNumbers.length - 1} other shipment
                                {s.receiverProfile.hblNumbers.length - 1 === 1 ? "" : "s"} to this
                                person
                              </p>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
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
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className="font-medium">
                          {SHIPMENT_STATUS_LABELS[s.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function DateRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium text-foreground">{value || "—"}</span>
    </div>
  );
}
