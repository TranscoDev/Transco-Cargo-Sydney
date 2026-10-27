import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { Calculator, Copy, ImageUp, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { aiAssist, CHECK_RE, EmailError } from "@/lib/transco/emails";

const fieldClass =
  "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

/**
 * Conversations → ✨: the AI reads the chat and/or a pasted screenshot and
 * either writes the next message (it goes into the message box to check
 * — never sent by itself) or works something out for staff only
 * (counts, totals, prices). Facts come only from the console's prices and
 * calendar; anything unknown is left as [check: …].
 */
export function AiHelperButton({
  customerIds,
  customerId,
  onUse,
  className,
}: {
  customerIds: string[];
  customerId?: string | null | undefined;
  /** Puts the text in the message box. */
  onUse: (text: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"reply" | "work" | null>(null);
  const [result, setResult] = useState<{ mode: "reply" | "work"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setShot(null);
    setNote("");
    setResult(null);
    setError(null);
  }, [open]);

  const takeImage = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Use a picture (PNG or JPG screenshot).");
    if (file.size > 6 * 1024 * 1024) return setError("That picture is too big (max 6 MB).");
    setError(null);
    setShot(await readAsDataUrl(file));
  };

  const onPaste = (e: ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      void takeImage(item.getAsFile());
    }
  };

  const run = async (mode: "reply" | "work") => {
    setError(null);
    setBusy(mode);
    try {
      setResult(await aiAssist({ mode, customerIds, customerId: customerId ?? null, image: shot, ...(note.trim() ? { note: note.trim() } : {}) }));
    } catch (err) {
      setError(err instanceof EmailError ? err.message : "The AI couldn't answer. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const use = () => {
    if (!result) return;
    onUse(result.text);
    setOpen(false);
    toast.success(CHECK_RE.test(result.text) ? "In the message box — fill in the [check] parts" : "In the message box — check it, then send");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="AI helper"
        title="AI: write a reply or work something out from a screenshot"
        className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md text-primary transition-colors hover:bg-primary/10", className)}
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl" onPaste={onPaste}>
          <DialogHeader>
            <DialogTitle>AI helper</DialogTitle>
            <DialogDescription>Uses this chat, plus a screenshot if you add one. Nothing is sent by itself.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {shot ? (
              <div className="flex flex-col gap-2">
                <img src={shot} alt="Screenshot" className="max-h-56 w-full rounded border bg-card object-contain" />
                <div className="flex gap-3">
                  <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-medium text-primary hover:underline">
                    Change screenshot
                  </button>
                  <button type="button" onClick={() => setShot(null)} className="text-xs text-muted-foreground hover:text-foreground">
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground"
              >
                <ImageUp className="h-5 w-5" aria-hidden />
                Add a screenshot or photo (optional)
                <span className="text-xs">or paste one here with Ctrl+V</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void takeImage(e.target.files?.[0])} />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ai-note" className="text-sm font-semibold text-foreground">
                What should it do? <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="ai-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="e.g. “work out the total for these boxes to Kandy” or “say sorry for the delay”"
                className={fieldClass}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={!!busy} onClick={() => void run("reply")}>
                <Sparkles className="mr-1 h-4 w-4" aria-hidden /> {busy === "reply" ? "Writing…" : "Write a reply"}
              </Button>
              <Button type="button" variant="outline" disabled={!!busy} onClick={() => void run("work")}>
                <Calculator className="mr-1 h-4 w-4" aria-hidden /> {busy === "work" ? "Working…" : "Work it out (staff only)"}
              </Button>
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-foreground">
                {error}
              </p>
            )}

            {result && (
              <div className={cn("rounded-lg border p-3", result.mode === "work" ? "bg-warning-soft" : "border-primary/30 bg-primary/5")}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {result.mode === "work" ? "For staff — not sent" : "Suggested reply"}
                </p>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{result.text}</div>
              </div>
            )}
          </div>

          {result && (
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(result.text).then(() => toast.success("Copied"));
                }}
              >
                <Copy className="mr-1 h-4 w-4" aria-hidden /> Copy
              </Button>
              <Button type="button" onClick={use}>
                Put in message box
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
