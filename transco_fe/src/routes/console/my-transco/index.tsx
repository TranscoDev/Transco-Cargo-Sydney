import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarPlus,
  FileWarning,
  Lock,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldQuestion,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  fetchPortalAccounts,
  formatDate,
  formatPhone,
  SOURCE_LABELS,
  type PortalAccountRow,
  type PortalAccountStats,
} from "@/lib/transco/my-transco";

export const Route = createFileRoute("/console/my-transco/")({
  component: MyTranscoAccountsPage,
});

type Filter = "all" | "unverified" | "needsDeclaration" | "withBookings" | "fromQr" | "locked" | "newThisWeek";

const FILTERS: { key: Filter; label: string; test: (c: PortalAccountRow) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "newThisWeek", label: "Joined this week", test: (c) => !!c.joinedAt && Date.now() - new Date(c.joinedAt).getTime() < 7 * 86400000 },
  { key: "needsDeclaration", label: "Needs declaration", test: (c) => c.bookings.needsDeclaration > 0 },
  { key: "unverified", label: "Number not verified", test: (c) => !c.phoneVerified },
  { key: "withBookings", label: "Has bookings", test: (c) => c.bookings.total > 0 },
  { key: "fromQr", label: "From warehouse QR", test: (c) => c.source === "warehouse_qr" },
  { key: "locked", label: "Locked out", test: (c) => c.locked },
];

function MyTranscoAccountsPage() {
  const [data, setData] = useState<{ stats: PortalAccountStats; customers: PortalAccountRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchPortalAccounts()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load accounts"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return data.customers.filter((c) => {
      if (!test(c)) return false;
      if (!q) return true;
      return (
        (c.name || "").toLowerCase().includes(q) ||
        (c.customerCode || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (qDigits.length >= 3 && c.phoneNumber.includes(qDigits.replace(/^0/, "")))
      );
    });
  }, [data, query, filter]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <UserRound className="h-4 w-4 text-muted-foreground" />
            My Transco accounts
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Customers who have an online account on the Transco website — their details, sign-in
            status, bookings and BLs. Open a customer to manage their account and bookings.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
          <button type="button" onClick={load} className="ml-auto underline">
            Try again
          </button>
        </div>
      )}

      {data && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard icon={UserRound} label="Accounts" value={data.stats.accounts} onClick={() => setFilter("all")} active={filter === "all"} />
          <StatCard icon={CalendarPlus} label="Joined this week" value={data.stats.joinedThisWeek} onClick={() => setFilter("newThisWeek")} active={filter === "newThisWeek"} />
          <StatCard
            icon={FileWarning}
            label="Needs declaration"
            value={data.stats.needsDeclaration}
            onClick={() => setFilter("needsDeclaration")}
            active={filter === "needsDeclaration"}
            highlight={data.stats.needsDeclaration > 0}
          />
          <StatCard icon={ShieldQuestion} label="Number not verified" value={data.stats.unverified} onClick={() => setFilter("unverified")} active={filter === "unverified"} />
          <StatCard icon={QrCode} label="From warehouse QR" value={data.stats.fromQr} onClick={() => setFilter("fromQr")} active={filter === "fromQr"} />
          <StatCard
            icon={Lock}
            label="Locked out"
            value={data.stats.locked}
            onClick={() => setFilter("locked")}
            active={filter === "locked"}
            highlight={data.stats.locked > 0}
          />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, email or CUS number"
            aria-label="Search accounts"
            className="h-9 w-full rounded-md border border-input bg-secondary/60 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:bg-panel"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                filter === f.key ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading accounts…</p>
      ) : data && data.customers.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No online accounts yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            When customers create a My Transco account on the website, they'll appear here.
          </p>
        </div>
      ) : data ? (
        <div className="overflow-auto rounded-md border border-border bg-panel">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 text-right font-medium">Bookings</th>
                <th className="px-3 py-2 text-right font-medium">BLs</th>
                <th className="px-3 py-2 font-medium">Joined</th>
                <th className="px-3 py-2 font-medium">Last sign-in</th>
                <th className="px-3 py-2 font-medium">Came from</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No accounts match this search or filter.
                  </td>
                </tr>
              )}
              {visible.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-secondary/30">
                  <td className="px-3 py-2">
                    <Link
                      to="/console/my-transco/$customerId"
                      params={{ customerId: c.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.name || "(no name yet)"}
                    </Link>
                    <div className="text-[11px] tabular-nums text-muted-foreground">{c.customerCode || "—"}</div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatPhone(c.phoneNumber)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.phoneVerified ? (
                        <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          <ShieldCheck className="mr-1 h-3 w-3" /> Verified
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                          <ShieldQuestion className="mr-1 h-3 w-3" /> Not verified
                        </Badge>
                      )}
                      {c.hasPassword && <Badge variant="secondary">Password</Badge>}
                      {c.locked && (
                        <Badge variant="secondary" className="bg-destructive/15 text-destructive">
                          <Lock className="mr-1 h-3 w-3" /> Locked
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.bookings.total}
                    {c.bookings.open > 0 && <span className="text-[11px] text-muted-foreground"> ({c.bookings.open} open)</span>}
                    {c.bookings.needsDeclaration > 0 && (
                      <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        {c.bookings.needsDeclaration} need declaration
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.shipments.withBl}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(c.joinedAt)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(c.lastSignInAt, true)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{c.source ? SOURCE_LABELS[c.source] ?? c.source : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  onClick,
  active,
  highlight,
}: {
  icon: typeof UserRound;
  label: string;
  value: number;
  onClick: () => void;
  active: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border bg-panel px-3 py-3 text-left transition-colors hover:border-primary/40",
        active ? "border-primary ring-1 ring-primary/30" : "border-border",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", highlight ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
        {value}
      </div>
    </button>
  );
}
