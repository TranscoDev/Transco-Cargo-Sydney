import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";

import { ErrorState, LoadingRows, PageHeader, PageShell } from "@/components/transco/page-kit";
import { MoneyInput } from "@/components/transco/money-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { fetchCostRates, saveCostRates, type CostRates } from "@/lib/transco/api";
import { notify } from "@/lib/transco/notify";

// Finance → Cost rates: what each box costs Transco. The Finance page
// multiplies the costing sheet's counts by these. Door delivery and home
// pickup cost what the costing sheet charges, so they have no rate here.
export const Route = createFileRoute("/console/finance/rates")({
  component: CostRatesPage,
});

// Blank is allowed for these: the Finance page then uses the costing sheet's amount.
const OPTIONAL = ["wineBox", "tv"];

function CostRatesPage() {
  const [data, setData] = useState<CostRates | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const apply = (d: CostRates) => {
    setData(d);
    setValues(Object.fromEntries(Object.keys(d.labels).map((k) => [k, d.rates[k] == null ? "" : String(d.rates[k])])));
  };

  const load = () => {
    setError(null);
    fetchCostRates()
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the cost rates"));
  };
  useEffect(load, []);

  const save = async () => {
    const rates: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(values)) rates[k] = v.trim() === "" ? null : Number(v);
    setSaving(true);
    try {
      apply(await saveCostRates(rates));
      notify.success("Cost rates saved", "The Finance page uses them straight away.");
    } catch (err) {
      notify.error("Couldn't save the cost rates", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell width="narrow">
      <PageHeader
        icon={SlidersHorizontal}
        title="Cost rates"
        description="What each box costs Transco. The Finance page multiplies the counts on each costing sheet by these."
        breadcrumbs={[{ label: "Finance", to: "/console/finance" }, { label: "Cost rates" }]}
      />
      {error && <ErrorState description={error} onRetry={load} compact />}
      {!data && !error && <LoadingRows rows={4} />}
      {data && (
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            {Object.entries(data.labels).map(([k, label]) => (
              <div key={k} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3">
                <div>
                  <Label htmlFor={`rate-${k}`}>{label}</Label>
                  {k === "oddPerCbm" && <p className="text-xs text-muted-foreground">L × W × H (cm) ÷ 1,000,000 × this rate</p>}
                  {OPTIONAL.includes(k) && <p className="text-xs text-muted-foreground">Leave blank to use the costing sheet's amount</p>}
                </div>
                <MoneyInput
                  id={`rate-${k}`}
                  value={values[k] ?? ""}
                  onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))}
                  className="text-right tabular-nums"
                />
              </div>
            ))}
            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              Door delivery (D2D Z1–Z3) and home pickup (SYD collect) cost what the costing sheet charges for them. The zone comes from the
              receiver's town.
            </p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {data.updatedAt
                  ? `Last saved ${new Date(data.updatedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" })}${data.updatedBy ? ` by ${data.updatedBy}` : ""}`
                  : "Not saved yet — these are the starting rates."}
              </p>
              <Button type="button" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save rates"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
