import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MessagesSquare, Pencil, Plus, Search, Trash2 } from "lucide-react";

import { PageHeader, PageShell } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createAgentFaq,
  deleteAgentFaq,
  fetchAgentFaqs,
  updateAgentFaq,
  type AgentFaq,
  type AgentFaqInput,
} from "@/lib/transco/api";

// The bot's questions & answers (agentKnowledge.js → agentFaqs): one card
// each. The bot answers these itself (WhatsApp and website) without
// passing the chat to staff. Switched-off ones are kept but not used.
export const Route = createFileRoute("/console/ai/faqs")({
  component: BotFaqPage,
});

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }) : "";

function BotFaqPage() {
  const [faqs, setFaqs] = useState<AgentFaq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchAgentFaqs()
      .then(setFaqs)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the questions"));
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!faqs) return [];
    if (!q) return faqs;
    return faqs.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q));
  }, [faqs, search]);

  const replace = (f: AgentFaq) => setFaqs((list) => (list ?? []).map((x) => (x.id === f.id ? f : x)));

  return (
    <PageShell>
      <PageHeader
        icon={MessagesSquare}
        title="Bot Q&A"
        description="Questions the bot answers by itself, on WhatsApp and the website — without passing the chat to staff."
      />

      <div className="mb-6 rounded-xl border bg-secondary/40 p-4 text-sm text-muted-foreground">
        <p className="mb-1.5 font-medium text-foreground">💡 Tips</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Write the question the way customers ask it, and the answer exactly as you'd send it.</li>
          <li>The bot also understands other wordings and answers in Sinhala or Tamil when the customer writes in them.</li>
          <li>Switch one off to stop the bot using it without deleting it. Changes work from the next message.</li>
          <li>
            General information (hours, packing, customs…) is on{" "}
            <Link to="/console/ai/agent" className="underline underline-offset-2">Agent Transco</Link>.
          </li>
        </ul>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions and answers" className="pl-9" />
        </div>
        <Button type="button" className="gap-1.5" onClick={() => setAdding(true)} disabled={adding}>
          <Plus className="h-4 w-4" /> Add question
        </Button>
      </div>

      {adding && (
        <FaqEditor
          initial={{ question: "", answer: "", enabled: true }}
          onCancel={() => setAdding(false)}
          onSave={async (body) => {
            const f = await createAgentFaq(body);
            setFaqs((list) => [f, ...(list ?? [])]);
            setAdding(false);
          }}
        />
      )}

      {!faqs ? (
        <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{faqs.length === 0 ? "No questions yet — add the first one." : "Nothing matches your search."}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {shown.length} of {faqs.length} · {faqs.filter((f) => f.enabled).length} switched on
          </p>
          {shown.map((f) => (
            <FaqCard
              key={f.id}
              faq={f}
              onChange={replace}
              onDelete={() => setFaqs((list) => (list ?? []).filter((x) => x.id !== f.id))}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function FaqCard({ faq, onChange, onDelete }: { faq: AgentFaq; onChange: (f: AgentFaq) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <FaqEditor
        initial={{ question: faq.question, answer: faq.answer, enabled: faq.enabled }}
        onCancel={() => setEditing(false)}
        onSave={async (body) => {
          onChange(await updateAgentFaq(faq.id, body));
          setEditing(false);
        }}
      />
    );
  }

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await updateAgentFaq(faq.id, { question: faq.question, answer: faq.answer, enabled }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete this question?\n\n"${faq.question}"`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAgentFaq(faq.id);
      onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setBusy(false);
    }
  };

  return (
    <Card className={faq.enabled ? "" : "opacity-60"}>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="font-medium text-foreground">
            <span className="mr-1.5 text-muted-foreground">Q</span>
            {faq.question}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <label className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch checked={faq.enabled} disabled={busy} onCheckedChange={toggle} aria-label="Bot uses this answer" />
              {faq.enabled ? "On" : "Off"}
            </label>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={busy} onClick={() => setEditing(true)} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" disabled={busy} onClick={remove} aria-label="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          <span className="mr-1.5 font-medium">A</span>
          {faq.answer}
        </p>
        <p className="text-xs text-muted-foreground/80">
          {faq.updatedAt ? `Updated ${when(faq.updatedAt)}` : ""}
          {faq.updatedBy ? ` by ${faq.updatedBy}` : ""}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function FaqEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: AgentFaqInput;
  onSave: (body: AgentFaqInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState(initial.question);
  const [answer, setAnswer] = useState(initial.answer);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ question: question.trim(), answer: answer.trim(), enabled: initial.enabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  return (
    <Card className="mb-3 border-primary/40">
      <CardContent className="flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Question</span>
          <Input value={question} maxLength={500} autoFocus onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Can I send medicine?" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Answer</span>
          <Textarea
            value={answer}
            maxLength={2000}
            rows={Math.min(10, Math.max(3, answer.split("\n").length + 1))}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="The answer exactly as you'd send it to the customer"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={saving || !question.trim() || !answer.trim()} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
