import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/transco/money-input";
import { Label } from "@/components/ui/label";
import { saveCosting, type DeclarationPrintData, type PaymentMethod } from "@/lib/transco/declaration-print";
import { formatDate } from "@/lib/transco/my-transco";
import { friendlyError, notify } from "@/lib/transco/notify";

// The bot's rates (other/Flowise/calculate_price_LATEST.js) — the same ones
// the customer's booking page shows. Only a starting point: staff change
// any amount before saving.
const SL_SEA = { tea_chest: 75, gift_box: 45, wine_box: 30, quarter_cbm: 150 } as Record<string, number>;
const TV_BANDS: Record<string, { label: string; price: number }> = {
  upto35: { label: 'up to 35"', price: 140 },
  "36to45": { label: '36–45"', price: 220 },
  "46to55": { label: '46–55"', price: 300 },
  "60to65": { label: '60–65"', price: 350 },
  "66to75": { label: '66–75"', price: 400 },
};
const INDIA_SEA: Record<string, [number, number, number]> = {
  general: [400, 600, 800],
  tea_chest: [600, 900, 1200],
  quarter_cbm: [600, 900, 1200],
};

export const tvSizeLabel = (s: string) => TV_BANDS[s]?.label ?? "other size";

// Odd-size items: $550 per cubic metre (Sri Lanka Sea).
const ODD_TO_MEASURE = "Odd-size item (to measure)";
const oddLabel = (l: number, w: number, h: number) => `Odd-size item ${l}×${w}×${h} cm`;
export const oddPrice = (l: number, w: number, h: number) => String(Math.ceil(((l * w * h) / 1e6) * 550));

// ---------- line types (the dropdown) ----------

const KIND_NAME: Record<string, string> = {
  tea_chest: "Tea Chest",
  gift_box: "Gift Box",
  wine_box: "Wine Box",
  quarter_cbm: "Quarter CBM box",
  general: "General cargo box",
  ...Object.fromEntries(Object.entries(TV_BANDS).map(([k, b]) => [`tv_${k}`, `TV ${b.label}`])),
  tv: "TV (size to check)",
  odd: "Odd-size item",
  door: "Door delivery",
  pickup: "Home pickup",
  extra_boxes: "Extra empty boxes",
  other: "Other",
};
const BOX_KINDS: Record<string, string[]> = {
  sri_lanka: ["tea_chest", "gift_box", "wine_box", "quarter_cbm", ...Object.keys(TV_BANDS).map((k) => `tv_${k}`), "tv", "odd"],
  india: ["general", "tea_chest", "quarter_cbm", "odd"],
};
const EXTRA_KINDS = ["door", "pickup", "extra_boxes", "other"];
const isBoxKind = (k: string) => k in KIND_NAME && !EXTRA_KINDS.includes(k);
// These need a name typed in (what "Other" is; an odd-size item's size).
const needsName = (k: string) => k === "other" || k === "odd";

type Line = { kind: string; label: string; qty: string; amount: string };

// Paid by — the Finance page's payment columns.
const PAY_METHOD_NAME: Record<PaymentMethod, string> = {
  cash: "Cash",
  zeller: "Zeller",
  eftpos: "EFTPOS",
  bank: "DD / Bank transfer",
  other: "Other",
};
type Pay = { method: PaymentMethod; amount: string };

/** The bot's price for this many of a box type, or null (staff fill it in). */
function priceFor(kind: string, qty: number, d: DeclarationPrintData): number | null {
  if (d.serviceKey !== "sea" || !Number.isInteger(qty) || qty < 1) return null;
  if (d.countryKey === "india") {
    const p = INDIA_SEA[kind];
    if (!p) return null;
    return qty === 1 ? p[0] : qty === 2 ? p[1] : p[2] + (qty - 3) * (p[2] - p[1]);
  }
  if (kind === "tea_chest") {
    let t = 0;
    for (let n = 1; n <= qty; n++) t += n % 3 === 0 ? 0 : 75;
    return t;
  }
  if (SL_SEA[kind] !== undefined) return (SL_SEA[kind] ?? 0) * qty;
  const band = kind.startsWith("tv_") ? TV_BANDS[kind.slice(3)] : undefined;
  return band ? band.price * qty : null;
}

