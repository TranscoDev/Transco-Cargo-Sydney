import { useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";

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
import { cn } from "@/lib/utils";
import { importShipmentSheet, type ShipmentSheetResult } from "@/lib/transco/api";
import { notify } from "@/lib/transco/notify";

const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });

const STATE_STYLE: Record<string, string> = {
  new: "bg-success-soft text-success-foreground",
  "already imported": "bg-secondary text-muted-foreground",
  problem: "bg-attention-soft text-attention-foreground",
};

/**
 * Staff upload the "Shipment#NN" tab of the TRANSCO DASHBOARD sheet.
 * Choosing a file shows a preview straight away (nothing saved); the
 * Import button then adds the new HBLs. Already-imported HBLs are skipped,
 * so uploading the same sheet again is harmless.
 */
export function ShipmentSheetImportDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState("");
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState<ShipmentSheetResult | null>(null);
  const [done, setDone] = useState<ShipmentSheetResult | null>(null);
  const [busy, setBusy] = useState<"checking" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setBatch("");
    setLabel("");
    setPreview(null);
    setDone(null);
    setError(null);
    setBusy(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const check = async (f: File, batchNumber?: number | null) => {
    setBusy("checking");
    setError(null);
    setPreview(null);
    try {
      const result = await importShipmentSheet(f, { batchNumber, commit: false });
      setPreview(result);
      setBatch(String(result.summary.batchNumber));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the sheet");
    } finally {
      setBusy(null);
    }
  };

  const onPick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setDone(null);
    void check(f);
  };

  const runImport = async () => {
    if (!file || !preview) return;
    setBusy("importing");
    setError(null);
    try {
      const result = await importShipmentSheet(file, { batchNumber: Number(batch) || null, label: label.trim(), commit: true });
      setDone(result);
      notify.success(`Shipment ${result.summary.batchNumber}: ${result.created ?? 0} HBLs imported`);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  };

  const s = preview?.summary;
  const batchChanged = preview && Number(batch) !== preview.summary.batchNumber;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="gap-1.5">
          <Upload className="h-3.5 w-3.5" />
          Import shipment sheet
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import a shipment sheet</DialogTitle>
          <DialogDescription>
            Upload the <b>Shipment#NN</b> tab of the TRANSCO DASHBOARD. In Google Sheets: open that tab, then{" "}
            <b>File → Download → Microsoft Excel (.xlsx)</b> or <b>CSV</b>. You'll see a check first; nothing is saved until you press Import.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" aria-hidden />
            <p className="text-base font-semibold text-foreground">
              {done.created ?? 0} HBL{done.created === 1 ? "" : "s"} imported into Shipment {done.summary.batchNumber}
            </p>
            <p className="text-sm text-muted-foreground">
              {done.summary.newCustomers} new customer{done.summary.newCustomers === 1 ? "" : "s"}, {done.summary.existingCustomers} matched to existing ones.
              {done.summary.alreadyImported ? ` ${done.summary.alreadyImported} were already in the system and were left as they are.` : ""}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FileSpreadsheet className="h-7 w-7 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">{file ? file.name : "Choose the Excel or CSV file"}</span>
                <span className="block text-xs text-muted-foreground">{file ? "Tap to choose a different file" : ".xlsx, .xls or .csv"}</span>
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0])}
            />

            {busy === "checking" && <p className="text-sm text-muted-foreground">Checking the sheet…</p>}

            {preview && s && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="sheet-batch">Shipment number</Label>
                    <div className="flex gap-2">
                      <Input id="sheet-batch" inputMode="numeric" value={batch} onChange={(e) => setBatch(e.target.value)} />
                      {batchChanged && file && (
                        <Button type="button" variant="outline" onClick={() => check(file, Number(batch) || null)}>
                          Check
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="sheet-label">Label (optional)</Label>
                    <Input id="sheet-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`e.g. ${s.batchNumber}-JUL`} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-success-soft px-2.5 py-1 font-semibold text-success-foreground">{s.newHbls} new HBL{s.newHbls === 1 ? "" : "s"}</span>
                  {s.alreadyImported > 0 && <span className="rounded-full bg-secondary px-2.5 py-1 font-semibold text-muted-foreground">{s.alreadyImported} already imported</span>}
                  {s.problems > 0 && <span className="rounded-full bg-attention-soft px-2.5 py-1 font-semibold text-attention-foreground">{s.problems} need fixing</span>}
                  <span className="rounded-full bg-info-soft px-2.5 py-1 font-semibold text-info-foreground">
                    {s.newCustomers} new · {s.existingCustomers} existing customer{s.existingCustomers === 1 ? "" : "s"}
                  </span>
                  <span className="rounded-full bg-secondary px-2.5 py-1 font-semibold text-foreground">
                    {AUD.format(s.income)} income · {AUD.format(s.paid)} paid
                  </span>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-muted-foreground">
                    Shipment {s.batchNumber}: {s.shipmentGroup === "new" ? "will be created" : "already exists — new HBLs are added to it"}
                  </span>
                </div>

                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="bg-secondary/60 text-muted-foreground">
                      <tr>
                        <th className="px-2.5 py-2 font-semibold">HBL</th>
                        <th className="px-2.5 py-2 font-semibold">Sender</th>
                        <th className="px-2.5 py-2 font-semibold">Receiver</th>
                        <th className="px-2.5 py-2 font-semibold">Boxes</th>
                        <th className="px-2.5 py-2 text-right font-semibold">Income / paid</th>
                        <th className="px-2.5 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={`${r.sheetRow}-${r.hbl}`} className="border-t align-top">
                          <td className="px-2.5 py-2 font-mono tabular-nums">{r.hbl ?? "—"}</td>
                          <td className="px-2.5 py-2">
                            <span className="block font-medium text-foreground">{r.sender}</span>
                            <span className="block text-muted-foreground">
                              {r.customer === "existing" ? `Existing customer${r.existingCustomerName ? `: ${r.existingCustomerName}` : ""}` : "New customer"}
                            </span>
                          </td>
                          <td className="px-2.5 py-2">{r.receiver}</td>
                          <td className="px-2.5 py-2">{r.boxes || `${r.totalBoxes} box(es)`}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">
                            {r.income != null ? AUD.format(r.income) : "—"}
                            <span className="block text-muted-foreground">{AUD.format(r.paid)}</span>
                          </td>
                          <td className="px-2.5 py-2">
                            <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-semibold", STATE_STYLE[r.state])}>{r.state}</span>
                            {r.problems.map((p) => (
                              <span key={p} className="mt-1 block text-attention-foreground">
                                Row {r.sheetRow}: {p}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {s.problems > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Rows that need fixing are skipped. Fix them in the sheet and upload it again later — the rest won't be added twice.
                  </p>
                )}
              </>
            )}

            {error && <p className="text-sm font-medium text-attention-foreground">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <Button type="button" onClick={runImport} disabled={!preview || !s?.newHbls || !!busy || !!batchChanged}>
              {busy === "importing"
                ? "Importing…"
                : s?.newHbls
                  ? `Import ${s.newHbls} HBL${s.newHbls === 1 ? "" : "s"} into Shipment ${s.batchNumber}`
                  : preview
                    ? "Nothing new to import"
                    : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
