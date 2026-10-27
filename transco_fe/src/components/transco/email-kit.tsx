import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ImageUp, Mail, Reply, Sparkles, UserRound, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { canSee } from "@/lib/transco/auth";
import {
  accountLabel,
  CHECK_RE,
  draftEmail,
  EMAIL_TEMPLATES,
  EmailError,
  fetchEmailAccounts,
  fetchEmails,
  fetchRecipients,
  fetchThread,
  fetchUnreadReplies,
  fillTemplate,
  sendEmail,
  type EmailAccount,
  type EmailAccounts,
  type EmailRecipient,
  type SentEmail,
  type ThreadItem,
} from "@/lib/transco/emails";

const fieldClass =
  "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Where the email is being written from — filled in automatically. */
export interface EmailAbout {
  customerId?: string | null | undefined;
  customerName?: string | null | undefined;
  bookingId?: string | null | undefined;
  bookingCode?: string | null | undefined;
  /** The chat(s) to draft from (WhatsApp + linked website chats). */
  chatCustomerIds?: string[] | undefined;
}

let accountsCache: Promise<EmailAccounts> | null = null;
function loadAccounts(fresh = false) {
  if (!accountsCache || fresh) accountsCache = fetchEmailAccounts().catch((e) => {
    accountsCache = null;
    throw e;
  });
  return accountsCache;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

/** Answering an email thread — same account, same thread. */
export interface EmailReplyTo {
  threadOf: string;
  account: EmailAccount;
  to: string;
  subject: string;
}

export function ComposeEmailDialog({
  open,
  onClose,
  about,
  reply,
}: {
  open: boolean;
  onClose: () => void;
  about?: EmailAbout | undefined;
  reply?: EmailReplyTo | undefined;
}) {
  const [accounts, setAccounts] = useState<EmailAccounts | null>(null);
  const [account, setAccount] = useState<EmailAccount>("outlook");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [customer, setCustomer] = useState<{ id: string; name: string | null } | null>(null);
  const [noEmailOnFile, setNoEmailOnFile] = useState(false);
  const [suggestions, setSuggestions] = useState<EmailRecipient[]>([]);
  const [shot, setShot] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [aiDrafted, setAiDrafted] = useState(false);
  const [guess, setGuess] = useState<{ id: string; name: string | null; email: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const name = customer?.name ?? about?.customerName ?? null;

  useEffect(() => {
    if (!open) return;
    setTo("");
    setCc("");
    setShowCc(false);
    setSubject("");
    setBody("");
    setShot(null);
    setNote("");
    setAiDrafted(false);
    setGuess(null);
    setError(null);
    setNoEmailOnFile(false);
    setCustomer(about?.customerId ? { id: about.customerId, name: about.customerName ?? null } : null);
    loadAccounts(true)
      .then((a) => {
        setAccounts(a);
        setAccount(reply ? reply.account : a.outlook.usable ? "outlook" : "gmail");
      })
      .catch(() => setAccounts(null));
    if (reply) {
      setTo(reply.to);
      setSubject(/^re:/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject}`);
    } else if (about?.customerId) {
      fetchRecipients({ customerId: about.customerId })
        .then(({ recipients }) => {
          const r = recipients[0];
          if (r?.email) setTo(r.email);
          else setNoEmailOnFile(true);
          if (r) setCustomer({ id: r.id, name: r.name ?? about.customerName ?? null });
        })
        .catch(() => setNoEmailOnFile(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, about?.customerId, about?.customerName, reply?.threadOf]);

  // Customer search while typing in "To" (only when not already attached).
  useEffect(() => {
    if (!open || customer || to.includes("@") || to.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = window.setTimeout(() => {
      fetchRecipients({ q: to.trim() })
        .then((d) => setSuggestions(d.recipients))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [open, to, customer]);

  const usable: EmailAccount[] = accounts ? (["outlook", "gmail"] as const).filter((a) => accounts[a].usable) : [];
  const checksLeft = CHECK_RE.test(subject) || CHECK_RE.test(body);
  const canChat = (about?.chatCustomerIds?.length ?? 0) > 0 || !!reply;

  const applyTemplate = (key: string) => {
    const t = EMAIL_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    if (body.trim() && !window.confirm("Replace what's written with this template?")) return;
    const vars = { name, booking: about?.bookingCode ?? null };
    setSubject(fillTemplate(t.subject, vars));
    setBody(fillTemplate(t.body, vars));
    setAiDrafted(false);
  };

  const runDraft = async (fromShot: boolean) => {
    if (body.trim() && !window.confirm("Replace what's written with an AI draft?")) return;
    setError(null);
    setDrafting(true);
    try {
      const d = await draftEmail({
        customerId: customer?.id ?? about?.customerId ?? null,
        customerIds: fromShot ? [] : about?.chatCustomerIds ?? [],
        bookingId: about?.bookingId ?? null,
        image: fromShot ? shot : null,
        ...(note.trim() ? { note: note.trim() } : {}),
        threadOf: !fromShot && reply ? reply.threadOf : undefined,
      });
      setSubject(d.subject);
      setBody(d.body);
      setAiDrafted(true);
      if (!customer && d.customer) setGuess(d.customer);
      else if (!customer && !to && d.seen.email) setTo(d.seen.email);
      toast.success("Draft ready — check it before sending");
    } catch (err) {
      setError(err instanceof EmailError ? err.message : "Couldn't write a draft. Please try again.");
    } finally {
      setDrafting(false);
    }
  };

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!to.trim()) return setError("Add who the email is to.");
    if (!subject.trim()) return setError("Add a subject.");
    if (!body.trim()) return setError("Write the email.");
    if (checksLeft) return setError("Fill in every [check] before sending.");
    setSending(true);
    try {
      await sendEmail({
        account,
        to: to.trim(),
        cc: showCc && cc.trim() ? cc.trim() : undefined,
        subject: subject.trim(),
        body,
        customerId: customer?.id ?? null,
        customerName: name,
        bookingId: about?.bookingId ?? null,
        aiDrafted,
        threadOf: reply?.threadOf,
      });
      toast.success("Email sent ✓");
      onClose();
    } catch (err) {
      setError(err instanceof EmailError ? err.message : "Couldn't send. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl" onPaste={onPaste}>
        <DialogHeader>
          <DialogTitle>{reply ? "Reply" : "New email"}</DialogTitle>
          <DialogDescription>Nothing is sent until you press Send.</DialogDescription>
        </DialogHeader>

        {accounts && usable.length === 0 ? (
          <div className="rounded-lg bg-attention-soft px-3 py-3 text-sm text-attention-foreground">
            No email account is connected yet.{" "}
            {accounts.isAdmin ? (
              <Link to="/console/emails" className="font-semibold underline" onClick={onClose}>
                Connect Gmail on the Emails page
              </Link>
            ) : (
              "Ask the admin to connect one on the Emails page."
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-[5rem_1fr] sm:items-center">
              <label htmlFor="em-from" className="text-sm font-semibold text-foreground">
                From
              </label>
              <select id="em-from" value={account} onChange={(e) => setAccount(e.target.value as EmailAccount)} className={fieldClass} disabled={!accounts || !!reply}>
                {!accounts && <option>Loading…</option>}
                {usable.map((a) => (
                  <option key={a} value={a}>
                    {accounts?.[a].address} ({accountLabel(a)})
                  </option>
                ))}
              </select>

              <label htmlFor="em-to" className="text-sm font-semibold text-foreground">
                To
              </label>
              <div className="relative flex flex-col gap-1">
                {customer && (
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-foreground">
                    <UserRound className="h-3 w-3" aria-hidden /> {customer.name || "Customer"}
                    {!about?.customerId && (
                      <button type="button" aria-label="Remove customer" onClick={() => setCustomer(null)} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                )}
                <div className="flex gap-2">
                  <input
                    id="em-to"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder={customer ? "customer@email.com" : "Email, or search a customer by name or phone"}
                    autoComplete="off"
                    className={fieldClass}
                  />
                  {!showCc && (
                    <button type="button" onClick={() => setShowCc(true)} className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground">
                      + Cc
                    </button>
                  )}
                </div>
                {noEmailOnFile && !to && <p className="text-xs text-attention-foreground">No email saved for this customer — type it in.</p>}
                {suggestions.length > 0 && (
                  <ul className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
                    {suggestions.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setTo(r.email ?? "");
                            setCustomer({ id: r.id, name: r.name });
                            setSuggestions([]);
                          }}
                          className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-secondary"
                        >
                          <span className="font-medium text-foreground">{r.name || r.email}</span>
                          <span className="text-xs text-muted-foreground">
                            {[r.email, r.phone, r.code].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {showCc && (
                <>
                  <label htmlFor="em-cc" className="text-sm font-semibold text-foreground">
                    Cc
                  </label>
                  <input id="em-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional, separate with commas" className={fieldClass} />
                </>
              )}

              <label htmlFor="em-subject" className="text-sm font-semibold text-foreground">
                Subject
              </label>
              <input id="em-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={fieldClass} />
            </div>

            <div className="flex flex-col gap-2 rounded-lg border bg-secondary/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="em-template" className="sr-only">
                  Template
                </label>
                <select id="em-template" value="" onChange={(e) => applyTemplate(e.target.value)} className={cn(fieldClass, "w-auto")}>
                  <option value="">Use a template…</option>
                  {EMAIL_TEMPLATES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {accounts?.aiDrafts && canChat && (
                  <Button type="button" variant="outline" size="sm" disabled={drafting} onClick={() => void runDraft(false)}>
                    <Sparkles className="mr-1 h-4 w-4" aria-hidden /> {drafting && !shot ? "Writing…" : reply ? "Draft a reply" : "Draft from this chat"}
                  </Button>
                )}
                {accounts?.aiDrafts && (
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <ImageUp className="mr-1 h-4 w-4" aria-hidden /> {shot ? "Change screenshot" : "Draft from screenshot"}
                  </Button>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void takeImage(e.target.files?.[0])} />
              </div>
              {accounts?.aiDrafts && (
                <>
                  {shot && (
                    <div className="flex flex-col gap-2">
                      <img src={shot} alt="Chat screenshot" className="max-h-48 w-full rounded border bg-card object-contain" />
                      <div className="flex items-center gap-3">
                        <Button type="button" size="sm" disabled={drafting} onClick={() => void runDraft(true)}>
                          <Sparkles className="mr-1 h-4 w-4" aria-hidden /> {drafting ? "Reading…" : "Write the email"}
                        </Button>
                        <button type="button" onClick={() => setShot(null)} className="text-xs text-muted-foreground hover:text-foreground">
                          Remove screenshot
                        </button>
                      </div>
                    </div>
                  )}
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    placeholder="Optional note for the AI, e.g. “say sorry for the delay” or “write in Sinhala”"
                    className={cn(fieldClass, "text-xs")}
                  />
                  {!shot && <p className="text-xs text-muted-foreground">Tip: you can paste a screenshot (Ctrl+V) anywhere in this window.</p>}
                </>
              )}
            </div>

            {guess && !customer && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span>
                  Looks like <strong>{guess.name || guess.email}</strong>
                  {guess.email ? ` (${guess.email})` : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCustomer({ id: guess.id, name: guess.name });
                    if (guess.email) setTo(guess.email);
                    setGuess(null);
                  }}
                >
                  Use this customer
                </Button>
                <button type="button" onClick={() => setGuess(null)} className="text-xs text-muted-foreground hover:text-foreground">
                  Not them
                </button>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="em-body" className="sr-only">
                Email
              </label>
              <textarea id="em-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className={cn(fieldClass, "font-[inherit] leading-relaxed")} />
              {checksLeft && <p className="text-xs font-medium text-attention-foreground">Fill in each [check: …] before sending.</p>}
              {aiDrafted && !checksLeft && <p className="text-xs text-muted-foreground">AI draft — read it through before sending.</p>}
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-foreground">
                {error}
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={sending || drafting || checksLeft || !accounts}>
                <Mail className="mr-1 h-4 w-4" aria-hidden /> {sending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "✉ Email" — next to "+ Task" on a chat, booking or customer profile. */
export function EmailButton({ about, className, label = "Email", variant = "outline" }: { about?: EmailAbout; className?: string; label?: string; variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  if (!canSee("emails")) return null;
  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)} className={className}>
        <Mail className="mr-1 h-4 w-4" aria-hidden /> {label}
      </Button>
      <ComposeEmailDialog open={open} onClose={() => setOpen(false)} about={about} />
    </>
  );
}

export function fmtSentAt(iso: string) {
  return new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

const snippet = (body: string) => body.replace(/\s+/g, " ").trim().slice(0, 110);

/**
 * Gmail-style thread: the newest message (and any new replies) open, older
 * ones one line each — click to open. With more than 4, the middle ones
 * fold into "N earlier messages".
 */
function ThreadList({ items }: { items: ThreadItem[] }) {
  const last = items.length - 1;
  const [open, setOpen] = useState<Set<string>>(() => new Set(items.filter((it, i) => i === last || (it.kind === "reply" && !it.read)).map((it) => it.id)));
  const [showAll, setShowAll] = useState(items.length <= 4);
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // First, "N earlier", then the last two.
  const hidden = showAll ? 0 : items.length - 3;
  const shown = showAll ? items : [items[0]!, ...items.slice(-2)];

  return (
    <ol className="flex flex-col gap-2">
      {shown.map((it, i) => {
        const isOpen = open.has(it.id);
        const reply = it.kind === "reply";
        const who = reply ? it.fromName || it.fromAddress : it.sentByName;
        const when = fmtSentAt(reply ? it.receivedAt : it.sentAt);
        return (
          <li key={it.id} className="flex flex-col gap-2">
            {i === 1 && hidden > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="self-center rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {hidden} earlier {hidden === 1 ? "message" : "messages"}
              </button>
            )}
            <div className={cn("rounded-lg border", reply ? "mr-6 border-primary/30 bg-primary/5" : "ml-6 bg-secondary/30")}>
              <button type="button" onClick={() => toggle(it.id)} aria-expanded={isOpen} className="flex w-full items-baseline gap-2 px-3 py-2 text-left">
                <strong className="shrink-0 text-xs text-foreground">
                  {reply ? "↩ " : ""}
                  {who}
                </strong>
                {isOpen ? (
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {reply ? "replied" : `sent to ${it.to}${it.cc ? ` · cc ${it.cc}` : ""}`}
                    {!reply && it.aiDrafted ? " · ✨ AI draft" : ""}
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{snippet(it.body)}</span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {reply && !it.read && <span className="mr-1 font-semibold text-primary">new ·</span>}
                  {when}
                </span>
              </button>
              {isOpen && <div className="whitespace-pre-wrap px-3 pb-3 text-sm leading-relaxed text-foreground">{it.body}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** One email conversation: what we sent and the customer's replies, with Reply. */
export function EmailView({ email, onClose }: { email: SentEmail | null; onClose: () => void }) {
  const [items, setItems] = useState<ThreadItem[] | null>(null);
  const [replying, setReplying] = useState(false);
  const id = email?.id;

  useEffect(() => {
    if (!id) return;
    setItems(null);
    const load = () =>
      fetchThread(id)
        .then((d) => setItems(d.items))
        .catch(() => setItems([]));
    void load();
    window.addEventListener("transco:emails-changed", load);
    return () => window.removeEventListener("transco:emails-changed", load);
  }, [id]);

  const lastReply = [...(items ?? [])].reverse().find((i) => i.kind === "reply");

  return (
    <>
      <Dialog open={!!email && !replying} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {email && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6 text-left">{email.subject}</DialogTitle>
                <DialogDescription className="text-left">
                  {accountLabel(email.account)} · {email.fromAddress}
                </DialogDescription>
              </DialogHeader>
              {(email.customerId || email.bookingCode) && (
                <div className="flex flex-wrap gap-3 text-sm">
                  {email.customerId && (
                    <Link to="/console/customers/$customerId" params={{ customerId: email.customerId }} className="font-medium text-primary hover:underline" onClick={onClose}>
                      {email.customerName || "Customer"} →
                    </Link>
                  )}
                  {email.bookingCode && <span className="text-muted-foreground">Booking {email.bookingCode}</span>}
                </div>
              )}

              {!items ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                // Re-keyed when a message arrives, so the newest one opens.
                <ThreadList key={items.length} items={items.length ? items : [{ kind: "sent" as const, ...email }]} />
              )}

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Close
                </Button>
                <Button type="button" onClick={() => setReplying(true)}>
                  <Reply className="mr-1 h-4 w-4" aria-hidden /> Reply
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {email && (
        <ComposeEmailDialog
          open={replying}
          onClose={() => setReplying(false)}
          about={{ customerId: email.customerId, customerName: email.customerName, bookingId: email.bookingId, bookingCode: email.bookingCode }}
          reply={{
            threadOf: email.id,
            account: email.account,
            to: lastReply && lastReply.kind === "reply" ? lastReply.fromAddress : email.to,
            subject: email.subject,
          }}
        />
      )}
    </>
  );
}

/** "↩ 2 replies" on an email row — bold when some are new. */
export function RepliesTag({ email }: { email: SentEmail }) {
  if (!email.replies) return null;
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs",
        email.unreadReplies ? "bg-primary font-semibold text-primary-foreground" : "bg-secondary text-muted-foreground",
      )}
    >
      ↩ {email.replies} {email.replies === 1 ? "reply" : "replies"}
      {email.unreadReplies ? ` · ${email.unreadReplies} new` : ""}
    </span>
  );
}

/** Unread customer email replies — the Emails menu badge. */
export function useUnreadEmailReplies() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!canSee("emails")) return;
    let alive = true;
    const load = () =>
      fetchUnreadReplies()
        .then((d) => alive && setCount(d.count))
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 60 * 1000);
    window.addEventListener("transco:email-replies-read", load);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.removeEventListener("transco:email-replies-read", load);
    };
  }, []);
  return count;
}

/** Emails sent to this customer — on the customer profile. */
export function CustomerEmails({ customerIds }: { customerIds: string[] }) {
  const [emails, setEmails] = useState<SentEmail[] | null>(null);
  const [open, setOpen] = useState<SentEmail | null>(null);
  const key = customerIds.join(",");

  useEffect(() => {
    if (!key || !canSee("emails")) return;
    const load = () =>
      fetchEmails({ customerId: key })
        .then((d) => setEmails(d.emails))
        .catch(() => setEmails([]));
    void load();
    window.addEventListener("transco:emails-changed", load);
    window.addEventListener("transco:email-replies-read", load);
    return () => {
      window.removeEventListener("transco:emails-changed", load);
      window.removeEventListener("transco:email-replies-read", load);
    };
  }, [key]);

  if (!canSee("emails") || !key) return null;
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Emails</h2>
      {!emails ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : emails.length === 0 ? (
        <p className="text-sm text-muted-foreground">No emails sent yet.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {emails.slice(0, 10).map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => setOpen(e)} className="flex w-full flex-col gap-0.5 py-2 text-left hover:bg-secondary/40">
                <span className="text-sm font-medium text-foreground">
                  ✉ {e.subject}
                  <RepliesTag email={e} />
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmtSentAt(e.sentAt)} · {accountLabel(e.account)} · {e.sentByName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <EmailView email={open} onClose={() => setOpen(null)} />
    </section>
  );
}
