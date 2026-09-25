import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Star, User, UserCheck, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useConversations } from "@/lib/transco/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/console/leads")({
  component: LeadsPage,
});

type Tier = "lead" | "active" | "loyal";

function tierFor(totalShipments: number | undefined): Tier {
  const n = totalShipments ?? 0;
  if (n >= 2) return "loyal";
  if (n === 1) return "active";
  return "lead";
}

const TIER_LABELS: Record<Tier, string> = {
  lead: "Lead",
  active: "Active",
  loyal: "Loyal",
};

const TIER_BADGE: Record<Tier, string> = {
  lead: "bg-secondary text-muted-foreground",
  active: "bg-primary/15 text-primary",
  loyal: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

function LeadsPage() {
  const { conversations } = useConversations();
  const [filter, setFilter] = useState<Tier | "all">("all");

  const tiered = useMemo(
    () => conversations.map((c) => ({ conversation: c, tier: tierFor(c.totalShipments) })),
    [conversations],
  );

  const counts = useMemo(() => {
    const c = { lead: 0, active: 0, loyal: 0 };
    for (const t of tiered) c[t.tier]++;
    return c;
  }, [tiered]);

  const visible = filter === "all" ? tiered : tiered.filter((t) => t.tier === filter);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" />
          Leads
        </h1>
        <p className="text-sm text-muted-foreground">
          Every contact, tiered by real shipment count — who's never converted, who's shipped once,
          and who's a repeat customer worth prioritizing.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TierCard
          icon={User}
          label="Lead"
          sublabel="0 shipments — never converted"
          count={counts.lead}
          active={filter === "lead"}
          onClick={() => setFilter(filter === "lead" ? "all" : "lead")}
        />
        <TierCard
          icon={UserCheck}
          label="Active"
          sublabel="1 shipment"
          count={counts.active}
          active={filter === "active"}
          onClick={() => setFilter(filter === "active" ? "all" : "active")}
        />
        <TierCard
          icon={Star}
          label="Loyal"
          sublabel="2+ shipments — repeat customer"
          count={counts.loyal}
          active={filter === "loyal"}
          onClick={() => setFilter(filter === "loyal" ? "all" : "loyal")}
          highlight
        />
      </div>

      {filter !== "all" && (
        <button
          type="button"
          onClick={() => setFilter("all")}
          className="mb-3 text-xs text-primary hover:underline"
        >
          Clear filter — showing all {conversations.length}
        </button>
      )}

      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 text-right font-medium">Shipments</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ conversation: c, tier }) => (
              <tr key={c.id} className="border-t border-border hover:bg-secondary/30">
                <td className="px-3 py-2">
                  <Link
                    to="/console/customers/$customerId"
                    params={{ customerId: c.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    {c.customerName}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{c.phoneNumber}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.totalShipments ?? 0}</td>
                <td className="px-3 py-2">
                  <Badge className={cn("font-medium", TIER_BADGE[tier])} variant="secondary">
                    {TIER_LABELS[tier]}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs capitalize text-muted-foreground">
                  {c.sources?.join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TierCard({
  icon: Icon,
  label,
  sublabel,
  count,
  active,
  onClick,
  highlight,
}: {
  icon: typeof User;
  label: string;
  sublabel: string;
  count: number;
  active: boolean;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-4 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border bg-panel hover:border-primary/40",
      )}
    >
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-md",
          highlight
            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-2xl font-semibold tabular-nums text-foreground">{count}</p>
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{sublabel}</p>
      </div>
    </button>
  );
}
