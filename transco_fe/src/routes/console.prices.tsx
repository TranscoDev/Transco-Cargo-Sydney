import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BadgePercent, History, Lock, Plus, Tags, Trash2 } from "lucide-react";

import { PageHeader, PageShell } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/transco/money-input";
import {
  fetchPriceHistory,
  fetchPriceSettings,
  restorePriceVersion,
  savePriceSettings,
  type AgentKnowledgeVersion,
  type PriceSettings,
  type Promotion,
} from "@/lib/transco/api";
import { cn } from "@/lib/utils";

// The prices the chat bot quotes with and the promotions it applies
// (prices.js). Admins edit; everyone with the page can view.
export const Route = createFileRoute("/console/prices")({
  component: PricesPage,
});

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }) : "";

const TYPE_LABEL: Record<Promotion["type"], string> = {
  percent: "% off",
  amount: "$ off the order",
  special_price: "Special price per box",
  free_third: "Every 3rd Tea Chest free",
};
const ON_LABEL: Record<Promotion["appliesTo"], string> = {
  freight: "Freight only",
  freight_delivery: "Freight + delivery",
  order: "Whole order",
};
const ITEMS_LABEL: Record<Promotion["items"], string> = {
  tea_chest: "Tea Chests",
  all_boxes: "All boxes",
  tv: "TVs",
  any: "Everything",
};
const MODE_LABEL: Record<Promotion["mode"], string> = { sea: "Sea freight", air: "Air freight", any: "Sea and air" };
const COUNTRY_LABEL: Record<Promotion["country"], string> = { sri_lanka: "Sri Lanka", india: "India", any: "Sri Lanka and India" };

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60";

const newPromotion = (): Promotion => ({
  id: "",
  name: "",
  enabled: true,
  type: "percent",
  value: 10,
  appliesTo: "freight",
  items: "tea_chest",
  mode: "sea",
  country: "sri_lanka",
  minBoxes: 1,
  startsOn: "",
  endsOn: "",
  message: { en: "", si: "", ta: "" },
});

