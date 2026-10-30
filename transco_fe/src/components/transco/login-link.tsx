import { useEffect, useState, type FormEvent } from "react";
import { Copy, KeyRound, MessageCircle, QrCode, Smartphone, UserPlus } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { cancelLoginLink, createLoginLink, formatPhone, quickRegister, type LoginLink } from "@/lib/transco/my-transco";

/**
 * My Transco for customers who find sign-up hard (mostly elderly). Staff
 * make the account and send a Login link: tapping it opens their normal
 * My Transco with no password, and that phone stays signed in.
 */

const fieldClass =
  "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Lang = "en" | "si" | "ta";

function message(lang: Lang, name: string | null, link: string) {
  const first = (name || "").trim().split(/\s+/)[0] || "";
  if (lang === "si") return `ආයුබෝවන්${first ? ` ${first}` : ""}, මෙය Transco Cargo වෙතින්. ඔබගේ bookings සහ tracking බලන්න මෙම link එක ඔබන්න — password එකක් අවශ්‍ය නැහැ:\n${link}`;
  if (lang === "ta") return `வணக்கம்${first ? ` ${first}` : ""}, இது Transco Cargo. உங்கள் bookings மற்றும் tracking பார்க்க இந்த link-ஐ அழுத்துங்கள் — password தேவையில்லை:\n${link}`;
  return `Hi${first ? ` ${first}` : ""}, this is Transco Cargo. Tap this link to see your bookings and tracking — no password needed:\n${link}`;
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

/** The link, ready to Copy / send on WhatsApp / send by SMS. */
function LinkReady({ data, onCancelled }: { data: LoginLink; onCancelled: () => void }) {
  const [lang, setLang] = useState<Lang>("en");
  const text = message(lang, data.name, data.link);
  const digits = data.phoneNumber.replace(/\D/g, "");
  // At the counter: the customer scans it with their phone camera.
  const [qr, setQr] = useState<string | null>(null);
  const toggleQr = async () => {
    if (qr) return setQr(null);
    try {
      setQr(await QRCode.toDataURL(data.link, { width: 240, margin: 1 }));
    } catch {
      toast.error("Couldn't make the QR code — send the link instead.");
    }
  };

  const copy = (value: string, what: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => toast.success(`${what} copied`),
      () => toast.error("Couldn't copy — select it and copy by hand."),
    );
  };

  const cancel = async () => {
    if (!window.confirm("Cancel this link? It will stop working. (A phone already signed in stays signed in — use Sign out everywhere for that.)")) return;
    try {
      await cancelLoginLink(data.customerId);
      toast.success("Link cancelled");
      onCancelled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel the link.");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success-foreground">
        ✓ Account ready for <strong>{data.name || formatPhone(data.phoneNumber)}</strong>
        {data.customerCode ? ` (${data.customerCode})` : ""}
        {data.existing ? " — their earlier bookings are already in it." : "."}
        <span className="mt-0.5 block text-xs">Phone: {formatPhone(data.phoneNumber)} — check this is right before sending.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-foreground">Login link</span>
        <div className="flex gap-2">
          <input readOnly value={data.link} onFocus={(e) => e.currentTarget.select()} className={cn(fieldClass, "font-mono text-xs")} aria-label="Login link" />
          <Button type="button" variant="outline" onClick={() => copy(data.link, "Link")}>
            <Copy className="mr-1 h-4 w-4" aria-hidden /> Copy
          </Button>
          <Button type="button" variant={qr ? "default" : "outline"} onClick={() => void toggleQr()} aria-pressed={!!qr}>
            <QrCode className="mr-1 h-4 w-4" aria-hidden /> QR code
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Works until {fmtDay(data.expiresAt)} (7 days). The phone that opens it stays signed in until they sign out.
        </p>
        {qr && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-white p-3">
            <img src={qr} alt={`QR code to sign ${data.name || "the customer"} in to My Transco`} width={240} height={240} />
            <p className="text-center text-xs text-muted-foreground">
              The customer opens their phone camera and points it at this code. Only show it to {data.name || "this customer"} —
              whoever scans it is signed in to their account.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">Message</span>
          <div className="flex gap-1" role="group" aria-label="Message language">
            {(["en", "si", "ta"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  lang === l ? "border-primary/30 bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary",
                )}
              >
                {l === "en" ? "English" : l === "si" ? "සිංහල" : "தமிழ்"}
              </button>
            ))}
          </div>
        </div>
        <div className="whitespace-pre-wrap wrap-break-word rounded-lg border bg-secondary/30 p-3 text-sm text-foreground">{text}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-1 h-4 w-4" aria-hidden /> Send on WhatsApp
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={`sms:+${digits}?body=${encodeURIComponent(text)}`}>
            <Smartphone className="mr-1 h-4 w-4" aria-hidden /> Send by SMS
          </a>
        </Button>
        <Button type="button" variant="outline" onClick={() => copy(text, "Message")}>
          <Copy className="mr-1 h-4 w-4" aria-hidden /> Copy message
        </Button>
      </div>
      <button type="button" onClick={() => void cancel()} className="self-start text-xs text-muted-foreground hover:text-destructive">
        Cancel this link
      </button>
    </div>
  );
}

