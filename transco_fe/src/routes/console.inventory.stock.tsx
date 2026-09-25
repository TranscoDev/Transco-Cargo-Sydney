import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, Info, PackageSearch } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchConsolidations, fetchPackagingActivity } from "@/lib/transco/api";
import type {
  Consolidation,
  PackagingActivityResult,
  PackagingBoxTotals,
} from "@/lib/transco/types";

export const Route = createFileRoute("/console/inventory/stock")({
  component: PackagingStockPage,
});

const BOX_TYPE_LABELS: Record<keyof PackagingBoxTotals, string> = {
  tc: "Tea Chest",
  gb: "Gift Box",
  ob: "Odd Box",
  wb: "Wine Box",
  ctn: "Carton",
};

type DatePreset = "this_month" | "last_3_months" | "last_6_months" | "this_year" | "custom";

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Computes {from, to} for every preset except "custom", which the
 * caller handles via the two date inputs instead. */
function rangeForPreset(preset: Exclude<DatePreset, "custom">): { from: string; to: string } {
  const now = new Date();
  const to = toDateInput(now);
  let from: Date;
  switch (preset) {
    case "this_month":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "last_3_months":
      from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      break;
    case "last_6_months":
      from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      break;
    case "this_year":
      from = new Date(now.getFullYear(), 0, 1);
      break;
  }
  return { from: toDateInput(from), to };
}

function PackagingStockPage() {
  const [preset, setPreset] = useState<DatePreset>("this_year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [destination, setDestination] = useState<string>("all");
  const [batchId, setBatchId] = useState<string>("all");

  const [batches, setBatches] = useState<Consolidation[]>([]);
  const [activity, setActivity] = useState<PackagingActivityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConsolidations()
      .then(setBatches)
      .catch(() => setBatches([]));
  }, []);

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom || undefined, to: customTo || undefined };
    return rangeForPreset(preset);
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchPackagingActivity({
      from,
      to,
      destination: destination === "all" ? undefined : destination,
      batchId: batchId === "all" ? undefined : batchId,
    })
      .then(setActivity)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load packaging activity"),
      )
      .finally(() => setLoading(false));
  }, [from, to, destination, batchId]);

  const boxTypes = (Object.keys(BOX_TYPE_LABELS) as (keyof PackagingBoxTotals)[]).filter(
    (type) => type !== "ctn" || (activity?.totals.ctn ?? 0) > 0,
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <PackageSearch className="h-4 w-4 text-muted-foreground" />
          Packaging Stock
        </h1>
        <p className="text-sm text-muted-foreground">
          Transco-owned box supplies — kept separate from Warehouse Cargo (customer goods in our
          custody).
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Current Stock</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex items-start gap-2 rounded-md bg-secondary/40 p-3 text-sm text-muted-foreground">
            <Archive className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium text-foreground">Not configured</p>
              <p className="mt-0.5 text-xs">
                Enter a physical opening stock count to begin live stock tracking. Until then, no
                current-quantity number is shown here.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">Packaging Activity</h2>
        <p className="text-xs text-muted-foreground">
          Box quantities recorded on shipments. This is usage data, not current stock or confirmed
          sales.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={preset} onValueChange={(v) => setPreset(v as DatePreset)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="this_month">This Month</SelectItem>
            <SelectItem value="last_3_months">Last 3 Months</SelectItem>
            <SelectItem value="last_6_months">Last 6 Months</SelectItem>
            <SelectItem value="this_year">This Year</SelectItem>
            <SelectItem value="custom">Custom Range</SelectItem>
          </SelectContent>
        </Select>

        {preset === "custom" && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 rounded-md border border-input bg-secondary/60 px-2 text-xs text-foreground outline-none focus:border-ring"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 rounded-md border border-input bg-secondary/60 px-2 text-xs text-foreground outline-none focus:border-ring"
            />
          </>
        )}

        <Select value={destination} onValueChange={setDestination}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Destination" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Destinations</SelectItem>
            {activity?.destinations.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={batchId} onValueChange={setBatchId}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Shipment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Shipments</SelectItem>
            {batches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                Shipment {b.batchNumber}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : activity ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {boxTypes.map((type) => (
              <Card key={type}>
                <CardHeader className="p-4 pb-1">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    Total {BOX_TYPE_LABELS[type]} Used
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <p className="text-2xl font-semibold tabular-nums text-foreground">
                    {activity.totals[type]}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="overflow-auto rounded-md border border-border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Box Type</th>
                  <th className="px-3 py-2 text-right font-medium">Total Used</th>
                  <th className="px-3 py-2 text-right font-medium">Transco Purchased</th>
                  <th className="px-3 py-2 text-right font-medium">Customer Supplied</th>
                  <th className="px-3 py-2 text-right font-medium">Unknown</th>
                </tr>
              </thead>
              <tbody>
                {boxTypes.map((type) => (
                  <tr key={type} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{BOX_TYPE_LABELS[type]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{activity.totals[type]}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {activity.sources[type].transcoPurchased}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {activity.sources[type].customerSupplied}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {activity.sources[type].unknown}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              {activity.shipmentCount} shipment{activity.shipmentCount === 1 ? "" : "s"} in this
              range. Source is "Unknown" for every record today — box source isn't captured yet, so
              nothing here is guessed.
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