function PricesPage() {
  const [data, setData] = useState<PriceSettings | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const apply = (d: PriceSettings) => {
    setData(d);
    setValues(Object.fromEntries(d.prices.map((p) => [p.key, String(p.value)])));
    setPromotions(d.promotions.map((p) => ({ ...p, message: { en: p.message?.en ?? "", si: p.message?.si ?? "", ta: p.message?.ta ?? "" } })));
  };

  useEffect(() => {
    fetchPriceSettings()
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load prices"));
  }, []);

  const canEdit = !!data?.isAdmin;

  const changed = useMemo(() => {
    if (!data) return false;
    const strip = (list: Promotion[]) => JSON.stringify(list.map(({ active, ...p }) => p));
    return data.prices.some((p) => Number(values[p.key]) !== p.value) || strip(data.promotions) !== strip(promotions);
  }, [data, values, promotions]);

  const groups = useMemo(() => {
    const map = new Map<string, PriceSettings["prices"]>();
    for (const p of data?.prices ?? []) map.set(p.group, [...(map.get(p.group) ?? []), p]);
    return [...map.entries()];
  }, [data]);

  const updatePromo = (i: number, patch: Partial<Promotion>) => {
    setPromotions((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    setSuccess(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      apply(await savePriceSettings({ values, promotions: promotions.map(({ active, ...p }) => p) }));
      setSuccess("Saved. The bot quotes with these from the next message.");
      setHistoryKey((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const restore = async (v: AgentKnowledgeVersion) => {
    if (!window.confirm(`Put back the prices saved ${when(v.updatedAt) || "originally"}? The current ones are kept in the history.`)) return;
    setError(null);
    try {
      apply(await restorePriceVersion(v.id));
      setSuccess("Earlier prices put back. The bot uses them from the next message.");
      setHistoryKey((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore");
    }
  };

  return (
    <PageShell>
      <PageHeader
        icon={BadgePercent}
        title="Prices & Promotions"
        description="The prices the chat bot quotes, and the offers it applies. Changes reach WhatsApp and the website chat from the next message."
      />

      <div className="mb-6 rounded-xl border bg-secondary/40 p-4 text-sm text-muted-foreground">
        <p className="mb-1.5 font-medium text-foreground">💡 How it works</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>The bot works out every quote from these prices — box freight, door delivery by zone, TVs, air and India.</li>
          <li>A running promotion shows under the quote as a discount line and a new total. Only the one that saves the customer most applies.</li>
          <li>Home pickup in Sydney is never priced by the bot — the pickup contact confirms it.</li>
          {!canEdit && (
            <li className="font-medium text-foreground">
              <Lock className="mr-1 inline h-3 w-3" />
              Only an admin can change prices and promotions.
            </li>
          )}
        </ul>
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Tags className="h-4 w-4" /> Prices (AUD)
              </CardTitle>
              <p className="text-sm text-muted-foreground">3 Tea Chests and door-delivery totals are worked out from these.</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 p-5 pt-2">
              {groups.map(([group, items]) => (
                <div key={group} className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                  {items.map((p) => (
                    <label key={p.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-foreground">{p.label}</span>
                      <span className="flex items-center gap-1">
                        <MoneyInput
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="1"
                          className="h-8 w-24 text-right"
                          disabled={!canEdit}
                          value={values[p.key] ?? ""}
                          onChange={(e) => {
                            setValues((v) => ({ ...v, [p.key]: e.target.value }));
                            setSuccess(null);
                          }}
                        />
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-5 pb-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BadgePercent className="h-4 w-4" /> Promotions
                  </CardTitle>
                  <p className="mt-0.5 text-sm text-muted-foreground">Start and end dates switch them on and off by themselves.</p>
                </div>
                {canEdit && (
                  <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setPromotions((l) => [...l, newPromotion()])}>
                    <Plus className="h-3.5 w-3.5" /> Add promotion
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-4 p-5 pt-2">
                {promotions.length === 0 && <p className="text-sm text-muted-foreground">No promotions. Add one to show an offer in the bot's quotes.</p>}
                {promotions.map((p, i) => (
                  <PromotionEditor
                    key={p.id || `new-${i}`}
                    promo={p}
                    disabled={!canEdit}
                    onChange={(patch) => updatePromo(i, patch)}
                    onRemove={() => {
                      if (window.confirm(`Remove "${p.name || "this promotion"}"?`)) setPromotions((l) => l.filter((_, j) => j !== i));
                    }}
                  />
                ))}
              </CardContent>
            </Card>
            <HistoryCard key={historyKey} canEdit={canEdit} onRestore={restore} />
          </div>
        </div>
      )}

      {data && canEdit && (
        <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur">
          <Button type="button" disabled={saving || !changed} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {changed && (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => apply(data)}>
              Cancel
            </Button>
          )}
          {error && <span className="text-sm text-destructive">{error}</span>}
          {success && <span className="text-sm text-success-foreground">{success}</span>}
          {!error && !success && data.updatedAt && (
            <span className="text-xs text-muted-foreground">
              Last saved {when(data.updatedAt)}
              {data.updatedBy ? ` by ${data.updatedBy}` : ""}
            </span>
          )}
        </div>
      )}
    </PageShell>
  );
}

/** "$" in the box for prices and dollar discounts, not for a percent. */
function PromoValueInput({ percent, ...props }: { percent: boolean } & React.ComponentProps<typeof Input>) {
  return percent ? <Input {...props} /> : <MoneyInput {...props} />;
}

function PromotionEditor({
  promo: p,
  disabled,
  onChange,
  onRemove,
}: {
  promo: Promotion;
  disabled: boolean;
  onChange: (patch: Partial<Promotion>) => void;
  onRemove: () => void;
}) {
  const freeThird = p.type === "free_third";
  const status = !p.enabled ? "Off" : p.active === false ? "Not running today" : p.active ? "Running" : "Not saved yet";
  return (
    <div className={cn("rounded-xl border p-4", p.enabled ? "bg-card" : "bg-secondary/40")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={p.name}
          disabled={disabled}
          maxLength={80}
          placeholder="Name, e.g. Christmas Tea Chest offer"
          className="h-9 min-w-48 flex-1 font-medium"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            status === "Running" ? "bg-success-soft text-success-foreground" : "bg-secondary text-muted-foreground",
          )}
        >
          {status}
        </span>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={p.enabled} disabled={disabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          On
        </label>
        {!disabled && (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={onRemove} aria-label="Remove promotion">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Type">
          <select
            className={selectClass}
            disabled={disabled}
            value={p.type}
            onChange={(e) => {
              const type = e.target.value as Promotion["type"];
              onChange(type === "free_third" ? { type, items: "tea_chest", mode: "sea", country: "sri_lanka", appliesTo: "freight" } : { type });
            }}
          >
            {(Object.keys(TYPE_LABEL) as Promotion["type"][]).map((k) => (
              <option key={k} value={k}>
                {TYPE_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {!freeThird && (
          <Field label={p.type === "percent" ? "Discount (%)" : p.type === "amount" ? "Discount" : "Price per box"}>
            <PromoValueInput percent={p.type === "percent"} type="number" min={0} disabled={disabled} value={p.value} className="h-9" onChange={(e) => onChange({ value: Number(e.target.value) })} />
          </Field>
        )}
        {!freeThird && (
          <Field label="Discount on">
            <select className={selectClass} disabled={disabled || p.type === "special_price"} value={p.appliesTo} onChange={(e) => onChange({ appliesTo: e.target.value as Promotion["appliesTo"] })}>
              {(Object.keys(ON_LABEL) as Promotion["appliesTo"][]).map((k) => (
                <option key={k} value={k}>
                  {ON_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!freeThird && (
          <Field label="For">
            <select className={selectClass} disabled={disabled} value={p.items} onChange={(e) => onChange({ items: e.target.value as Promotion["items"] })}>
              {(Object.keys(ITEMS_LABEL) as Promotion["items"][]).map((k) => (
                <option key={k} value={k}>
                  {ITEMS_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!freeThird && (
          <Field label="Freight">
            <select className={selectClass} disabled={disabled} value={p.mode} onChange={(e) => onChange({ mode: e.target.value as Promotion["mode"] })}>
              {(Object.keys(MODE_LABEL) as Promotion["mode"][]).map((k) => (
                <option key={k} value={k}>
                  {MODE_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!freeThird && (
          <Field label="Country">
            <select className={selectClass} disabled={disabled} value={p.country} onChange={(e) => onChange({ country: e.target.value as Promotion["country"] })}>
              {(Object.keys(COUNTRY_LABEL) as Promotion["country"][]).map((k) => (
                <option key={k} value={k}>
                  {COUNTRY_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!freeThird && (
          <Field label="Minimum boxes">
            <Input type="number" min={1} disabled={disabled} value={p.minBoxes} className="h-9" onChange={(e) => onChange({ minBoxes: Number(e.target.value) })} />
          </Field>
        )}
        <Field label="Starts (empty = now)">
          <Input type="date" disabled={disabled} value={p.startsOn} className="h-9" onChange={(e) => onChange({ startsOn: e.target.value })} />
        </Field>
        <Field label="Ends (empty = no end)">
          <Input type="date" disabled={disabled} value={p.endsOn} className="h-9" onChange={(e) => onChange({ endsOn: e.target.value })} />
        </Field>
      </div>
      {freeThird && (
        <p className="mt-2 text-xs text-muted-foreground">Tea Chests, Sea Freight to Sri Lanka, same receiver on one Bill of Lading — the 3rd, 6th, 9th… box's freight is free.</p>
      )}

      <div className="mt-3 grid gap-2">
        <p className="text-xs font-medium text-muted-foreground">Message for customers (the bot's "any offers?" reply)</p>
        {(["en", "si", "ta"] as const).map((k) => (
          <Input
            key={k}
            value={p.message[k]}
            disabled={disabled}
            maxLength={300}
            className="h-9 text-sm"
            placeholder={k === "en" ? "English (required)" : k === "si" ? "Sinhala (optional — English is used if empty)" : "Tamil (optional — English is used if empty)"}
            onChange={(e) => onChange({ message: { ...p.message, [k]: e.target.value } })}
          />
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function HistoryCard({ canEdit, onRestore }: { canEdit: boolean; onRestore: (v: AgentKnowledgeVersion) => void }) {
  const [versions, setVersions] = useState<AgentKnowledgeVersion[] | null>(null);

  useEffect(() => {
    fetchPriceHistory()
      .then(setVersions)
      .catch(() => setVersions([]));
  }, []);

  return (
    <Card>
      <CardHeader className="p-5 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Earlier versions
        </CardTitle>
        <p className="text-sm text-muted-foreground">Every save is kept. Made a mistake? Put an earlier version back.</p>
      </CardHeader>
      <CardContent className="p-5 pt-2">
        {!versions ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No earlier versions yet.</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {v.updatedAt ? when(v.updatedAt) : "Original prices"}
                  {v.updatedBy && <span className="text-muted-foreground"> · {v.updatedBy}</span>}
                </span>
                {canEdit && (
                  <Button type="button" variant="outline" size="sm" onClick={() => onRestore(v)}>
                    Put back
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
