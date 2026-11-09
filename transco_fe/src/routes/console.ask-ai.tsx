import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft, Check, ClipboardPaste, Copy, Loader2, Mic, Pencil, Plus, RotateCcw, Search, SendHorizontal, Sparkles, Trash2, UserPlus, UserRound, WandSparkles, X,
} from "lucide-react";

import { PageHeader, PageShell } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addAiThreadMessage, askAi, createAiThread, editAiThreadMessage, fetchAiThread, fetchAiThreads,
  hearVoiceNote, importAiThreadMessages, saveAiThreadCustomer, suggestAiThreadReply, updateAiThread,
  type AiThread, type AiThreadMessage, type AiThreadRow,
} from "@/lib/transco/api";
import { parseWhatsAppPaste, senderIsPhone } from "@/lib/transco/whatsapp-paste";

// Ask AI: staff get the bot's answer with prices, from the same facts the
// WhatsApp/website bot uses. "Quick question" is not saved. Customer
// chats are saved (shared by all staff): paste what an office-WhatsApp
// customer wrote, and the AI's suggestion reads that customer's earlier
// messages. Nothing here is sent to the customer.
export const Route = createFileRoute("/console/ask-ai")({
  component: AskAiPage,
});

const QUICK = "quick";

function AskAiPage() {
  const [threads, setThreads] = useState<AiThreadRow[]>([]);
  const [selected, setSelected] = useState<string>(QUICK);
  // Phones show the list or the chat, not both.
  const [showChat, setShowChat] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  // Bumped after a paste so the open chat reloads; notice says what was added.
  const [reloadTick, setReloadTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      setThreads(await fetchAiThreads());
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load the customer chats.");
    }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);

  const open = (id: string) => { setSelected(id); setShowChat(true); setAdding(false); setNotice(null); };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    const qd = q.replace(/\D/g, "");
    return threads.filter((t) => t.name.toLowerCase().includes(q) || (qd && t.phone.replace(/\D/g, "").includes(qd)));
  }, [threads, search]);

  return (
    <PageShell width="full">
      <PageHeader
        icon={WandSparkles}
        title="Ask AI"
        description="Get the prices and a reply straight away. Customer chats remember what each office-WhatsApp customer said before — paste their messages in."
      />

      <div className="mt-4 grid h-[calc(100vh-13rem)] min-h-120 overflow-hidden rounded-xl border bg-card md:grid-cols-[300px_1fr]">
        {/* Chat list */}
        <aside className={`flex min-h-0 flex-col border-r ${showChat ? "hidden md:flex" : "flex"}`}>
          <div className="space-y-2 border-b p-3">
            <Button size="sm" className="w-full" onClick={() => setPasting(true)}>
              <ClipboardPaste className="mr-1.5 h-4 w-4" /> Paste from WhatsApp
            </Button>
            <Button size="sm" variant="outline" className="w-full" onClick={() => setAdding((a) => !a)}>
              <Plus className="mr-1.5 h-4 w-4" /> New customer chat
            </Button>
            {adding && <NewThreadForm onDone={async (id) => { await loadList(); open(id); }} onCancel={() => setAdding(false)} />}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" className="h-9 pl-8" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ListRow
              active={selected === QUICK}
              onClick={() => open(QUICK)}
              icon={<Sparkles className="h-4 w-4" />}
              title="Quick question"
              preview="Not saved — for a phone call or the counter"
            />
            {listError && <p className="p-3 text-sm text-destructive">{listError}</p>}
            {shown.map((t) => (
              <ListRow
                key={t._id}
                active={selected === t._id}
                onClick={() => open(t._id)}
                icon={<UserRound className="h-4 w-4" />}
                title={t.name || t.phone}
                time={listTime(t.updatedAt)}
                preview={t.last ? (t.last.from === "us" ? "You: " : "") + t.last.text : t.phone || "No messages yet"}
              />
            ))}
            {threads.length > 0 && shown.length === 0 && <p className="p-3 text-sm text-muted-foreground">No chat matches “{search}”.</p>}
          </div>
        </aside>

        {/* Chat */}
        <section className={`min-h-0 flex-col ${showChat ? "flex" : "hidden md:flex"}`}>
          {selected === QUICK ? (
            <QuickChat onBack={() => setShowChat(false)} />
          ) : (
            <ThreadChat
              key={`${selected}:${reloadTick}`}
              id={selected}
              notice={notice}
              onBack={() => setShowChat(false)}
              onChanged={loadList}
              onDeleted={() => { setSelected(QUICK); setShowChat(false); void loadList(); }}
            />
          )}
        </section>
      </div>

      <PasteDialog
        open={pasting}
        onOpenChange={setPasting}
        threads={threads}
        currentId={selected === QUICK ? null : selected}
        onDone={async (id, message) => {
          setPasting(false);
          await loadList();
          open(id);
          setNotice(message);
          setReloadTick((n) => n + 1);
        }}
      />
    </PageShell>
  );
}

