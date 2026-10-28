import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Download, Landmark, RefreshCw, SlidersHorizontal } from "lucide-react";

import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import {
  downloadFinanceXlsx,
  fetchFinanceSheet,
  fetchFinanceShipments,
  type FinanceRow,
  type FinanceSheet,
  type FinanceShipmentSummary,
} from "@/lib/transco/api";
import { notify } from "@/lib/transco/notify";
import { cn } from "@/lib/utils";

// Finance → Shipments: the shipment money sheet staff used to fill by hand,
// one row per BL, read live from each BL's costing sheet (backend finance.js).
// Nothing is typed here — fix a row on its booking's costing sheet.
type FinanceSearch = { shipment?: string };

export const Route = createFileRoute("/console/finance/")({
  validateSearch: (search: Record<string, unknown>): FinanceSearch =>
    typeof search["shipment"] === "string" && search["shipment"] ? { shipment: search["shipment"] } : {},
  component: FinancePage,
});

const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n: number | null | undefined) => (n ? AUD.format(n) : "");

const selectClass = "h-9 rounded-md border border-input bg-card px-2 text-sm";

function FinancePage() {
  const { shipment: wanted } = Route.useSearch();
  const navigate = useNavigate({ from: "/console/finance/" });
  const [list, setList] = useState<FinanceShipmentSummary[] | null>(null);
  const [sheet, setSheet] = useState<FinanceSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetchFinanceShipments()
      .then(setList)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the shipments"));
  }, []);

  // The newest shipment unless one was picked.
  const selectedId = wanted ?? list?.[0]?.id;
  const selected = list?.find((s) => s.id === selectedId) ?? null;

  const load = useCallback(() => {
    if (!selectedId) return;
    setLoading(true);
    fetchFinanceSheet(selectedId)
      .then((s) => {
        setSheet(s);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the finance sheet"))
      .finally(() => setLoading(false));
  }, [selectedId]);

  useEffect(load, [load]);
  // Costing sheets change in other tabs — show the latest when staff come back.
  useEffect(() => {
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const download = async () => {
    if (!sheet) return;
    setDownloading(true);
    try {
      await downloadFinanceXlsx(sheet.shipment.id, sheet.shipment.batchNumber);
    } catch (err) {
      notify.error("Couldn't make the Excel file", err instanceof Error ? err.message : undefined);
    } finally {
      setDownloading(false);
    }
  };

  // Fits the window: only the table scrolls (one up-down scrollbar, and the
  // sideways one always at the bottom of the screen).
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background px-4 py-5 md:px-8 md:py-7">
      <PageHeader
        icon={Landmark}
        title="Finance"
        description="Each shipment's money, one row per BL — read live from the costing sheets. To change a row, edit that BL's costing sheet."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {list && list.length > 0 && (
              <select
                aria-label="Shipment"
                className={selectClass}
                value={selectedId ?? ""}
                onChange={(e) => navigate({ search: { shipment: e.target.value } })}
              >
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    Shipment {s.batchNumber} · {s.hbls} BL{s.hbls === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            )}
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={!selectedId || loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button type="button" size="sm" className="gap-1.5" onClick={download} disabled={!sheet || !sheet.rows.length || downloading}>
              <Download className="h-3.5 w-3.5" />
              {downloading ? "Making Excel…" : "Download Excel"}
            </Button>
            <Button asChild type="button" variant="ghost" size="sm" className="gap-1.5">
              <Link to="/console/finance/rates">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Cost rates
              </Link>
            </Button>
          </div>
        }
      />

      {error && <ErrorState description={error} onRetry={load} compact />}
      {!error && (!list || (selectedId && !sheet)) && <LoadingRows rows={5} />}
      {list && list.length === 0 && <EmptyState icon={Landmark} title="No shipments yet" description="Make a shipment in Shipments first." />}

      {sheet && selected && sheet.shipment.id === selected.id && (
        <>
          <Summary sheet={sheet} />
          {sheet.rows.length === 0 ? (
            <EmptyState icon={Landmark} title={`No BLs in Shipment ${sheet.shipment.batchNumber} yet`} compact />
          ) : (
            <FinanceTable sheet={sheet} />
          )}
        </>
      )}
    </div>
  );
}

function Summary({ sheet }: { sheet: FinanceSheet }) {
  const t = sheet.totals;
  const notes = [
    t.noCosting ? `${t.noCosting} BL${t.noCosting === 1 ? " has" : "s have"} no costing sheet` : null,
    t.unpaid ? `${t.unpaid} not fully paid (${AUD.format(t.owing)} to collect)` : null,
    t.toCheck ? `${t.toCheck} to check` : null,
  ].filter(Boolean);
  return (
    <div className="mb-4 flex shrink-0 flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Income" value={AUD.format(t.income)} />
        <Tile label="Expense" value={AUD.format(t.expense)} />
        <Tile label="Gross profit" value={AUD.format(t.profit)} tone={t.profit < 0 ? "bad" : "good"} />
        <Tile
          label="Paid so far"
          value={AUD.format(t.paidTotal)}
          hint={sheet.payColumns
            .filter((c) => t.paid[c.key])
            .map((c) => `${c.label} ${AUD.format(t.paid[c.key])}`)
            .join(" · ")}
        />
      </div>
      {notes.length > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {notes.join(" · ")} — highlighted below.
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className={cn("rounded-xl border bg-card p-4 shadow-xs", tone === "good" && "bg-success-soft", tone === "bad" && "bg-attention-soft")}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums text-foreground",
          tone === "good" && "text-success-foreground",
          tone === "bad" && "text-attention-foreground",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Column groups coloured like the hand-made sheet.
const GROUP = {
  boxes: "bg-violet-100/70 dark:bg-violet-500/10",
  paid: "bg-emerald-100/70 dark:bg-emerald-500/10",
  income: "bg-emerald-200/80 dark:bg-emerald-500/20",
  costs: "bg-rose-100/70 dark:bg-rose-500/10",
  result: "bg-emerald-200/80 dark:bg-emerald-500/20",
};

function FinanceTable({ sheet }: { sheet: FinanceSheet }) {
  const t = sheet.totals;
  const th = "whitespace-nowrap border-b px-2.5 py-2 text-right text-xs font-semibold text-foreground";
  const td = "whitespace-nowrap px-2.5 py-2 text-right tabular-nums";
  return (
    // Takes the rest of the window and scrolls both ways inside it.
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border bg-card shadow-xs">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            <th className={cn(th, "sticky left-0 z-20 bg-card text-left")}>BL</th>
            <th className={cn(th, "text-left")}>Date</th>
            <th className={cn(th, "text-left")}>Door delivery</th>
            {sheet.boxColumns.map((c) => (
              <th key={c.key} className={cn(th, GROUP.boxes)}>
                {c.label}
              </th>
            ))}
            <th className={cn(th, GROUP.boxes)}>CBM</th>
            <th className={cn(th, GROUP.boxes)}>Boxes</th>
            {sheet.payColumns.map((c) => (
              <th key={c.key} className={cn(th, GROUP.paid)}>
                {c.label}
              </th>
            ))}
            <th className={cn(th, GROUP.income)}>Income</th>
            {sheet.costColumns.map((c) => (
              <th key={c.key} className={cn(th, GROUP.costs)}>
                {c.label}
              </th>
            ))}
            <th className={cn(th, GROUP.result)}>Expense</th>
            <th className={cn(th, GROUP.result)}>Gross profit</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((r) => (
            <Row key={r.shipmentId} r={r} sheet={sheet} td={td} />
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-10 bg-card">
          <tr className="border-t-2 font-semibold">
            <td className={cn(td, "sticky left-0 bg-card text-left")}>Total</td>
            <td className={td} />
            <td className={td} />
            {sheet.boxColumns.map((c) => (
              <td key={c.key} className={td}>
                {t.counts[c.key] || ""}
              </td>
            ))}
            <td className={td}>{t.cbm || ""}</td>
            <td className={td}>{t.boxes || ""}</td>
            {sheet.payColumns.map((c) => (
              <td key={c.key} className={td}>
                {money(t.paid[c.key])}
              </td>
            ))}
            <td className={td}>{AUD.format(t.income)}</td>
            {sheet.costColumns.map((c) => (
              <td key={c.key} className={td}>
                {money(t.costs[c.key])}
              </td>
            ))}
            <td className={td}>{AUD.format(t.expense)}</td>
            <td className={td}>{AUD.format(t.profit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Row({ r, sheet, td }: { r: FinanceRow; sheet: FinanceSheet; td: string }) {
  const flagged = r.source === "none" || r.owing > 0 || r.checks.length > 0;
  const why = [
    r.source === "none" ? "No costing sheet yet" : null,
    r.owing > 0 ? `${AUD.format(r.owing)} still to pay` : null,
    ...r.checks,
  ].filter(Boolean);
  return (
    <tr className={cn("border-t border-border hover:bg-secondary/30", flagged && "bg-attention-soft/50")}>
      <td className={cn(td, "sticky left-0 bg-card text-left font-semibold", flagged && "bg-attention-soft")}>
        {r.bookingId ? (
          <Link to="/console/bookings/$bookingId" params={{ bookingId: r.bookingId }} className="text-primary hover:underline">
            {r.hbl}
          </Link>
        ) : (
          r.hbl
        )}
        {why.length > 0 && <p className="text-[11px] font-normal text-attention-foreground">{why.join(" · ")}</p>}
      </td>
      <td className={cn(td, "text-left text-muted-foreground")}>{r.date}</td>
      <td className={cn(td, "text-left")}>{r.destination}</td>
      {sheet.boxColumns.map((c) => (
        <td key={c.key} className={td}>
          {r.counts[c.key] || ""}
        </td>
      ))}
      <td className={td}>{r.cbm ?? ""}</td>
      <td className={td}>{r.boxes || ""}</td>
      {sheet.payColumns.map((c) => (
        <td key={c.key} className={td}>
          {money(r.paid[c.key])}
        </td>
      ))}
      <td className={cn(td, "font-semibold")}>{money(r.income)}</td>
      {sheet.costColumns.map((c) => (
        <td key={c.key} className={td}>
          {money(r.costs[c.key])}
        </td>
      ))}
      <td className={td}>{money(r.expense)}</td>
      <td className={cn(td, "font-semibold", r.profit < 0 && "text-destructive")}>{r.source === "none" ? "" : AUD.format(r.profit)}</td>
    </tr>
  );
}
