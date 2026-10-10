import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCosting, type DeclarationPrintData } from "@/lib/transco/declaration-print";
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

type Line = { label: string; amount: string };

export const tvSizeLabel = (s: string) => TV_BANDS[s]?.label ?? "other size";

// Odd-size items: $550 per cubic metre (Sri Lanka Sea).
const ODD_TO_MEASURE = "Odd-size item (to measure)";
const oddLabel = (l: number, w: number, h: number) => `Odd-size item ${l}×${w}×${h} cm`;
export const oddPrice = (l: number, w: number, h: number) => String(Math.ceil(((l * w * h) / 1e6) * 550));

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
            onAdd({ label: oddLabel(l, w, h), amount: oddPrice(l, w, h) });
            setDims({ l: "", w: "", h: "" });
          }}
        >
          Add to costing
        </Button>
      </div>
    </div>
  );
}

/** Suggested cost lines from the customer's boxes (empty amount = staff to fill in). */
function suggestedLines(d: DeclarationPrintData): Line[] {
  const lines: Line[] = [];
  const sea = d.serviceKey === "sea";
  for (const i of d.items) {
    const name = `${i.qty} × ${i.label}`;
    if (!sea) {
      lines.push({ label: `${name} (Air — by weight)`, amount: "" });
    } else if (d.countryKey === "india") {
      const p = INDIA_SEA[i.type];
      const [one, two, three] = p ?? [0, 0, 0];
      const india = i.qty === 1 ? one : i.qty === 2 ? two : three + (i.qty - 3) * (three - two);
      lines.push({ label: name, amount: p ? String(india) : "" });
    } else if (i.type === "tea_chest") {
      let t = 0;
      for (let n = 1; n <= i.qty; n++) t += n % 3 === 0 ? 0 : 75;
      lines.push({ label: name + (i.qty >= 3 ? " (every 3rd free)" : ""), amount: String(t) });
    } else if (SL_SEA[i.type] !== undefined) {
      lines.push({ label: name, amount: String((SL_SEA[i.type] ?? 0) * i.qty) });
    } else if (i.type === "tv") {
      (i.sizes ?? []).forEach((s) => {
        const band = TV_BANDS[s];
        lines.push({ label: `TV ${band ? band.label : "(other size)"}`, amount: band ? String(band.price) : "" });
      });
      if (!i.sizes?.length) lines.push({ label: name, amount: "" });
    } else if (i.type === "other") {
      (i.dims ?? []).forEach((m) => lines.push({ label: oddLabel(m.l, m.w, m.h), amount: oddPrice(m.l, m.w, m.h) }));
      // The customer only gives a count — one line each for staff to measure.
      for (let n = (i.dims ?? []).length; n < i.qty; n++) lines.push({ label: ODD_TO_MEASURE, amount: "" });
    } else {
      lines.push({ label: name, amount: "" });
    }
  }
  if (d.handover === "pickup") lines.push({ label: "Home pickup", amount: "" });
  if (d.deliveryKey === "door") lines.push({ label: "Door delivery", amount: "" });
  return lines;
}

/**
 * Booking page → "Costing": what this booking costs, line by line. Starts
 * from the customer's boxes at the bot's rates; staff change amounts, add
 * or remove lines (door delivery, pickup, extras), set a discount and Save.
 * The total becomes the booking's price.
 */
export function CostingCard({ data, onSaved }: { data: DeclarationPrintData; onSaved: () => void }) {
  const saved = data.costing;
  const [lines, setLines] = useState<Line[]>(() =>
    saved ? saved.lines.map((l) => ({ label: l.label, amount: String(l.amount) })) : suggestedLines(data),
  );
  const [discount, setDiscount] = useState(saved && saved.discount ? String(saved.discount) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const total = useMemo(() => {
    const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    return Math.max(0, sum - (Number(discount) || 0));
  }, [lines, discount]);

  const update = (i: number, patch: Partial<Line>) => setLines((s) => s.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setError("");
    const clean = lines.map((l) => ({ label: l.label.trim(), amount: l.amount.trim() === "" ? NaN : Number(l.amount) }));
    const bad = clean.find((l) => !l.label || !Number.isFinite(l.amount) || l.amount < 0);
    if (bad) {
      setError(bad.label ? `Enter an amount for “${bad.label}” (0 is fine), or remove that line.` : "Each line needs a name.");
      return;
    }
    const disc = discount.trim() === "" ? 0 : Number(discount);
    if (!Number.isFinite(disc) || disc < 0) {
      setError("The discount must be a number, 0 or more.");
      return;
    }
    setSaving(true);
    try {
      await saveCosting(data.bookingId, { lines: clean, discount: disc });
      notify.success("Costing saved", `Total $${total.toFixed(2).replace(/\.00$/, "")} is now the booking's price.`);
      onSaved();
    } catch (err) {
      setError(friendlyError(err, "Could not save the costing. Please try again."));
    } finally {
      setSaving(false);
    }
  };

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

      <div className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-center gap-2">
            <Input aria-label={`Cost line ${i + 1} name`} value={l.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="e.g. Door delivery" />
            <Input aria-label={`Cost line ${i + 1} amount`} inputMode="decimal" value={l.amount} onChange={(e) => update(i, { amount: e.target.value })} placeholder="$" className="text-right tabular-nums" />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.label || "line"}`} onClick={() => setLines((s) => s.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setLines((s) => [...s, { label: "", amount: "" }])}>
          <Plus className="mr-1 h-4 w-4" /> Add cost line
        </Button>
      </div>
      {data.items.some((i) => i.type === "other") && (
        <OddSizeCalc
          onAdd={(line) =>
            setLines((s) => {
              const at = s.findIndex((l) => l.label === ODD_TO_MEASURE);
              return at === -1 ? [...s, line] : s.map((l, j) => (j === at ? line : l));
            })
          }
        />
      )}

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-center gap-2 border-t pt-3">
        <Label htmlFor="costing-discount" className="text-sm">Discount</Label>
        <Input id="costing-discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" className="text-right tabular-nums" />
        <span />
        <span className="text-base font-semibold text-foreground">Total</span>
        <span className="text-right text-base font-semibold tabular-nums text-foreground">${total.toFixed(2).replace(/\.00$/, "")}</span>
        <span />
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Box amounts start at the bot's rates. Change anything before saving.</p>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save costing"}
        </Button>
      </div>
    </section>
  );
}