function labelFor(l: Line, d: DeclarationPrintData): string {
  if (needsName(l.kind) || !KIND_NAME[l.kind]) return l.label.trim();
  const free = l.kind === "tea_chest" && d.serviceKey === "sea" && d.countryKey !== "india" && Number(l.qty) >= 3;
  return KIND_NAME[l.kind] + (free ? " (every 3rd free)" : "");
}

/** Box lines (type + how many) from the booking's boxes, priced at the bot's rates. */
function boxLines(items: DeclarationPrintData["items"], d: DeclarationPrintData): Line[] {
  const lines: Line[] = [];
  const line = (kind: string, qty: number): Line => {
    const p = priceFor(kind, qty, d);
    return { kind, label: "", qty: String(qty), amount: p === null ? "" : String(p) };
  };
  for (const i of items) {
    if (i.qty < 1) continue;
    if (i.type === "tv") {
      // One line per screen size when every TV's size is known.
      if (i.sizes && i.sizes.length === i.qty && i.sizes.every((s) => TV_BANDS[s])) {
        const counts = new Map<string, number>();
        i.sizes.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
        counts.forEach((n, s) => lines.push(line(`tv_${s}`, n)));
      } else lines.push(line("tv", i.qty));
    } else if (i.type === "other") {
      (i.dims ?? []).forEach((m) => lines.push({ kind: "odd", label: oddLabel(m.l, m.w, m.h), qty: "1", amount: d.serviceKey === "sea" ? oddPrice(m.l, m.w, m.h) : "" }));
      // The customer only gives a count — one line each for staff to measure.
      for (let n = (i.dims ?? []).length; n < i.qty; n++) lines.push({ kind: "odd", label: ODD_TO_MEASURE, qty: "1", amount: "" });
    } else lines.push(line(i.type, i.qty));
  }
  return lines;
}

/** Suggested cost lines for a booking with no saved costing. */
function suggestedLines(items: DeclarationPrintData["items"], d: DeclarationPrintData): Line[] {
  const lines = boxLines(items, d);
  if (d.handover === "pickup") lines.push({ kind: "pickup", label: "", qty: "1", amount: "" });
  if (d.deliveryKey === "door") lines.push({ kind: "door", label: "", qty: "1", amount: "" });
  return lines;
}

/** A saved line → a row. Older lines ("3 × Tea Chest") had no type or count. */
function fromSaved(l: { label: string; amount: number; kind?: string; qty?: number }): Line {
  if (l.kind) return { kind: l.kind, label: needsName(l.kind) ? l.label : "", qty: String(l.qty ?? 1), amount: String(l.amount) };
  const m = /^(\d+) × (.+?)(?: \(.*\))?$/.exec(l.label);
  const name = m ? m[2] : l.label;
  const kind = Object.keys(KIND_NAME).find((k) => KIND_NAME[k] === name && !needsName(k));
  if (kind) return { kind, label: "", qty: m?.[1] ?? "1", amount: String(l.amount) };
  if (l.label.startsWith("Odd-size item")) return { kind: "odd", label: l.label, qty: "1", amount: String(l.amount) };
  return { kind: "other", label: l.label, qty: "1", amount: String(l.amount) };
}

/**
 * Box lines follow the booking's boxes: a changed count updates that
 * line's quantity and price, a new box type adds a line, a removed one
 * drops its line. Odd-size, delivery, pickup and other lines are kept.
 */
