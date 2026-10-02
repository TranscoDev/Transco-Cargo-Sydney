import { useEffect, useState } from "react";

import { fetchConsolidations } from "@/lib/transco/api";
import type { Consolidation } from "@/lib/transco/types";

// One load per page visit is plenty — shipments change rarely.
let cache: Promise<Consolidation[]> | null = null;
function loadShipments(): Promise<Consolidation[]> {
  if (!cache) cache = fetchConsolidations().catch((err: unknown) => { cache = null; throw err; });
  return cache;
}
/** Call after creating a shipment so pickers show it straight away. */
export function forgetShipmentList() {
  cache = null;
}

/**
 * Which shipment (container) a BL goes in — a drop-down of the shipments
 * staff have created, newest first, so a new "Shipment 59" can be picked
 * as soon as it exists. Value is the shipment number as text ("" = none yet).
 */
export function ShipmentPicker({
  id,
  value,
  onChange,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [shipments, setShipments] = useState<Consolidation[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadShipments()
      .then((list) => !cancelled && setShipments([...list].sort((a, b) => b.batchNumber - a.batchNumber)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // If the list can't load, staff can still type the number.
  if (failed) {
    return (
      <input
        id={id}
        value={value}
        inputMode="numeric"
        placeholder="e.g. 59"
        onChange={(e) => onChange(e.target.value)}
        className={className ?? "h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm"}
      />
    );
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={!shipments}
      className={className ?? "h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground"}
    >
      <option value="">{shipments ? "Not in a shipment yet" : "Loading…"}</option>
      {(shipments ?? []).map((s) => (
        <option key={s.id} value={String(s.batchNumber)}>
          Shipment {s.batchNumber}
          {s.dates.sydneyCalendarEtd ? ` · leaves ${new Date(`${s.dates.sydneyCalendarEtd}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}` : ""}
        </option>
      ))}
    </select>
  );
}