/** "Login link" — on a customer profile or booking. */
export function LoginLinkButton({ customerId, className, label = "Login link" }: { customerId: string | null | undefined; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LoginLink | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !customerId) return;
    setData(null);
    setError(null);
    createLoginLink(customerId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't make the link."));
  }, [open, customerId]);

  if (!customerId) return null;
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className={className}>
        <KeyRound className="mr-1 h-4 w-4" aria-hidden /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Login link</DialogTitle>
            <DialogDescription>For customers who find signing up hard. They tap it and they're in — no password.</DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-foreground">
              {error}
            </p>
          ) : !data ? (
            <p className="text-sm text-muted-foreground">Making the link…</p>
          ) : (
            <LinkReady data={data} onCancelled={() => setOpen(false)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "+ Quick register" — Online Accounts: make the account, then the link. */
export function QuickRegisterButton({ onDone }: { onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<LoginLink | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPhone("");
    setEmail("");
    setError(null);
    setData(null);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError({ text: "Type the customer's name.", field: "name" });
    if (phone.replace(/\D/g, "").length < 9) return setError({ text: "Type their phone number. Use +94… for Sri Lanka.", field: "phone" });
    setSaving(true);
    try {
      setData(await quickRegister({ name: name.trim(), phone: phone.trim(), ...(email.trim() ? { email: email.trim() } : {}) }));
      onDone?.();
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : "Couldn't make the account." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1 h-4 w-4" aria-hidden /> Quick register
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Quick register</DialogTitle>
            <DialogDescription>Make a My Transco account for a customer, then send them a Login link. No password needed.</DialogDescription>
          </DialogHeader>
          {data ? (
            <LinkReady data={data} onCancelled={() => setOpen(false)} />
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="qr-name" className="text-sm font-semibold text-foreground">
                  Name
                </label>
                <input id="qr-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={cn(fieldClass, error?.field === "name" && "border-destructive")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="qr-phone" className="text-sm font-semibold text-foreground">
                  Phone
                </label>
                <input
                  id="qr-phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="04… or +94 7…"
                  className={cn(fieldClass, error?.field === "phone" && "border-destructive")}
                />
                <p className="text-xs text-muted-foreground">
                  Their mobile — 04… is Australian, 07… is Sri Lankan. If we already know this number, their bookings come with it.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="qr-email" className="text-sm font-semibold text-foreground">
                  Email <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="qr-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={cn(fieldClass, error?.field === "email" && "border-destructive")}
                />
              </div>
              {error && (
                <p role="alert" className="rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-foreground">
                  {error.text}
                </p>
              )}
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Making the account…" : "Make account & link"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
