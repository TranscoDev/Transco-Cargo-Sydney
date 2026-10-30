import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Layers, Package, Plus, Search, Ship } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { getCurrentUser } from "@/lib/transco/auth";
import { createConsolidation, fetchShipmentBoard, fetchShipments } from "@/lib/transco/api";
import { forgetShipmentList } from "@/components/transco/shipment-picker";
import { ShipmentSheetImportDialog } from "@/components/transco/shipment-sheet-import";
import { notify } from "@/lib/transco/notify";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  type Consolidation,
  type LiveBoxCounts,
  type Shipment,
  type ShipmentStatus,
} from "@/lib/transco/types";

// ETAs arrive as "2026-12-07" (tracker) or "October 10" (old sheets, no
// year): all shown as YYYY-MM-DD. No year = the one closest to today.
// Display only; anything unreadable is shown as it was saved.
function etaDate(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const now = new Date();
  const candidates = /\b\d{4}\b/.test(s)
    ? [new Date(s)]
    : [-1, 0, 1].map((dy) => new Date(`${s} ${now.getFullYear() + dy}`));
  const ok = candidates.filter((d) => !Number.isNaN(d.getTime()));
  if (!ok.length) return s;
  const d = ok.reduce((a, b) => (Math.abs(b.getTime() - now.getTime()) < Math.abs(a.getTime() - now.getTime()) ? b : a));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const Route = createFileRoute("/console/shipments/")({
  component: ShipmentsPage,
});

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

// The shipment sheet's columns. OB = Odd Box (TVs and other odd sizes).
const BOX_COLS: { key: keyof LiveBoxCounts; label: string; title: string }[] = [
  { key: "bls", label: "BLs", title: "BLs in this shipment" },
  { key: "tc", label: "TC", title: "Tea Chest" },
  { key: "gb", label: "GB", title: "Gift Box" },
  { key: "ob", label: "OB", title: "Odd Box (TVs, other sizes)" },
  { key: "wb", label: "WB", title: "Wine Box" },
  { key: "quarterCbm", label: "¼ CBM", title: "Quarter CBM box" },
  { key: "halfCbm", label: "½ CBM", title: "Half CBM box" },
  { key: "oneCbm", label: "1 CBM", title: "1 CBM box" },
  { key: "total", label: "Total boxes", title: "Total boxes" },
];

// Always shown; WB and the CBM sizes only appear once some shipment has them.
const ALWAYS_SHOWN: (keyof LiveBoxCounts)[] = ["bls", "tc", "gb", "ob", "total"];

function visibleBoxCols(all: (LiveBoxCounts | null | undefined)[]) {
  return BOX_COLS.filter((col) => ALWAYS_SHOWN.includes(col.key) || all.some((c) => (c?.[col.key] ?? 0) > 0));
}

/** Box cells for one row — blank instead of 0; a shipment with no BLs says so once. */
function BoxCells({ counts, cols }: { counts: LiveBoxCounts | undefined; cols: typeof BOX_COLS }) {
  if (!counts?.bls) {
    return (
      <td colSpan={cols.length} className="border-r-2! border-r-foreground/25! px-2 py-3 text-center text-xs text-muted-foreground">
        No BLs yet
      </td>
    );
  }
  return (
    <>
      {cols.map((col, i) => {
        const n = counts[col.key] ?? 0;
        return (
          <td
            key={col.key}
            className={cn(
              "px-2 py-3 text-right tabular-nums",
              col.key === "total" ? "font-semibold text-foreground" : "text-foreground",
              i === cols.length - 1 && "border-r-2! border-r-foreground/25! pr-3",
            )}
          >
            {n || ""}
          </td>
        );
      })}
    </>
  );
}

/** BLs in number order, the newest (highest) first; BLs without a number last. */
function byBlNewestFirst(a: Shipment, b: Shipment) {
  const na = Number(a.hblNumber);
  const nb = Number(b.hblNumber);
  const okA = !!a.hblNumber && Number.isFinite(na);
  const okB = !!b.hblNumber && Number.isFinite(nb);
  if (okA && okB) return nb - na;
  if (okA !== okB) return okA ? -1 : 1;
  return (b.hblNumber ?? "").localeCompare(a.hblNumber ?? "");
}

/** "—" until there's a figure (new shipments; expenses are calculated later). */
const money = (n: number | null | undefined) => (n ? AUD.format(n) : "—");

function ShipmentsPage() {
  const [view, setView] = useState<"batches" | "all">("batches");

  const [consolidations, setConsolidations] = useState<Consolidation[]>([]);
  const [waiting, setWaiting] = useState<LiveBoxCounts | null>(null);
  // "All BLs" showing only the BLs waiting for a shipment.
  const [waitingOnly, setWaitingOnly] = useState(false);
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
    fetchShipmentBoard()
      .then((data) => {
        setConsolidations(data.consolidations);
        setWaiting(data.waiting);
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
      if (waitingOnly && !(s.bookingId && s.hblNumber && !s.consolidationId && s.status !== "delivered")) return false;
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
  }, [shipments, query, statusFilter, waitingOnly]).sort(byBlNewestFirst);

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
        <div className="flex flex-wrap gap-2">
          <ShipmentSheetImportDialog
            onImported={() => {
              forgetShipmentList();
              loadBatches();
              loadShipments();
            }}
          />
          <NewShipmentDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            nextNumber={(consolidations.reduce((m, c) => Math.max(m, c.batchNumber), 0) || 0) + 1}
            onCreated={() => loadBatches()}
          />
        </div>
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
          onClick={() => {
            setView("all");
            setWaitingOnly(false);
          }}
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
          waiting={waiting}
          onOpenWaiting={() => {
            setWaitingOnly(true);
            setView("all");
          }}
        />
      ) : (
        <AllShipmentsView
          waitingOnly={waitingOnly}
          onClearWaiting={() => setWaitingOnly(false)}
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
  waiting,
  onOpenWaiting,
}: {
  consolidations: Consolidation[];
  loading: boolean;
  error: string | null;
  unassignedCount: number;
  waiting: LiveBoxCounts | null;
  onOpenWaiting: () => void;
}) {
  // Warehouse logins don't see shipment income/profit.
  const showMoney = getCurrentUser()?.role !== "warehouse";
  const boxCols = visibleBoxCols([waiting, ...consolidations.map((c) => c.liveBoxes)]);
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
      {/* Phones: one tappable card per shipment instead of a wide table. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {waiting && waiting.bls > 0 && (
          <li>
            <button type="button" onClick={onOpenWaiting} className="block w-full rounded-xl border border-warning/40 bg-warning-soft p-4 text-left">
              <span className="text-base font-semibold text-warning-foreground">Not in a shipment yet</span>
              <p className="mt-1 text-sm tabular-nums text-warning-foreground/90">
                {waiting.bls} BLs · {waiting.total} boxes · TC {waiting.tc} · GB {waiting.gb} · OB {waiting.ob}
              </p>
            </button>
          </li>
        )}
        {consolidations.map((c) => (
          <li key={c.id}>
            <Link
              to="/console/shipments/batch/$batchId"
              params={{ batchId: c.id }}
              className="block rounded-xl border bg-card p-4 shadow-xs active:bg-accent/40"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-base font-semibold text-foreground">Shipment {c.batchNumber}</span>
                <span className="text-xs text-muted-foreground">{c.dates.peblEta ? `ETA ${etaDate(c.dates.peblEta)}` : c.label}</span>
              </div>
              <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                {c.liveBoxes?.bls ?? c.importedShipmentCount} BLs · {c.liveBoxes?.total ?? 0} boxes
                {c.liveBoxes ? ` · TC ${c.liveBoxes.tc} · GB ${c.liveBoxes.gb} · OB ${c.liveBoxes.ob}` : ""}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-auto rounded-xl border bg-card shadow-xs md:block">
        <table className="w-full min-w-225 text-left text-sm [&_td]:border-r [&_td]:border-border [&_th]:border-r [&_th]:border-border [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
          <thead className="border-b bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-secondary px-4 py-3 font-medium">Shipment</th>
              <th className="px-3 py-3 font-medium">PE No.</th>
              <th className="px-3 py-3 font-medium">HBL range</th>
              {boxCols.map((col, i) => (
                <th
                  key={col.key}
                  className={cn("px-2 py-3 text-right font-medium", i === boxCols.length - 1 && "border-r-2! border-r-foreground/25! pr-3")}
                  title={col.title}
                >
                  {col.label}
                </th>
              ))}
              {showMoney && <th className="px-3 py-3 text-right font-medium">Income</th>}
              {showMoney && <th className="px-3 py-3 text-right font-medium">Expenses</th>}
              {showMoney && <th className="px-3 py-3 text-right font-medium">Profit</th>}
              <th className="px-3 py-3 font-medium">ETA</th>
            </tr>
          </thead>
          <tbody>
            {/* BLs given at drop-off that aren't in a shipment yet — what's sitting in the warehouse. */}
            {waiting && waiting.bls > 0 && (
              <tr className="cursor-pointer border-t border-border bg-warning-soft/60 hover:bg-warning-soft" onClick={onOpenWaiting}>
                <td className="sticky left-0 z-10 bg-warning-soft px-4 py-3">
                  <span className="font-medium text-warning-foreground">Not in a shipment yet</span>
                  <p className="text-xs text-warning-foreground/80">Click to see them</p>
                </td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3" />
                <BoxCells counts={waiting} cols={boxCols} />
                {showMoney && <td colSpan={3} />}
                <td />
              </tr>
            )}
            {consolidations.map((c) => (
              <tr key={c.id} className="group border-t border-border transition-colors hover:bg-accent/30">
                <td className="sticky left-0 z-10 bg-card px-4 py-3 group-hover:bg-accent">
                  <Link
                    to="/console/shipments/batch/$batchId"
                    params={{ batchId: c.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    Shipment {c.batchNumber}
                  </Link>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </td>
                <td className="px-3 py-3">{c.peNumber || "—"}</td>
                <td className="px-3 py-3 tabular-nums text-muted-foreground">
                  {c.hblRange.from ? `${c.hblRange.from}–${c.hblRange.to}` : "—"}
                </td>
                <BoxCells counts={c.liveBoxes} cols={boxCols} />
                {showMoney && <td className="px-3 py-3 text-right tabular-nums">{money(c.financials.grossIncome)}</td>}
                {showMoney && <td className="px-3 py-3 text-right tabular-nums">{money(c.financials.totalExpenses)}</td>}
                {showMoney && <td className="px-3 py-3 text-right tabular-nums text-success-foreground">{money(c.financials.grossProfit)}</td>}
                <td className="px-3 py-3 text-xs text-muted-foreground">{etaDate(c.dates.peblEta) || "—"}</td>
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
  waitingOnly,
  onClearWaiting,
  shipments,
  totalCount,
  loading,
  error,
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
}: {
  waitingOnly: boolean;
  onClearWaiting: () => void;
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
        {waitingOnly && (
          <button
            type="button"
            onClick={onClearWaiting}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-warning-soft px-3 text-sm font-medium text-warning-foreground hover:bg-warning/20"
          >
            Not in a shipment yet ✕
          </button>
        )}
      </div>
      {waitingOnly && (
        <p className="-mt-3 mb-4 text-xs text-muted-foreground">Open a BL and pick a shipment under “Move to” — any staff member can do it.</p>
      )}



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
        <>
        <ul className="flex flex-col gap-2 md:hidden">
          {shipments.map((s) => (
            <li key={s.id}>
              <Link
                to="/console/shipments/$shipmentId"
                params={{ shipmentId: s.id }}
                className="block rounded-xl border bg-card p-4 shadow-xs active:bg-accent/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold tabular-nums text-foreground">{s.hblNumber || "No BL"}</span>
                  <StatusBadge tone={shipmentStatus(s.status).tone}>{shipmentStatus(s.status).label}</StatusBadge>
                </div>
                <p className="mt-1 text-sm text-foreground">{s.customerName || "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {s.batchNumber ? `Shipment ${s.batchNumber}` : s.shipmentNumber} · {s.boxCount ?? s.totalBoxes ?? "—"} boxes · {s.destination || "?"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-auto rounded-xl border bg-card shadow-xs md:block">
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
        </>
      )}
    </>
  );
}

/**
 * Start a new shipment (container) — e.g. Shipment 59. No customers here:
 * they join it when staff assign their BL and pick this shipment. The
 * number is the next one after the newest shipment (staff can change it).
 */
function NewShipmentDialog({
  open,
  onOpenChange,
  nextNumber,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nextNumber: number;
  onCreated: (batchNumber: number) => void;
}) {
  const [number, setNumber] = useState(String(nextNumber));
  const [peNumber, setPeNumber] = useState("");
  const [departure, setDeparture] = useState("");
  const [arrival, setArrival] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNumber(String(nextNumber));
    setPeNumber("");
    setDeparture("");
    setArrival("");
    setError(null);
  };

  const handleCreate = async () => {
    const n = Number(number);
    if (!Number.isInteger(n) || n < 1) {
      setError("The shipment number must be a whole number, e.g. 59.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createConsolidation({
        batchNumber: n,
        peNumber: peNumber.trim() || null,
        departureDate: departure || null,
        arrivalDate: arrival || null,
      });
      forgetShipmentList();
      notify.success(`Shipment ${created.batchNumber} created`, "Pick it when you assign a customer's BL — they join it then.");
      onOpenChange(false);
      onCreated(created.batchNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the shipment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
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
          <DialogTitle>New shipment</DialogTitle>
          <DialogDescription>
            Start the next container. Customers are added when you assign their BL and choose this shipment.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shipment-number">Shipment number</Label>
              <Input id="shipment-number" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shipment-pe">PE number (optional)</Label>
              <Input id="shipment-pe" value={peNumber} onChange={(e) => setPeNumber(e.target.value)} placeholder="Add later if not known" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shipment-departure">Leaves Sydney (optional)</Label>
              <Input id="shipment-departure" type="date" value={departure} onChange={(e) => setDeparture(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shipment-arrival">Arrives (optional)</Label>
              <Input id="shipment-arrival" type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-xs font-medium text-attention-foreground">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : `Create Shipment ${Number(number) || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
