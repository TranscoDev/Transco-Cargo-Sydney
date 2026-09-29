import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Layers, Package, Plus, Search, Ship } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingRows, StatusBadge } from "@/components/transco/page-kit";
import { shipmentStatus } from "@/lib/transco/status";
import { useConversations } from "@/lib/transco/store";
import { createShipment, fetchConsolidations, fetchShipments } from "@/lib/transco/api";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  type Consolidation,
  type Shipment,
  type ShipmentStatus,
} from "@/lib/transco/types";

export const Route = createFileRoute("/console/shipments/")({
  component: ShipmentsPage,
});

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function ShipmentsPage() {
  const { conversations, bookings } = useConversations();
  const [view, setView] = useState<"batches" | "all">("batches");

  const [consolidations, setConsolidations] = useState<Consolidation[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState<string | null>(null);

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);

  const loadBatches = () => {
    setBatchesLoading(true);
    fetchConsolidations()
      .then((data) => {
        setConsolidations(data);
        setBatchesError(null);
      })
      .catch((err) =>
        setBatchesError(err instanceof Error ? err.message : "Failed to load shipment batches"),
      )
      .finally(() => setBatchesLoading(false));
  };

  const loadShipments = () => {
    setLoading(true);
    fetchShipments()
      .then((data) => {
        setShipments(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load shipments"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBatches();
    loadShipments();
  }, []);

  const unassignedCount = useMemo(
    () => shipments.filter((s) => !s.consolidationId).length,
    [shipments],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shipments.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.shipmentNumber.toLowerCase().includes(q) ||
        (s.customerName ?? "").toLowerCase().includes(q) ||
        (s.hblNumber ?? "").toLowerCase().includes(q) ||
        (s.trackingNumber ?? "").toLowerCase().includes(q) ||
        (s.blNumber ?? "").toLowerCase().includes(q)
      );
    });
  }, [shipments, query, statusFilter]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-8 md:py-7">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <Ship className="h-5 w-5 text-muted-foreground" aria-hidden />
            Shipments
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Customer cargo from warehouse intake to delivery. Open a shipment (e.g. Shipment 57) to see every sender and receiver in it, or a BL to update its status.
          </p>
        </div>
        <NewShipmentDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          customers={conversations}
          bookings={bookings}
          onCreated={loadShipments}
        />
      </div>

      <div className="mb-5 inline-flex items-center gap-1 rounded-lg bg-secondary p-1">
        <button
          type="button"
          onClick={() => setView("batches")}
          aria-pressed={view === "batches"}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            view === "batches" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          By shipment ({consolidations.length})
        </button>
        <button
          type="button"
          onClick={() => setView("all")}
          aria-pressed={view === "all"}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            view === "all" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          All BLs ({shipments.length})
        </button>
      </div>

      {view === "batches" ? (
        <BatchListView
          consolidations={consolidations}
          loading={batchesLoading}
          error={batchesError}
          unassignedCount={unassignedCount}
        />
      ) : (
        <AllShipmentsView
          shipments={filtered}
          totalCount={shipments.length}
          loading={loading}
          error={error}
          query={query}
          onQueryChange={setQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
      )}
      </div>
    </div>
  );
}

