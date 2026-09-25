import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Anchor, MapPin, Package, Search, ShieldCheck, Ship, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchTracking } from "@/lib/transco/api";
import { SHIPMENT_STATUS_LABELS, type TrackingResult } from "@/lib/transco/types";

export const Route = createFileRoute("/console/tracking")({
  component: TrackingPage,
});

function TrackingPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const bl = query.trim();
    if (!bl) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchTracking(bl);
      setResult(data);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to look up tracking");
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const nothingFound = result && !result.peblFound && !result.shipment;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          Tracking
        </h1>
        <p className="text-sm text-muted-foreground">
          Look up a BL/HBL number's live customs status straight from PEBL, without leaving the
          console — same source the WhatsApp bot uses to answer customers.
        </p>
      </div>

      <form onSubmit={handleSearch} className="mb-6 flex max-w-md items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter BL / HBL number, e.g. 203143"
            aria-label="BL number"
            className="h-10 w-full rounded-md border border-input bg-secondary/60 pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:bg-panel"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="h-10 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "Tracking…" : "Track"}
        </button>
      </form>

      {error && (
        <p className="mb-4 max-w-2xl rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {!searched && !error && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-16 text-center">
          <Ship className="h-5 w-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Enter a BL number above to see its customs status and CRM record.
          </p>
        </div>
      )}

      {nothingFound && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-16 text-center">
          <Package className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            No shipment found for {result.blNumber}
          </p>
          <p className="text-xs text-muted-foreground">
            Not in PEBL and no matching CRM record — double-check the number.
          </p>
        </div>
      )}

      {result && (result.peblFound || result.shipment) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <ShieldCheck className="h-3.5 w-3.5" />
                PEBL Customs Status
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {result.peblFound && result.pebl ? (
                <div className="flex flex-col gap-2.5">
                  <FieldRow label="PE Shipment #" value={result.pebl.peblShipmentNumber} />
                  <FieldRow
                    label="Route"
                    value={
                      result.pebl.portOfLoading && result.pebl.portOfDischarge
                        ? `${result.pebl.portOfLoading} → ${result.pebl.portOfDischarge}`
                        : null
                    }
                    icon={Anchor}
                  />
                  <FieldRow label="Estimated Arrival" value={result.pebl.estimatedArrivalDate} />
                  <FieldRow
                    label="Estimated Clearance"
                    value={result.pebl.estimatedClearanceDate}
                  />
                  <div className="mt-1 rounded-md bg-secondary/40 px-3 py-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Estimated Delivery
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {result.pebl.estimatedDeliveryDate || "—"}
                    </p>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Live from pebl-tracker.transcocargo.com.au — estimates only, may vary.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Not yet showing in PEBL for this BL number — it may not have been lodged/ cleared
                  yet.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Package className="h-3.5 w-3.5" />
                CRM Record
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {result.shipment ? (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <Link
                      to="/console/shipments/$shipmentId"
                      params={{ shipmentId: result.shipment.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      HBL {result.shipment.hblNumber}
                    </Link>
                    <Badge variant="secondary" className="font-medium">
                      {SHIPMENT_STATUS_LABELS[result.shipment.status]}
                    </Badge>
                  </div>
                  {result.shipment.customerName && (
                    <Link
                      to="/console/customers/$customerId"
                      params={{ customerId: result.shipment.customerId }}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <User className="h-3 w-3" />
                      {result.shipment.customerName}
                    </Link>
                  )}
                  {result.shipment.receiverProfile && (
                    <FieldRow label="Receiver" value={result.shipment.receiverProfile.name} />
                  )}
                  {result.shipment.consolidationId && (
                    <Link
                      to="/console/shipments/batch/$batchId"
                      params={{ batchId: result.shipment.consolidationId }}
                      className="text-xs text-primary hover:underline"
                    >
                      Shipment {result.shipment.batchNumber}
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No matching shipment in the CRM yet for this BL number.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | null;
  icon?: typeof Anchor;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </span>
      <span className="font-medium text-foreground">{value || "—"}</span>
    </div>
  );
}
