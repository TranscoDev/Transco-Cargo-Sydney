import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Package, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { createTask, firstName, TaskError, useTasks, waitedFor, type StaffTask } from "@/lib/transco/tasks";
import type { Conversation, ConversationSummary } from "@/lib/transco/types";

import { TaskDetailsDialog } from "./task-kit";

/**
 * "Ask Warehouse" from a customer chat (step 2 of staff tasks). A question
 * becomes an ordinary warehouse team task with the customer attached; the
 * warehouse answers with a comment, and the answer shows above the
 * message box with "Use in reply". Nothing is ever sent to the customer
 * automatically. If tasks can't load, these pieces simply don't show.
 */

const QUICK_PICKS = ["Has it arrived?", "Weight / size?", "Send a photo", "Can it go on the next shipment?"];

type ChatLike = Pick<Conversation, "id" | "customerName" | "linkedAccount"> & { mergedIds?: string[] | undefined };

/** Every customer record this chat stands for (merged WhatsApp + website, signed-in account). */
function customerIds(c: ChatLike): string[] {
  return [c.id, c.linkedAccount?.id, ...(c.mergedIds ?? [])].filter((x): x is string => !!x);
}

/** The latest comment from someone other than the person who asked. */
export function warehouseAnswer(task: StaffTask) {
  return [...task.comments].reverse().find((c) => c.byId !== task.createdById) ?? null;
}

/** The question without the "Customer name: " the task title starts with. */
function questionOf(task: StaffTask) {
  const prefix = `${task.customerName ?? ""}: `;
  return task.customerName && task.title.startsWith(prefix) ? task.title.slice(prefix.length) : task.title;
}

/** Warehouse questions about this customer, newest first. */
export function useWarehouseQuestions(chat: ChatLike): StaffTask[] {
  const { tasks } = useTasks();
  const key = customerIds(chat).join(",");
  return useMemo(() => {
    const ids = new Set(key.split(","));
    return tasks
      .filter((t) => t.assignTo === "team" && t.customerId && ids.has(t.customerId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tasks, key]);
}

// ---------------------------------------------------------------
// Button + ask window (chat header)
// ---------------------------------------------------------------

export function AskWarehouseButton({ conversation }: { conversation: Conversation }) {
  const { me } = useTasks();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuestion(QUICK_PICKS[0] ?? "");
      setError(null);
    }
  }, [open]);

  // Tasks not reachable → no button, nothing else affected.
  if (!me) return null;

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return setError("Write the question for the warehouse.");
    setSaving(true);
    setError(null);
    try {
      await createTask({
        title: `${conversation.customerName}: ${q}`.slice(0, 120),
        assignTo: "team",
        customerId: conversation.linkedAccount?.id ?? conversation.id,
        customerName: conversation.customerName,
      });
      toast.success("Sent to the warehouse — their answer will show here");
      setOpen(false);
    } catch (err) {
      setError(err instanceof TaskError ? err.message : "Couldn't send. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ask the warehouse about this customer"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-warning/40 bg-warning-soft px-2.5 text-sm font-medium text-warning-foreground transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Package className="h-4 w-4" aria-hidden />
        <span className="hidden lg:inline">Ask Warehouse</span>
        <span className="sr-only lg:hidden">Ask Warehouse</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ask the warehouse</DialogTitle>
            <DialogDescription>About {conversation.customerName}. Their answer will appear above the message box.</DialogDescription>
          </DialogHeader>
          <form onSubmit={ask} className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {QUICK_PICKS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setQuestion(p)}
                  aria-pressed={question === p}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    question === p ? "border-primary bg-primary/10 text-primary" : "bg-card text-foreground hover:bg-secondary",
                  )}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setQuestion("");
                  document.getElementById("ask-warehouse-question")?.focus();
                }}
                className="rounded-full border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Other…
              </button>
            </div>
            <label htmlFor="ask-warehouse-question" className="text-sm font-semibold text-foreground">
              Question
            </label>
            <input
              id="ask-warehouse-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={100}
              placeholder="Type your question…"
              className="w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {error && (
              <p role="alert" className="rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-foreground">
                {error}
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Sending…" : "Ask"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------
// Strip above the message box
// ---------------------------------------------------------------

