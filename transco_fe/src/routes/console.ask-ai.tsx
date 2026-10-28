import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RotateCcw, SendHorizontal, WandSparkles } from "lucide-react";

import { PageHeader, PageShell } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askAi } from "@/lib/transco/api";

// Ask AI: staff type a caller's question and get the bot's answer with
// prices, from the same facts the WhatsApp/website bot uses. Nothing is
// saved or sent to anyone — the chat lives only on this page.
export const Route = createFileRoute("/console/ask-ai")({
  component: AskAiPage,
});

type Turn = { from: "staff" | "ai"; text: string; unsure?: boolean };

const newSession = () => Math.random().toString(36).slice(2, 12);
const EXAMPLE ="2 gift boxes to Colombo, plus 3 more boxes including a tree, with collection from Colombo. How much?";

function AskAiPage() {
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
    <PageShell width="narrow">
      <PageHeader
        icon={WandSparkles}
        title="Ask AI"
        description="Type a customer's question — from a call or the counter — and get the prices straight away. Only you see this chat."
        actions={
          turns.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => { setTurns([]); setError(null); setSessionId(newSession()); }} disabled={busy}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> New question
            </Button>
          )
        }
      />

      <div className="mt-4 flex min-h-[50vh] flex-col gap-3 rounded-xl border bg-card p-4">
        {turns.length === 0 && !busy && (
          <div className="m-auto max-w-md text-center text-sm text-muted-foreground">
            <p>Ask anything a customer would: prices, box sizes, a TV, a bicycle, delivery to Kandy…</p>
            <button
              type="button"
              className="mt-3 rounded-full border px-3 py-1.5 text-xs hover:bg-muted"
              onClick={() => setText(EXAMPLE)}
            >
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

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-3 flex items-end gap-2">
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
        <Button onClick={() => void send()} disabled={busy || !text.trim()} className="h-15">
          <SendHorizontal className="h-4 w-4" />
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </PageShell>
  );
}