function ListRow({ active, onClick, icon, title, time, preview }: {
  active: boolean; onClick: () => void; icon: ReactNode; title: string; time?: string; preview: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b px-3 py-2.5 text-left hover:bg-muted/60 ${active ? "bg-muted" : ""}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold">{title}</span>
          {time && <span className="shrink-0 text-xs text-muted-foreground">{time}</span>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{preview}</span>
      </span>
    </button>
  );
}

function NewThreadForm({ onDone, onCancel }: { onDone: (id: string) => void | Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await createAiThread(name, phone);
      await onDone(r.thread._id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the chat.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border bg-background p-2.5">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" className="h-9" autoFocus />
      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="WhatsApp number" inputMode="tel" className="h-9" />
      <p className="text-xs text-muted-foreground">Same number again opens their existing chat.</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy || (!name.trim() && !phone.trim())}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start chat"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ---- Paste from WhatsApp ----
// Staff copy several messages in WhatsApp and paste them here. Nothing is
// saved until they check who is who and which chat it goes to.

const NEW = "new";
const looksLikeUs = (sender: string) => /transco|^you$/i.test(sender);
const phoneTail = (v: string) => v.replace(/\D/g, "").slice(-9);
const PLAIN = "";
// "…Thanks\nMarina" → "Marina": a short last line of only letters is
// usually the customer's name. Only a suggestion — staff can change it.
function signOffName(text: string) {
  const last = text.trim().split("\n").pop()?.trim() ?? "";
  return /^[A-Za-z][A-Za-z .'-]{1,24}$/.test(last) && last.split(/\s+/).length <= 3 && !/^(thanks?|thank you|regards|cheers|ok|okay)$/i.test(last)
    ? last
    : "";
}

function PasteDialog({ open, onOpenChange, threads, currentId, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threads: AiThreadRow[];
  currentId: string | null;
  onDone: (threadId: string, notice: string) => void | Promise<void>;
}) {
  const [text, setText] = useState("");
  // Staff choices; null = use the guess.
  const [roles, setRoles] = useState<Record<string, "customer" | "us">>({});
  const [target, setTarget] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [newPhone, setNewPhone] = useState<string | null>(null);
  const [askAiToo, setAskAiToo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setText(""); setRoles({}); setTarget(null); setNewName(null); setNewPhone(null); setAskAiToo(true); setError(null);
    }
  }, [open]);

  // Copying one message (e.g. on WhatsApp Web) gives only its text, with
  // no name or time — that's saved as one message, timed now.
  const found = useMemo(() => parseWhatsAppPaste(text), [text]);
  const plain = found.length === 0 && !!text.trim();
  const parsed = useMemo(() => (plain ? [{ sender: PLAIN, text: text.trim(), at: null }] : found), [plain, found, text]);
  const senders = useMemo(() => [...new Set(parsed.map((m) => m.sender))], [parsed]);
  const roleOf = (s: string) => roles[s] ?? (looksLikeUs(s) ? "us" : "customer");
  const customers = senders.filter((s) => roleOf(s) === "customer");
  const who = plain ? (roleOf(PLAIN) === "customer" ? signOffName(text) : "") : customers[0] || "";
  const whoIsPhone = senderIsPhone(who);

  const match = who
    ? threads.find((t) => (whoIsPhone ? t.phone && phoneTail(t.phone) === phoneTail(who) : t.name.trim().toLowerCase() === who.toLowerCase()))
    : undefined;
  const chosen = target ?? currentId ?? match?._id ?? NEW;
  const chosenThread = threads.find((t) => t._id === chosen);
  const name = newName ?? (whoIsPhone ? "" : who);
  const phone = newPhone ?? (whoIsPhone ? who : "");
  const first = parsed[0];
  const lastParsed = parsed[parsed.length - 1];
  const lastIsCustomer = !!lastParsed && roleOf(lastParsed.sender) === "customer";
  const otherName =
    !plain && chosenThread && who && !whoIsPhone && chosenThread.name && chosenThread.name.trim().toLowerCase() !== who.toLowerCase();

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let id = chosen;
      let existed = false;
      if (id === NEW) {
        const r = await createAiThread(name, phone);
        id = r.thread._id;
        existed = !!r.existed;
      }
      const r = await importAiThreadMessages(
        id,
        parsed.map((m) => ({ from: roleOf(m.sender), text: m.text, at: m.at })),
        askAiToo && lastIsCustomer,
      );
      const parts = [
        existed ? "That number already had a chat, so they were added there." : "",
        `Added ${r.added} message${r.added === 1 ? "" : "s"}.`,
        r.skipped ? `${r.skipped} ${r.skipped === 1 ? "was" : "were"} already in the chat.` : "",
        r.aiError || "",
      ];
      await onDone(id, parts.filter(Boolean).join(" "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the messages.");
    } finally {
      setBusy(false);
    }
  };

  const fmt = (iso: string | null) => (iso ? `${listTime(iso)} ${timeLabel(iso)}` : "");

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paste from WhatsApp</DialogTitle>
          <DialogDescription>
            Copy the customer's message in WhatsApp Web or the WhatsApp app and paste it here (Ctrl+V).
            To bring several messages with their times, drag the mouse across them in WhatsApp Web, then Ctrl+C.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the WhatsApp message here (Ctrl+V)"
          rows={5}
          className="resize-y text-sm"
          autoFocus
        />

        {parsed.length > 0 && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {plain ? (
                <>One message — saved with the time now.</>
              ) : (
                <>
                  Found <b className="text-foreground">{parsed.length}</b> message{parsed.length === 1 ? "" : "s"} · {fmt(first?.at ?? null)}
                  {parsed.length > 1 && <> – {fmt(lastParsed?.at ?? null)}</>}
                </>
              )}
            </p>

            <div className="space-y-1.5">
              <p className="font-medium">{plain ? "This message is from" : "Who is who?"}</p>
              {senders.map((s) => (
                <div key={s} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
                  <span className="truncate">{s === PLAIN ? "The pasted message" : s}</span>
                  <span className="flex shrink-0 overflow-hidden rounded-md border text-xs">
                    {(["customer", "us"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRoles((x) => ({ ...x, [s]: r }))}
                        className={`px-2.5 py-1 ${roleOf(s) === r ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                      >
                        {r === "customer" ? "Customer" : "Us (Transco)"}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
              {!plain && customers.length === 0 && <p className="text-amber-700 dark:text-amber-400">Mark which name is the customer.</p>}
              {customers.length > 1 && <p className="text-amber-700 dark:text-amber-400">More than one name is marked as the customer — check this is one person's chat.</p>}
            </div>

            <div className="space-y-1.5">
              <p className="font-medium">Add to</p>
              <select
                value={chosen}
                onChange={(e) => setTarget(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value={NEW}>+ New customer chat</option>
                {threads.map((t) => (
                  <option key={t._id} value={t._id}>{t.name || t.phone}{t.name && t.phone ? ` · ${t.phone}` : ""}</option>
                ))}
              </select>
              {chosen === NEW && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={name} onChange={(e) => setNewName(e.target.value)} placeholder="Customer name" className="h-9" />
                  <Input value={phone} onChange={(e) => setNewPhone(e.target.value)} placeholder="WhatsApp number (if you have it)" inputMode="tel" className="h-9" />
                </div>
              )}
              {otherName && (
                <p className="text-amber-700 dark:text-amber-400">
                  The messages are from “{who}” but this chat is “{chosenThread?.name}”. Make sure it's the same person.
                </p>
              )}
            </div>

            {lastIsCustomer && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={askAiToo} onChange={(e) => setAskAiToo(e.target.checked)} className="h-4 w-4" />
                Ask AI for a reply to the last message
              </label>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => void save()}
            disabled={busy || parsed.length === 0 || (!plain && customers.length === 0) || (chosen === NEW && !name.trim() && !phone.trim())}
          >
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {busy && askAiToo && lastIsCustomer ? "Saving and asking AI…" : `Add ${parsed.length || ""} message${parsed.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChatHeader({ onBack, title, sub, actions }: { onBack: () => void; title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2.5">
      <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        <span className="sr-only">Back to chats</span>
      </Button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

// ---- Quick question (not saved) ----

type Turn = { from: "staff" | "ai"; text: string; unsure?: boolean };

const newSession = () => Math.random().toString(36).slice(2, 12);
const EXAMPLE = "2 gift boxes to Colombo, plus 3 more boxes including a tree, with collection from Colombo. How much?";

function QuickChat({ onBack }: { onBack: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "New question" starts a fresh chat, so the bot forgets the last one.
  const [sessionId, setSessionId] = useState(newSession);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const send = async () => {
    const question = text.trim();
    if (!question || busy) return;
    setTurns((t) => [...t, { from: "staff", text: question }]);
    setText("");
    setError(null);
    setBusy(true);
    try {
      const r = await askAi(question, sessionId);
      setTurns((t) => [...t, { from: "ai", text: r.reply, unsure: r.unsure }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The AI could not answer just now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ChatHeader
        onBack={onBack}
        title="Quick question"
        sub="Only you see this chat. Not saved."
        actions={
          turns.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => { setTurns([]); setError(null); setSessionId(newSession()); }} disabled={busy}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> New question
            </Button>
          )
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {turns.length === 0 && !busy && (
          <div className="m-auto max-w-md text-center text-sm text-muted-foreground">
            <p>Ask anything a customer would: prices, box sizes, a TV, a bicycle, delivery to Kandy…</p>
            <button type="button" className="mt-3 rounded-full border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setText(EXAMPLE)}>
              Try: “{EXAMPLE}”
            </button>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.from === "staff" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                t.from === "staff"
                  ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                  : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm"
              }
            >
              {t.text}
              {t.unsure && <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">Not fully sure — double-check before quoting.</p>}
              {t.from === "ai" && (
                <div className="mt-1.5 flex justify-end">
                  <CopyReply text={t.text} />
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Working out the prices…
          </div>
        )}
        <div ref={endRef} />
      </div>
      {error && <p className="px-3 pb-1 text-sm text-destructive">{error}</p>}
      <div className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Type the customer's question…"
          rows={2}
          className="min-h-15 flex-1 resize-none"
        />
        <VoiceNoteButton disabled={busy} className="h-15" onHeard={(t) => setText((cur) => addHeard(cur, t))} onError={setError} />
        <Button onClick={() => void send()} disabled={busy || !text.trim()} className="h-15">
          <SendHorizontal className="h-4 w-4" />
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </>
  );
}

// A customer's voice note from the office WhatsApp Web (⌄ → Download) →
// what they said, put in the box for staff to check before asking the AI.
// Picked by file extension because browsers name these types differently.
const VOICE_TYPES: Record<string, string> = {
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4",
  mp3: "audio/mpeg", aac: "audio/aac", wav: "audio/wav", webm: "audio/webm",
};

function addHeard(current: string, heard: string) {
  return current.trim() ? `${current.trim()}\n${heard}` : heard;
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function VoiceNoteButton({ disabled, className, onHeard, onError }: {
  disabled?: boolean;
  className?: string;
  onHeard: (text: string) => void;
  onError: (message: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    onError(null);
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const r = await hearVoiceNote({ data: await fileBase64(file), mimeType: VOICE_TYPES[ext] || file.type || "audio/ogg" });
      if (r.text) onHeard(r.text);
      if (!r.text) onError("Couldn't make out the voice note. Please listen and type it.");
      else if (r.unsure) onError("Not fully sure what was said — listen and fix the words before asking.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not listen to the voice note.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="audio/*,.ogg,.opus,.m4a" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        className={className}
        title="Pick a voice note you downloaded from WhatsApp Web"
      >
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mic className="mr-1.5 h-4 w-4" />}
        {busy ? "Listening…" : "Voice note"}
      </Button>
    </>
  );
}

// Copies the AI's reply, ready to paste into WhatsApp for the customer.
function CopyReply({ text }: { text: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState(""), 2000);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
    >
      {state === "copied" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Select the text to copy" : "Copy reply"}
    </button>
  );
}

// ---- Customer chat (saved) ----

function ThreadChat({ id, notice, onBack, onChanged, onDeleted }: {
  id: string; notice: string | null; onBack: () => void; onChanged: () => void; onDeleted: () => void;
}) {
  const [thread, setThread] = useState<AiThread | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "customer" | "us" | "again">("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAiThread(id).then(setThread).catch((err) => setError(err instanceof Error ? err.message : "Could not load the chat."));
  }, [id]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread?.messages.length, busy]);

  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const update = (t: AiThread) => { setThread(t); onChanged(); };

  const add = async (from: "customer" | "us") => {
    const msg = text.trim();
    if (!msg || busy) return;
    setBusy(from);
    setError(null);
    try {
      const r = await addAiThreadMessage(id, msg, from, from === "customer");
      setText("");
      update(r.thread);
      if (r.aiError) setError(r.aiError);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the message.");
    } finally {
      setBusy("");
    }
  };

  const again = async () => {
    setBusy("again");
    setError(null);
    try {
      update(await suggestAiThreadReply(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The AI could not answer just now.");
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!thread || !window.confirm(`Remove the chat with ${thread.name || thread.phone}? It will no longer show in the list.`)) return;
    try {
      await updateAiThread(id, { deleted: true });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the chat.");
    }
  };

  if (!thread) {
    return (
      <>
        <ChatHeader onBack={onBack} title="Loading…" />
        <div className="m-auto text-sm text-muted-foreground">
          {error ? <span className="text-destructive">{error}</span> : <Loader2 className="h-5 w-5 animate-spin" />}
        </div>
      </>
    );
  }

  const last = thread.messages[thread.messages.length - 1];

  return (
    <>
      <ChatHeader
        onBack={onBack}
        title={thread.name || thread.phone}
        sub={thread.name && thread.phone ? thread.phone : "Office WhatsApp customer"}
        actions={
          <>
            {thread.customerId ? (
              <Link
                to="/console/customers/$customerId"
                params={{ customerId: thread.customerId }}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                title="Open their customer profile"
              >
                <UserRound className="h-3.5 w-3.5" /> {thread.customerName || "Customer"}
              </Link>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSaving((s) => !s)}>
                <UserPlus className="mr-1.5 h-4 w-4" /> Save as customer
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => void remove()} title="Remove chat">
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Remove chat</span>
            </Button>
          </>
        }
      />
      {saving && !thread.customerId && (
        <SaveCustomerForm
          thread={thread}
          onCancel={() => setSaving(false)}
          onSaved={(t, msg) => { setSaving(false); update(t); setSaveNotice(msg); }}
        />
      )}
      {(saveNotice || notice) && (
        <p className="border-b bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">{saveNotice || notice}</p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-muted/30 p-4">
        {thread.messages.length === 0 && (
          <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            <p>Paste what the customer wrote on WhatsApp and press <b>Customer said → Ask AI</b>.</p>
            <p className="mt-2">Paste what you sent them with <b>We sent</b>, so the AI knows the whole chat next time.</p>
          </div>
        )}
        {thread.messages.map((m, i) => {
          const prev = thread.messages[i - 1];
          const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-2 flex justify-center">
                  <span className="rounded-md bg-background px-2.5 py-0.5 text-xs text-muted-foreground shadow-sm">{dayLabel(m.at)}</span>
                </div>
              )}
              <Bubble m={m} threadId={id} onSaved={update} onError={setError} />
            </div>
          );
        })}
        {busy && busy !== "us" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the chat and working out a reply…
          </div>
        )}
        <div ref={endRef} />
      </div>
      {error && <p className="px-3 pb-1 pt-2 text-sm text-destructive">{error}</p>}
      {last?.from === "customer" && !busy && (
        <div className="px-3 pt-2">
          <Button variant="outline" size="sm" onClick={() => void again()}>
            <Sparkles className="mr-1.5 h-4 w-4" /> Ask AI again
          </Button>
        </div>
      )}
      <div className="space-y-2 border-t p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void add("customer");
            }
          }}
          placeholder="Paste the customer's WhatsApp message…"
          rows={2}
          className="min-h-15 resize-none"
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void add("customer")} disabled={!!busy || !text.trim()}>
            {busy === "customer" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            Customer said → Ask AI
          </Button>
          <Button variant="outline" onClick={() => void add("us")} disabled={!!busy || !text.trim()}>
            {busy === "us" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <SendHorizontal className="mr-1.5 h-4 w-4" />}
            We sent
          </Button>
          <VoiceNoteButton disabled={!!busy} onHeard={(t) => setText((cur) => addHeard(cur, t))} onError={setError} />
        </div>
      </div>
    </>
  );
}

// Adds this person to Customers. If their number is already saved, the
// chat is linked to that customer instead — never a second record.
function SaveCustomerForm({ thread, onCancel, onSaved }: {
  thread: AiThread; onCancel: () => void; onSaved: (t: AiThread, notice: string) => void;
}) {
  const [name, setName] = useState(thread.name);
  const [phone, setPhone] = useState(thread.phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await saveAiThreadCustomer(thread._id, name, phone);
      onSaved(
        r.thread,
        r.existed
          ? `This number is already a customer (${r.customer.name}) — the chat is now linked to them. No new customer was made.`
          : `Saved ${r.customer.name} as a new customer (Customers → Added by staff).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the customer.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 border-b bg-muted/40 px-3 py-2.5 text-sm">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" className="h-9" />
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="WhatsApp number" inputMode="tel" className="h-9" />
        <Button size="sm" className="h-9" onClick={() => void save()} disabled={busy || !name.trim() || !phone.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-9" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-xs text-muted-foreground">If this number is already saved, the chat is linked to that customer instead of making a new one.</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Bubble({ m, threadId, onSaved, onError }: {
  m: AiThreadMessage; threadId: string; onSaved: (t: AiThread) => void; onError: (e: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const [copied, setCopied] = useState(false);
  const ours = m.from === "us";

  const save = async (body: { text?: string; remove?: boolean }) => {
    try {
      onSaved(await editAiThreadMessage(threadId, m.id, body));
      setEditing(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save.");
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError("Could not copy — select the text and copy it instead.");
    }
  };

  return (
    <div className={`group flex ${ours ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
          ours ? "rounded-br-sm bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-50" : "rounded-bl-sm bg-background"
        }`}
      >
        {m.ai && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">AI suggestion</p>}
        {editing ? (
          <div className="space-y-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} className="min-w-60 bg-background text-sm" autoFocus />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save({ text: draft })} disabled={!draft.trim()}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(m.text); setEditing(false); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap">{m.text}</p>
        )}
        {m.unsure && !editing && <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">Not fully sure — double-check before sending.</p>}
        {m.ai && !editing && (
          <div className="mt-1.5">
            <CopyReply text={m.text} />
          </div>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          {!editing && (
            <span className="flex gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100">
              {ours && (
                <IconBtn label={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </IconBtn>
              )}
              <IconBtn label="Edit" onClick={() => { setDraft(m.text); setEditing(true); }}><Pencil className="h-3.5 w-3.5" /></IconBtn>
              <IconBtn label="Remove" onClick={() => { if (window.confirm("Remove this message from the chat?")) void save({ remove: true }); }}>
                <X className="h-3.5 w-3.5" />
              </IconBtn>
            </span>
          )}
          <span>{m.editedBy ? "edited · " : ""}{timeLabel(m.at)}</span>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10">
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
function listTime(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? timeLabel(iso) : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
