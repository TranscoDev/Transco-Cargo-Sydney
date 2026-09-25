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

const STATUS_BADGE: Record<ShipmentStatus, string> = {
  booked: "bg-secondary text-muted-foreground",
  cargo_received: "bg-human-soft text-human-foreground",
  at_warehouse: "bg-human-soft text-human-foreground",
  loaded: "bg-primary/15 text-primary",
  in_transit: "bg-primary text-primary-foreground",
  arrived: "bg-primary/15 text-primary",
  customs: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  ready_for_collection: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  delivered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

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
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Ship className="h-4 w-4 text-muted-foreground" />
            Shipments
          </h1>
          <p className="text-sm text-muted-foreground">
            Grouped by shipment — open one to see every sender and receiver in it.
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

      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setView("batches")}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            view === "batches"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
          )}
        >
          By Shipment ({consolidations.length})
        </button>
        <button
          type="button"
          onClick={() => setView("all")}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            view === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
          )}
        >
          All Shipments ({shipments.length})
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
  if (error) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (consolidations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-12 text-center">
        <Layers className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">No shipments imported yet.</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Shipment</th>
              <th className="px-3 py-2 font-medium">PE Number</th>
              <th className="px-3 py-2 font-medium">HBL Range</th>
              <th className="px-3 py-2 font-medium">Imported</th>
              <th className="px-3 py-2 font-medium">Gross Income</th>
              <th className="px-3 py-2 font-medium">Gross Profit</th>
              <th className="px-3 py-2 font-medium">PEBL ETA</th>
            </tr>
          </thead>
          <tbody>
            {consolidations.map((c) => (
              <tr key={c.id} className="border-t border-border hover:bg-secondary/30">
                <td className="px-3 py-2">
                  <Link
                    to="/console/shipments/batch/$batchId"
                    params={{ batchId: c.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    Shipment {c.batchNumber}
                  </Link>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </td>
                <td className="px-3 py-2">{c.peNumber || "—"}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {c.hblRange.from}–{c.hblRange.to}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {c.importedShipmentCount} / {c.totals.hbl}
                  {c.importedShipmentCount < c.totals.hbl && (
                    <span className="ml-1.5 text-xs text-muted-foreground">imported so far</span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">{AUD.format(c.financials.grossIncome)}</td>
                <td className="px-3 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">
                  {AUD.format(c.financials.grossProfit)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
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
          — see "All Shipments".
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
      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onStatusFilterChange("all")}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            statusFilter === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
          )}
        >
          All ({totalCount})
        </button>
        {SHIPMENT_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onStatusFilterChange(s)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
              statusFilter === s
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
            )}
          >
            {SHIPMENT_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search shipment #, customer, HBL, BL, tracking"
          aria-label="Search shipments"
          className="h-9 w-full rounded-md border border-input bg-secondary/60 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:bg-panel"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shipments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-12 text-center">
          <Package className="h-5 w-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {totalCount === 0
              ? "No shipments yet. Create one from a booking or standalone."
              : "No shipments match this filter."}
          </p>
        </div>
      ) : (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Shipment #</th>
                <th className="px-3 py-2 font-medium">HBL</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Route</th>
                <th className="px-3 py-2 font-medium">Boxes</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id} className="border-t border-border hover:bg-secondary/30">
                  <td className="px-3 py-2">
                    <Link
                      to="/console/shipments/$shipmentId"
                      params={{ shipmentId: s.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.shipmentNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{s.hblNumber || "—"}</td>
                  <td className="px-3 py-2">{s.customerName || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {s.origin || "?"} → {s.destination || "?"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{s.boxCount ?? s.totalBoxes ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge
                      className={cn("font-medium", STATUS_BADGE[s.status])}
                      variant="secondary"
                    >
                      {SHIPMENT_STATUS_LABELS[s.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
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