const DISMISSED_KEY = "transco.warehouse-strip-closed";

function readDismissed(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

function saveDismissed(list: string[]) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    /* only a convenience */
  }
}

export function WarehouseStrip({ conversation, onUseInReply }: { conversation: Conversation; onUseInReply: (text: string) => void }) {
  const questions = useWarehouseQuestions(conversation);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [open, setOpen] = useState<StaffTask | null>(null);

  useEffect(() => setDismissed(readDismissed()), []);

  // The newest question whose current state hasn't been closed.
  const shown = questions
    .map((t) => {
      const answer = warehouseAnswer(t);
      return { t, answer, key: `${t.id}:${answer?.id ?? t.status}` };
    })
    .find((x) => !dismissed.includes(x.key));
  if (!shown) return null;
  const { t, answer, key } = shown;

  const close = () => {
    const next = [...dismissed, key];
    setDismissed(next);
    saveDismissed(next);
  };

  const waiting = !answer && t.status !== "done";

  return (
    <div className={cn("flex shrink-0 items-start gap-2.5 border-t px-3 py-2.5 md:px-6", waiting ? "border-warning/30 bg-warning-soft" : "border-success/30 bg-success-soft")}>
      <Package className={cn("mt-0.5 h-4 w-4 shrink-0", waiting ? "text-warning" : "text-success")} aria-hidden />
      <div className="min-w-0 flex-1">
        {waiting ? (
          <p className="text-sm text-warning-foreground">
            <span className="font-semibold">Waiting on warehouse</span> · “{questionOf(t)}” · {waitedFor(t.createdAt)}
            {t.claimedByName ? ` · ${firstName(t.claimedByName)} is on it` : ""}
          </p>
        ) : answer ? (
          <>
            <p className="text-xs text-success-foreground/80">“{questionOf(t)}”</p>
            <p className="whitespace-pre-wrap break-words text-sm text-success-foreground">
              <span className="font-semibold">Warehouse ({firstName(answer.byName)}):</span> {answer.text}
            </p>
          </>
        ) : (
          <p className="text-sm text-success-foreground">
            <span className="font-semibold">{firstName(t.doneByName)} marked it done ✓</span> · “{questionOf(t)}”
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-2">
          {answer && (
            <Button type="button" size="sm" onClick={() => onUseInReply(answer.text)}>
              {conversation.mode === "HUMAN" ? "Use in reply" : "Take over & use in reply"}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(t)}>
            View
          </Button>
        </div>
      </div>
      {!waiting && (
        <button type="button" onClick={close} aria-label="Close" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-card/60">
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
      <TaskDetailsDialog task={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// ---------------------------------------------------------------
// Right-side panel list + chat list tag
// ---------------------------------------------------------------

export function WarehouseQuestionsList({ conversation }: { conversation: Conversation }) {
  const questions = useWarehouseQuestions(conversation).slice(0, 5);
  const [open, setOpen] = useState<StaffTask | null>(null);
  if (!questions.length) return <p className="text-xs text-muted-foreground">None yet. Use “Ask Warehouse” above the chat.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {questions.map((t) => {
        const answer = warehouseAnswer(t);
        return (
          <button key={t.id} type="button" onClick={() => setOpen(t)} className="rounded-md border border-border bg-panel px-2 py-1.5 text-left text-xs hover:border-primary/40">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-foreground">{questionOf(t)}</span>
              <span className="shrink-0 text-muted-foreground">{answer || t.status === "done" ? "✓" : "waiting"}</span>
            </span>
            {answer && <span className="mt-0.5 line-clamp-2 block text-muted-foreground">{answer.text}</span>}
          </button>
        );
      })}
      <TaskDetailsDialog task={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Small tag on a chat in the list while a warehouse question is open. */
export function WarehouseTag({ conversation }: { conversation: ConversationSummary }) {
  const questions = useWarehouseQuestions(conversation as unknown as ChatLike).filter((t) => t.status !== "done");
  if (!questions.length) return null;
  const answered = questions.some((t) => warehouseAnswer(t));
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
        answered ? "bg-success-soft text-success-foreground" : "bg-warning-soft text-warning-foreground",
      )}
    >
      📦 {answered ? "Answered" : "Warehouse"}
    </span>
  );
}