function syncBoxes(lines: Line[], items: DeclarationPrintData["items"], d: DeclarationPrintData): { lines: Line[]; changed: boolean } {
  const want = boxLines(items, d).filter((l) => l.kind !== "odd");
  let changed = false;
  const next: Line[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!isBoxKind(l.kind) || l.kind === "odd") {
      next.push(l);
      continue;
    }
    const w = want.find((x) => x.kind === l.kind);
    // One line per box type (older costings had one line per TV).
    if (!w || seen.has(l.kind)) {
      changed = true;
      continue;
    }
    seen.add(l.kind);
    if (w.qty !== l.qty) {
      changed = true;
      next.push({ ...l, qty: w.qty, amount: w.amount !== "" ? w.amount : l.amount });
    } else next.push(l);
  }
  const added = want.filter((w) => !next.some((l) => l.kind === w.kind));
  if (added.length) {
    changed = true;
    // New box lines go before delivery / pickup / other lines.
    const at = next.findIndex((l) => !isBoxKind(l.kind));
    next.splice(at === -1 ? next.length : at, 0, ...added);
  }
  return { lines: changed ? next : lines, changed };
}

/** L × W × H (cm) → a priced odd-size line; fills the first "(to measure)" line. */
function OddSizeCalc({ onAdd }: { onAdd: (line: Line) => void }) {
  const [dims, setDims] = useState({ l: "", w: "", h: "" });
  const valid = (s: string) => s.trim() !== "" && Number.isFinite(Number(s)) && Number(s) >= 1 && Number(s) <= 500;
  const ok = valid(dims.l) && valid(dims.w) && valid(dims.h);
  const l = Math.round(Number(dims.l)), w = Math.round(Number(dims.w)), h = Math.round(Number(dims.h));
  return (
    <div className="mt-3 rounded-md border border-dashed p-2.5">
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Odd-size calculator · $550 per CBM</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {(["l", "w", "h"] as const).map((k) => (
          <Input
            key={k}
            aria-label={{ l: "Length cm", w: "Width cm", h: "Height cm" }[k]}
            placeholder={{ l: "L cm", w: "W cm", h: "H cm" }[k]}
            inputMode="decimal"
            value={dims[k]}
            onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value }))}
            className="h-8 w-20 text-center text-xs tabular-nums"
          />
        ))}
        <span className="text-xs tabular-nums text-muted-foreground">{ok ? `= $${oddPrice(l, w, h)}` : ""}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!ok}
          onClick={() => {
            onAdd({ kind: "odd", label: oddLabel(l, w, h), qty: "1", amount: oddPrice(l, w, h) });
            setDims({ l: "", w: "", h: "" });
          }}
        >
          Add to costing
        </Button>
      </div>
    </div>
  );
}

/**
 * Booking page → "Costing": what this booking costs, line by line. Each
 * line has a type (box type, door delivery, pickup, extra boxes, other),
 * how many, and an amount worked out at the bot's rates that staff can
 * change. Box lines follow the boxes on the confirm form as they change.
 * The total becomes the booking's price.
 */
