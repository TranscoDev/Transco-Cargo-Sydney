import { useState } from "react";
import { Plane } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveDangerousGoods, type DangerousGoods, type DeclarationPrintData } from "@/lib/transco/declaration-print";
import { friendlyError, notify } from "@/lib/transco/notify";

/** The lithium battery transport document's configurations (ICAO/IATA packing instructions). */
const LITHIUM_CONFIGS: { key: string; group: "Lithium ion" | "Lithium metal"; label: string }[] = [
  { key: "ion_965_ii", group: "Lithium ion", label: "Cells/batteries only — PI 965, Section II" },
  { key: "ion_965_ib", group: "Lithium ion", label: "Cells/batteries only — PI 965, Section IB" },
  { key: "ion_966_ii", group: "Lithium ion", label: "Packed with equipment — PI 966, Section II" },
  { key: "ion_967_ii", group: "Lithium ion", label: "Contained in equipment — PI 967, Section II" },
  { key: "metal_968_ii", group: "Lithium metal", label: "Cells/batteries only — PI 968, Section II" },
  { key: "metal_968_ib", group: "Lithium metal", label: "Cells/batteries only — PI 968, Section IB" },
  { key: "metal_969_ii", group: "Lithium metal", label: "Packed with equipment — PI 969, Section II" },
  { key: "metal_970_ii", group: "Lithium metal", label: "Contained in equipment — PI 970, Section II" },
];

const EMPTY: DangerousGoods = { noProhibited: false, medications: false, lithium: false, lithiumDetails: "", liquids: false, liquidsDetails: "" };

/** The checklist's five "NO …" lines, as item names. */
const PROHIBITED = [
  "Aerosol cans, sprays or perfumes",
  "Flammable items, explosives, magnets or hazardous items",
  "Batteries, engines, fuel or oil",
  "Illicit drugs, pornography, weapons or firearms",
  "Precious jewellery, gold, precious stones, money, cards or passports",
];

function linesOf(dg: DangerousGoods | null): boolean[] {
  if (dg?.notInBoxes && dg.notInBoxes.length === PROHIBITED.length) return [...dg.notInBoxes];
  return PROHIBITED.map(() => Boolean(dg?.noProhibited));
}

/**
 * Air Freight bookings: the customer's Dangerous Goods Checklist answers
 * (staff can correct them if something changes at the counter) and the
 * lithium battery configuration for the transport document, which staff
 * choose. Both feed the printed Air Freight forms.
 */
export function AirFreightCard({ data, onSaved }: { data: DeclarationPrintData; onSaved: () => void }) {
  const [dg, setDg] = useState<DangerousGoods>(() => ({ ...EMPTY, ...(data.dangerousGoods ?? {}) }));
  // Each "NO …" line: ticked = confirmed not in the boxes.
  const [notIn, setNotIn] = useState<boolean[]>(() => linesOf(data.dangerousGoods));
  const flagged = PROHIBITED.filter((_, i) => !notIn[i]);
  const [configs, setConfigs] = useState<string[]>(() => data.lithiumDoc?.configs ?? []);
  const [phone, setPhone] = useState(() => data.lithiumDoc?.phone || data.sender?.mobile || "");
  const [saving, setSaving] = useState(false);
  const answered = !!data.dangerousGoods;

  const save = async () => {
    setSaving(true);
    try {
      await saveDangerousGoods(data.bookingId, {
        dangerousGoods: { ...dg, notInBoxes: notIn, noProhibited: notIn.every(Boolean) },
        ...(dg.lithium ? { lithiumDoc: { configs, phone: phone.trim() } } : {}),
      });
      notify.success("Air Freight details saved");
      onSaved();
    } catch (err) {
      notify.error("Couldn't save", friendlyError(err, "Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const yesNo = (key: "medications" | "lithium" | "liquids", label: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-36 text-xs font-medium text-foreground">{label}</span>
      {([false, true] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={dg[key] === v}
          onClick={() => setDg((s) => ({ ...s, [key]: v }))}
          className={`rounded-md border px-3 py-1 text-xs font-medium ${dg[key] === v ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground hover:text-foreground"}`}
        >
          {v ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );

  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <Plane className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">Air Freight — dangerous goods</h3>
      </div>
      {!answered && (
        <p className="mb-3 rounded-md bg-warning-soft px-2.5 py-1.5 text-xs text-warning-foreground">
          The customer hasn't answered the dangerous goods checklist yet — go through it with them and fill it in here.
        </p>
      )}

      {answered && flagged.length > 0 && (
        <div role="alert" className="mb-3 rounded-md border border-attention/40 bg-attention-soft px-2.5 py-2 text-xs text-attention-foreground">
          <p className="font-semibold">The customer said their boxes may contain items that can't go by Air Freight — check them now:</p>
          <ul className="mt-1 list-disc pl-4">
            {flagged.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="mt-1">Take them out or send them by Sea Freight, then tick the line here once it's sorted.</p>
        </div>
      )}

      <p className="mb-1 text-xs font-medium text-foreground">Not in the boxes (tick each line once checked)</p>
      <div className="mb-3 flex flex-col gap-1">
        {PROHIBITED.map((label, i) => (
          <label key={label} className={`flex items-start gap-2 rounded px-1 py-0.5 text-xs ${notIn[i] ? "" : "bg-attention-soft/50"}`}>
            <input
              type="checkbox"
              checked={notIn[i]}
              onChange={(e) => setNotIn((s) => s.map((v, j) => (j === i ? e.target.checked : v)))}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span>No {label.charAt(0).toLowerCase() + label.slice(1)}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {yesNo("medications", "Medications")}
        {yesNo("lithium", "Lithium batteries")}
        {dg.lithium && (
          <Input
            aria-label="Lithium batteries: type of product and quantity"
            placeholder="Type of product and quantity"
            value={dg.lithiumDetails}
            onChange={(e) => setDg((s) => ({ ...s, lithiumDetails: e.target.value }))}
            className="h-8 text-xs"
          />
        )}
        {yesNo("liquids", "Liquids")}
        {dg.liquids && (
          <Input
            aria-label="Liquids: type of product and quantity"
            placeholder="Type of product and quantity"
            value={dg.liquidsDetails}
            onChange={(e) => setDg((s) => ({ ...s, liquidsDetails: e.target.value }))}
            className="h-8 text-xs"
          />
        )}
      </div>

      {dg.lithium && (
        <div className="mt-4 rounded-md border bg-panel p-2.5">
          <p className="mb-1.5 text-xs font-semibold text-foreground">Lithium battery document — tick the configuration</p>
          <div className="grid gap-x-4 gap-y-1 @container sm:grid-cols-2">
            {(["Lithium ion", "Lithium metal"] as const).map((group) => (
              <div key={group}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                {LITHIUM_CONFIGS.filter((c) => c.group === group).map((c) => (
                  <label key={c.key} className="flex items-start gap-2 py-0.5 text-xs">
                    <input
                      type="checkbox"
                      checked={configs.includes(c.key)}
                      onChange={(e) => setConfigs((s) => (e.target.checked ? [...s, c.key] : s.filter((k) => k !== c.key)))}
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <label className="mt-2 flex flex-col gap-1 text-xs">
            <span className="font-medium text-foreground">Phone for more information about the batteries</span>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-8 text-xs" inputMode="tel" />
          </label>
        </div>
      )}

      <Button type="button" size="sm" className="mt-3" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save Air Freight details"}
      </Button>
    </section>
  );
}