function BatchListView({
  consolidations,
  loading,
  error,
  unassignedCount,
}: {
  consolidations: Consolidation[];
  loading: boolean;
  error: string | null;
  unassignedCount: number;
}) {
  if (error) return <ErrorState title="Couldn't load shipments" onRetry={() => window.location.reload()} />;
  if (loading) return <LoadingRows rows={5} />;
  if (consolidations.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <EmptyState icon={Layers} title="No shipments yet" description="Shipments appear here once they're imported from the shipment tracker." />
      </div>
    );
  }

  return (
    <>
      <div className="overflow-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Shipment</th>
              <th className="px-4 py-3 font-medium">PE Number</th>
              <th className="px-4 py-3 font-medium">HBL Range</th>
              <th className="px-4 py-3 font-medium">Imported</th>
              <th className="px-4 py-3 font-medium">Gross Income</th>
              <th className="px-4 py-3 font-medium">Gross Profit</th>
              <th className="px-4 py-3 font-medium">PEBL ETA</th>
            </tr>
          </thead>
          <tbody>
            {consolidations.map((c) => (
              <tr key={c.id} className="border-t border-border transition-colors hover:bg-accent/30">
                <td className="px-4 py-3">
                  <Link
                    to="/console/shipments/batch/$batchId"
                    params={{ batchId: c.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    Shipment {c.batchNumber}
                  </Link>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </td>
                <td className="px-4 py-3">{c.peNumber || "—"}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">
                  {c.hblRange.from}–{c.hblRange.to}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {c.importedShipmentCount} / {c.totals.hbl}
                  {c.importedShipmentCount < c.totals.hbl && (
                    <span className="ml-1.5 text-xs text-muted-foreground">imported so far</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">{AUD.format(c.financials.grossIncome)}</td>
                <td className="px-4 py-3 tabular-nums text-success-foreground">
                  {AUD.format(c.financials.grossProfit)}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {c.dates.peblEta || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unassignedCount > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {unassignedCount} record{unassignedCount === 1 ? "" : "s"} not grouped under any shipment
          — see "All BLs".
        </p>
      )}
    </>
  );
}

function AllShipmentsView({
  shipments,
  totalCount,
  loading,
  error,
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
}: {
  shipments: Shipment[];
  totalCount: number;
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  statusFilter: ShipmentStatus | "all";
  onStatusFilterChange: (s: ShipmentStatus | "all") => void;
}) {
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search BL, customer, shipment or tracking"
            aria-label="Search shipments"
            className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as ShipmentStatus | "all")}>
          <SelectTrigger className="h-10 w-52 bg-card" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses ({totalCount})</SelectItem>
            {SHIPMENT_STATUSES.map((st) => (
              <SelectItem key={st} value={st}>
                {SHIPMENT_STATUS_LABELS[st]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>



      {error ? (
        <ErrorState title="Couldn't load shipments" onRetry={() => window.location.reload()} />
      ) : loading ? (
        <LoadingRows rows={6} />
      ) : shipments.length === 0 ? (
        <div className="rounded-xl border bg-card">
          {totalCount === 0 ? (
            <EmptyState icon={Package} title="No shipments yet" description="A BL appears here when a booking is given one." />
          ) : (
            <EmptyState icon={Search} title="No BLs found" description="Try changing your search or status filter." />
          )}
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Shipment</th>
                <th className="px-4 py-3 font-medium">BL</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Boxes</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id} className="border-t border-border transition-colors hover:bg-accent/30">
                  <td className="px-4 py-3">
                    <Link
                      to="/console/shipments/$shipmentId"
                      params={{ shipmentId: s.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.batchNumber ? `Shipment ${s.batchNumber}` : s.shipmentNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium tabular-nums text-foreground">{s.hblNumber || "—"}</td>
                  <td className="px-4 py-3">{s.customerName || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.origin || "?"} → {s.destination || "?"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{s.boxCount ?? s.totalBoxes ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={shipmentStatus(s.status).tone}>{shipmentStatus(s.status).label}</StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(s.updatedAt).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function NewShipmentDialog({
  open,
  onOpenChange,
  customers,
  bookings,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: { id: string; customerName: string; phoneNumber: string }[];
  bookings: { id: string; customerId: string; customerName: string; resolvedDate: string }[];
  onCreated: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [boxCount, setBoxCount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableBookings = bookings.filter((b) => !customerId || b.customerId === customerId);

  const reset = () => {
    setCustomerId("");
    setBookingId("");
    setOrigin("");
    setDestination("");
    setServiceType("");
    setBoxCount("");
    setError(null);
  };

  const handleCreate = async () => {
    if (!customerId) {
      setError("Select a customer first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createShipment({
        customerId,
        bookingId: bookingId || null,
        origin: origin || null,
        destination: destination || null,
        serviceType: serviceType || null,
        boxCount: boxCount === "" ? null : Number(boxCount),
      });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shipment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Shipment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Shipment</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shipment-customer">Customer</Label>
            <Select
              value={customerId}
              onValueChange={(v) => {
                setCustomerId(v);
                setBookingId("");
              }}
            >
              <SelectTrigger id="shipment-customer">
                <SelectValue placeholder="Select a customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.customerName || c.phoneNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shipment-booking">Link to Booking (optional)</Label>
            <Select value={bookingId} onValueChange={setBookingId} disabled={!customerId}>
              <SelectTrigger id="shipment-booking">
                <SelectValue placeholder={customerId ? "None" : "Select a customer first"} />
              </SelectTrigger>
              <SelectContent>
                {availableBookings.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.resolvedDate} — {b.customerName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shipment-origin">Origin</Label>
              <Input
                id="shipment-origin"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Sydney"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shipment-destination">Destination</Label>
              <Input
                id="shipment-destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Colombo"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shipment-service">Service Type</Label>
              <Input
                id="shipment-service"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                placeholder="Sea Freight"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shipment-boxes">Boxes</Label>
              <Input
                id="shipment-boxes"
                type="number"
                min="0"
                value={boxCount}
                onChange={(e) => setBoxCount(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create Shipment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