export function CostingCard({
  data,
  boxes,
  onSaved,
}: {
  data: DeclarationPrintData;
  /** Live box counts from the confirm form (type → how many), if open. */
  boxes?: Record<string, number> | null | undefined;
  onSaved: () => void;
}) {
  const saved = data.costing;
  // The booking's boxes, with the confirm form's live counts on top.
  const items = useMemo(() => {
    if (!boxes) return data.items;
    return Object.entries(boxes)
      .filter(([, qty]) => qty > 0)
      .map(([type, qty]) => {
        const before = data.items.find((i) => i.type === type);
        return {
          type,
          label: before?.label ?? type,
          qty,
          ...(before?.sizes && before.sizes.length === qty ? { sizes: before.sizes } : {}),
          ...(before?.dims ? { dims: before.dims.slice(0, qty) } : {}),
        };
      });
  }, [boxes, data.items]);
  const itemsKey = JSON.stringify(items.map((i) => [i.type, i.qty, i.sizes ?? null]));

  const [lines, setLines] = useState<Line[]>(() => (saved ? saved.lines.map(fromSaved) : suggestedLines(items, data)));
  const [discount, setDiscount] = useState(saved && saved.discount ? String(saved.discount) : "");
  const [pays, setPays] = useState<Pay[]>(() => (saved?.payments ?? []).map((p) => ({ method: p.method, amount: String(p.amount) })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [followed, setFollowed] = useState(false);

  // Boxes changed (here or on the confirm form) → box lines follow.
  useEffect(() => {
    setLines((s) => {
      const r = syncBoxes(s, items, data);
      if (r.changed) setFollowed(true);
      return r.lines;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  const total = useMemo(() => {
    const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    return Math.max(0, sum - (Number(discount) || 0));
  }, [lines, discount]);
  const paidTotal = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const money = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;

  const update = (i: number, patch: Partial<Line>) => setLines((s) => s.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  // Type or count changed → the amount follows when the bot has a rate.
  const reprice = (i: number, patch: Partial<Line>) =>
    setLines((s) =>
      s.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        if ("kind" in patch && !needsName(next.kind)) next.label = "";
        const p = priceFor(next.kind, Number(next.qty), data);
        return p === null ? ("kind" in patch ? { ...next, amount: "" } : next) : { ...next, amount: String(p) };
      }),
    );

  const kinds = [...(BOX_KINDS[data.countryKey ?? ""] ?? BOX_KINDS["sri_lanka"] ?? []), ...EXTRA_KINDS];

  const save = async () => {
    setError("");
    const clean = lines.map((l) => ({
      kind: l.kind,
      label: labelFor(l, data),
      qty: Number(l.qty),
      amount: l.amount.trim() === "" ? NaN : Number(l.amount),
    }));
    const noName = clean.find((l) => !l.label);
    if (noName) {
      setError(noName.kind === "other" ? "Type what each “Other” line is, or remove it." : "Each line needs a name.");
      return;
    }
    const badQty = clean.find((l) => !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 999);
    if (badQty) {
      setError(`Enter how many for “${badQty.label}” (1–999).`);
      return;
    }
    const bad = clean.find((l) => !Number.isFinite(l.amount) || l.amount < 0);
    if (bad) {
      setError(`Enter an amount for “${bad.label}” (0 is fine), or remove that line.`);
      return;
    }
    const disc = discount.trim() === "" ? 0 : Number(discount);
    if (!Number.isFinite(disc) || disc < 0) {
      setError("The discount must be a number, 0 or more.");
      return;
    }
    const payments = pays.map((p) => ({ method: p.method, amount: p.amount.trim() === "" ? NaN : Number(p.amount) }));
    if (payments.some((p) => !Number.isFinite(p.amount) || p.amount <= 0)) {
      setError("Enter the amount for each payment, or remove it.");
      return;
    }
    setSaving(true);
    try {
      await saveCosting(data.bookingId, { lines: clean, discount: disc, payments });
      notify.success("Costing saved", `Total ${money(total)} is now the booking's price.`);
      onSaved();
    } catch (err) {
      setError(friendlyError(err, "Could not save the costing. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const cols = "grid grid-cols-[minmax(0,1fr)_3.5rem_5.5rem_2rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_7rem_2rem] items-center gap-2";

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Costing</h2>
        <p className="text-xs text-muted-foreground">
          {saved
            ? `Saved${saved.updatedAt ? ` ${formatDate(saved.updatedAt)}` : ""}${saved.updatedBy ? ` by ${saved.updatedBy}` : ""}`
            : "Suggested from the customer's boxes — not saved yet"}
        </p>
      </div>
      {followed && saved && (
        <p className="mb-3 rounded-md bg-secondary px-3 py-2 text-xs text-foreground">Box lines updated to match the boxes. Save costing to keep the new total.</p>
      )}

      <div className="flex flex-col gap-2">
        {lines.length > 0 && (
          <div className={`${cols} text-xs font-medium text-muted-foreground`}>
            <span>Item</span>
            <span className="text-center">Qty</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={cols}>
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row">
              <select
                aria-label={`Cost line ${i + 1} type`}
                value={l.kind}
                onChange={(e) => reprice(i, { kind: e.target.value })}
                className="h-9 min-w-0 rounded-md border border-input bg-card px-2 text-sm sm:w-48 sm:shrink-0"
              >
                {(kinds.includes(l.kind) ? kinds : [l.kind, ...kinds]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_NAME[k] ?? k}
                  </option>
                ))}
              </select>
              {needsName(l.kind) && (
                <Input
                  aria-label={`Cost line ${i + 1} name`}
                  value={l.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder={l.kind === "odd" ? "e.g. Odd-size item 120×40×80 cm" : "What is it?"}
                  className="min-w-0"
                />
              )}
            </div>
            <Input
              aria-label={`Cost line ${i + 1} quantity`}
              inputMode="numeric"
              value={l.qty}
              onChange={(e) => reprice(i, { qty: e.target.value })}
              className="text-center tabular-nums"
            />
            <MoneyInput aria-label={`Cost line ${i + 1} amount`} value={l.amount} onChange={(e) => update(i, { amount: e.target.value })} className="text-right tabular-nums" />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((s) => s.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setLines((s) => [...s, { kind: "other", label: "", qty: "1", amount: "" }])}>
          <Plus className="mr-1 h-4 w-4" /> Add cost line
        </Button>
      </div>
      {items.some((i) => i.type === "other") && (
        <OddSizeCalc
          onAdd={(line) =>
            setLines((s) => {
              const at = s.findIndex((l) => l.label === ODD_TO_MEASURE);
              return at === -1 ? [...s, line] : s.map((l, j) => (j === at ? line : l));
            })
          }
        />
      )}

      <div className={`mt-4 border-t pt-3 ${cols}`}>
        <Label htmlFor="costing-discount" className="text-sm">Discount</Label>
        <span />
        <MoneyInput id="costing-discount" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" className="text-right tabular-nums" />
        <span />
        <span className="text-base font-semibold text-foreground">Total</span>
        <span />
        <span className="text-right text-base font-semibold tabular-nums text-foreground">{money(total)}</span>
        <span />
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Paid by</h3>
          {pays.length > 0 && (
            <span className={`text-xs ${paidTotal + 0.005 < total ? "text-attention-foreground" : "text-muted-foreground"}`}>
              Paid {money(paidTotal)}
              {paidTotal + 0.005 < total ? ` · ${money(total - paidTotal)} still to pay` : ""}
            </span>
          )}
        </div>
        {pays.map((p, i) => (
          <div key={i} className={cols}>
            <select
              aria-label={`Payment ${i + 1} method`}
              value={p.method}
              onChange={(e) => setPays((s) => s.map((x, j) => (j === i ? { ...x, method: e.target.value as PaymentMethod } : x)))}
              className="h-9 min-w-0 rounded-md border border-input bg-card px-2 text-sm sm:w-48"
            >
              {(Object.keys(PAY_METHOD_NAME) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAY_METHOD_NAME[m]}
                </option>
              ))}
            </select>
            <span />
            <MoneyInput
              aria-label={`Payment ${i + 1} amount`}
              value={p.amount}
              onChange={(e) => setPays((s) => s.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
              className="text-right tabular-nums"
            />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove payment ${i + 1}`} onClick={() => setPays((s) => s.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            setPays((s) => [...s, { method: "zeller", amount: s.length ? "" : total > 0 ? String(Math.round(total * 100) / 100) : "" }])
          }
        >
          <Plus className="mr-1 h-4 w-4" /> Add payment
        </Button>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Amounts start at the bot's rates. Change anything before saving.</p>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save costing"}
        </Button>
      </div>
    </section>
  );
}
