import { useEffect, useRef, useState } from "react";
import { Eye, FileText, Loader2, Printer, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchFormPdf, fetchFormsList, type BookingForm } from "@/lib/transco/declaration-print";

/**
 * The forms a booking gets (Sri Lanka: Shipping Declaration, UPB customs
 * form, Delivery Agreement; India: Shipping Declaration, Packing List),
 * each with its own preview, plus "Print all". Nothing prints without
 * being previewed first — staff see the filled form, then press Print.
 */
export function FormsCard({ bookingId }: { bookingId: string }) {
  const [forms, setForms] = useState<BookingForm[] | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<BookingForm | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError("");
    fetchFormsList(bookingId)
      .then((f) => !cancelled && setForms(f))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Could not load the forms"));
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  return (
    <section className="rounded-lg border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Forms</h3>
        <Button type="button" size="sm" onClick={() => setPreview({ key: "all", title: "All forms" })} disabled={!forms}>
          <Printer className="mr-1.5 h-4 w-4" aria-hidden /> Print all
        </Button>
      </div>
      {error ? (
        <p className="text-xs font-medium text-attention-foreground">{error}</p>
      ) : !forms ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {forms.map((f) => (
            <li key={f.key} className="flex items-center gap-2 px-2.5 py-1.5">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{f.title}</span>
              <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setPreview(f)}>
                <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Preview &amp; print
              </Button>
            </li>
          ))}
        </ul>
      )}
      {preview && <PrintPreviewDialog bookingId={bookingId} form={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

/** Shows the filled form full-size; Print sends exactly what's on screen to the printer. */
export function PrintPreviewDialog({ bookingId, form, onClose }: { bookingId: string; form: BookingForm; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchFormPdf(bookingId, form.key)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Could not make the form"));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bookingId, form.key]);

  const print = () => {
    const win = frameRef.current?.contentWindow;
    try {
      if (!win) throw new Error("no frame");
      win.focus();
      win.print();
    } catch {
      // Some browsers can't print a PDF shown inside the page — open it on its own instead.
      if (url) window.open(url, "_blank");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92vh] max-w-5xl flex-col gap-3 p-4 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{form.title}</DialogTitle>
          <DialogDescription>Check the form, then press Print.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-secondary">
          {error ? (
            <p className="p-4 text-sm font-medium text-attention-foreground">{error}</p>
          ) : url ? (
            <iframe ref={frameRef} src={url} title={`${form.title} preview`} className="h-full w-full bg-white" />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Filling the form…
              </span>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => url && window.open(url, "_blank")} disabled={!url}>
            <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden /> Open in new tab
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="button" onClick={print} disabled={!url}>
              <Printer className="mr-1.5 h-4 w-4" aria-hidden /> Print
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
