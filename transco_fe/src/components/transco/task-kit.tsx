import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Hand, Leaf, Lock, MessageSquare, Plus, Trash2, UserRound, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { canSee } from "@/lib/transco/auth";
import {
  actOnTask,
  commentOnTask,
  createTask,
  deleteTask,
  fetchPeople,
  firstName,
  fmtDue,
  forWhom,
  isForToday,
  isMine,
  isOverdue,
  isWaitingLong,
  localToday,
  needsAttention,
  taskIcon,
  TaskError,
  useTasks,
  waitedFor,
  type StaffTask,
  type TaskAction,
  type TaskAssignTo,
  type TaskMe,
  type TaskPerson,
} from "@/lib/transco/tasks";

/**
 * Staff tasks, the shared pieces: the Today panel on the dashboard, a task
 * card for the board, the New task form and the task details window.
 * Every action is one tap; a failed call shows a short toast and leaves
 * the task as it was.
 */

async function run(action: () => Promise<unknown>, done?: string) {
  try {
    await action();
    if (done) toast.success(done);
    return true;
  } catch (err) {
    toast.error(err instanceof TaskError ? err.message : "Something went wrong. Please try again.");
    return false;
  }
}

export function doAction(task: StaffTask, action: TaskAction) {
  const messages: Record<TaskAction, string> = {
    claim: "Claimed — it's yours now",
    unclaim: "Let go — back on the team list",
    start: "Started",
    done: "Done ✓",
    reopen: "Opened again",
  };
  return run(() => actOnTask(task.id, action), messages[action]);
}

export function canDeleteTask(task: StaffTask, me: TaskMe | null) {
  return !!me && (task.createdById === me.id || me.isAdmin);
}

/** Deletes straight away, with Undo in the toast for a wrong tap. */
export async function removeTask(task: StaffTask) {
  const ok = await run(() => deleteTask(task.id));
  if (!ok) return false;
  toast("Task deleted", {
    action: {
      label: "Undo",
      onClick: () =>
        void run(
          () =>
            createTask({
              title: task.title,
              note: task.note ?? undefined,
              assignTo: task.assignTo,
              personId: task.assignTo === "person" ? (task.assigneeId ?? undefined) : undefined,
              dueDate: task.dueDate,
              dueTime: task.dueTime,
              customerId: task.customerId ?? undefined,
              customerName: task.customerName ?? undefined,
              bookingId: task.bookingId ?? undefined,
            }),
          "Task brought back",
        ),
    },
  });
  return true;
}

function DeleteIcon({ task, me, className }: { task: StaffTask; me: TaskMe | null; className?: string }) {
  const [busy, setBusy] = useState(false);
  if (!canDeleteTask(task, me)) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await removeTask(task);
        setBusy(false);
      }}
      aria-label={`Delete "${task.title}"`}
      title="Delete task"
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-attention-soft hover:text-attention-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/** The one main button a card shows, depending on where the task is. */
export function nextAction(task: StaffTask, me: TaskMe | null): { action: TaskAction; label: string } | null {
  if (!me || task.status === "done") return null;
  if (task.assignTo === "team" && !task.claimedById) return { action: "claim", label: "Claim" };
  if (task.assignTo === "team" && task.claimedById !== me.id && !me.isAdmin) return null;
  if (task.assignTo === "person" && task.assigneeId !== me.id && task.createdById !== me.id && !me.isAdmin) return null;
  return task.status === "open" ? { action: "start", label: "Start" } : { action: "done", label: "Done" };
}

// ---------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------

export function TaskChips({ task }: { task: StaffTask }) {
  const due = fmtDue(task);
  const overdue = isOverdue(task);
  const waiting = isWaitingLong(task);
  return (
    <span className="flex flex-wrap gap-1.5">
      {due && (
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", overdue ? "bg-attention-soft text-attention-foreground" : "bg-warning-soft text-warning-foreground")}>
          {overdue ? "Late · " : "Due "}
          {due}
        </span>
      )}
      {waiting && (
        <span className="rounded-full bg-attention-soft px-2 py-0.5 text-[11px] font-semibold text-attention-foreground">
          Waiting {waitedFor(task.createdAt)}
        </span>
      )}
      {task.status === "done" && (
        <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-foreground">
          Done{task.doneByName ? ` · ${firstName(task.doneByName)}` : ""}
        </span>
      )}
    </span>
  );
}

/** One card on the Task Board. */
export function TaskCard({ task, me, onOpen }: { task: StaffTask; me: TaskMe | null; onOpen: () => void }) {
  const next = nextAction(task, me);
  const [busy, setBusy] = useState(false);
  const late = needsAttention(task);
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-xl border bg-card p-3 pr-9 shadow-xs transition-colors",
        late && "border-l-4 border-l-attention",
        task.status === "done" && "opacity-70",
      )}
    >
      <button type="button" onClick={onOpen} className="flex items-start gap-2 text-left">
        <span className="text-base leading-5" aria-hidden>
          {taskIcon(task.title)}
        </span>
        <span className={cn("min-w-0 flex-1 break-words text-sm font-semibold text-foreground", task.status === "done" && "line-through decoration-muted-foreground/60")}>
          {task.title}
        </span>
      </button>
      <DeleteIcon task={task} me={me} className="absolute right-1.5 top-1.5" />
      <TaskChips task={task} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0">
          {task.createdById === me?.id ? forWhom(task, me?.id) : `From ${firstName(task.createdByName)} · ${forWhom(task, me?.id)}`}
          {task.comments.length > 0 && (
            <span className="ml-2 inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" aria-hidden />
              {task.comments.length}
            </span>
          )}
        </span>
        {next && (
          <Button
            type="button"
            size="sm"
            variant={next.action === "start" ? "outline" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await doAction(task, next.action);
              setBusy(false);
            }}
          >
            {next.action === "claim" && <Hand className="mr-1 h-3.5 w-3.5" aria-hidden />}
            {next.action === "done" && <Check className="mr-1 h-3.5 w-3.5" aria-hidden />}
            {next.label}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Today panel (dashboard)
// ---------------------------------------------------------------

/**
 * The panel's colour says how the day is going: green when there's
 * nothing to do (relax), calm blue while things are on the list, and the
 * attention colour only when something is late.
 */
type DayTone = "calm" | "busy" | "late";
const DAY_TONE: Record<DayTone, { panel: string; icon: string }> = {
  calm: { panel: "from-success-soft/70", icon: "bg-success-soft text-success ring-success/25" },
  busy: { panel: "from-info-soft/70", icon: "bg-info-soft text-info ring-info/25" },
  late: { panel: "from-attention-soft/70", icon: "bg-attention-soft text-attention ring-attention/25" },
};

function TodayIcon({ tone }: { tone: DayTone }) {
  return (
    <span className={cn("grid h-8 w-8 place-items-center rounded-full ring-1", DAY_TONE[tone].icon)} aria-hidden>
      <Leaf className="h-4 w-4" strokeWidth={2.25} />
    </span>
  );
}

const ALL_CLEAR = ["All clear! Enjoy your tea ☕", "Nothing left. Nice work! 🌟", "All done for today 🎉"];

export function TodayPanel({ className }: { className?: string }) {
  const { tasks, me, loaded, failed } = useTasks();
  const [open, setOpen] = useState<StaffTask | null>(null);
  const [quick, setQuick] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const today = new Date().toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

  const { mine, toClaim } = useMemo(() => {
    if (!me) return { mine: [] as StaffTask[], toClaim: [] as StaffTask[] };
    const order = (a: StaffTask, b: StaffTask) =>
      Number(a.status === "done") - Number(b.status === "done") ||
      Number(needsAttention(b)) - Number(needsAttention(a)) ||
      (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") ||
      a.createdAt.localeCompare(b.createdAt);
    return {
      mine: tasks.filter((t) => isMine(t, me.id) && isForToday(t)).sort(order),
      // The warehouse also sees team tasks nobody has picked up yet.
      toClaim: me.isWarehouse ? tasks.filter((t) => t.assignTo === "team" && !t.claimedById && t.status !== "done").sort(order) : [],
    };
  }, [tasks, me]);

  // Tasks this person *can't* see won't break anything — the panel just hides.
  if (failed && !me) return null;

  const done = mine.filter((t) => t.status === "done").length;
  const left = mine.length - done;
  const percent = mine.length ? Math.round((done / mine.length) * 100) : 0;
  const tone: DayTone = mine.some((t) => t.status !== "done" && needsAttention(t)) ? "late" : left > 0 ? "busy" : "calm";

  const tick = async (t: StaffTask) => {
    setBusyId(t.id);
    await run(() => actOnTask(t.id, t.status === "done" ? "reopen" : "done"));
    setBusyId(null);
  };

  const addQuick = async (e: FormEvent) => {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setAdding(true);
    if (await run(() => createTask({ title, assignTo: "me" }))) setQuick("");
    setAdding(false);
  };

  return (
    <aside
      aria-label="Today's tasks"
      className={cn(
        "rounded-2xl border bg-gradient-to-b via-card to-card p-4 shadow-xs transition-colors",
        DAY_TONE[tone].panel,
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <TodayIcon tone={tone} />
          Today
        </h2>
        <span className="text-xs text-muted-foreground">{today}</span>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        {!loaded
          ? "Getting your tasks…"
          : left === 0
            ? mine.length
              ? ALL_CLEAR[new Date().getDate() % ALL_CLEAR.length]
              : "Nothing on your list yet."
            : `${left} thing${left === 1 ? "" : "s"} to do. You've got this!`}
      </p>

      {mine.length > 0 && (
        <ul className="flex flex-col gap-2">
          {mine.map((t) => {
            const isDone = t.status === "done";
            const late = needsAttention(t);
            return (
              <li
                key={t.id}
                className={cn(
                  "grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-2 rounded-xl border bg-card px-2.5 py-2 transition-colors",
                  late && !isDone && "border-attention/50 bg-attention-soft/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => tick(t)}
                  disabled={busyId === t.id}
                  aria-label={isDone ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
                  className={cn(
                    "mt-0.5 grid h-6 w-6 place-items-center rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isDone ? "scale-105 border-success bg-success text-white" : "border-primary/70 hover:bg-primary/10",
                  )}
                >
                  {isDone && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
                </button>
                <button type="button" onClick={() => setOpen(t)} className="min-w-0 text-left">
                  <span className={cn("block break-words text-sm font-semibold text-foreground", isDone && "text-muted-foreground line-through")}>
                    <span aria-hidden>{taskIcon(t.title)} </span>
                    {t.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[
                      t.createdById === me?.id ? (t.assignTo === "me" ? "my to-do" : null) : `from ${firstName(t.createdByName)}`,
                      fmtDue(t) && `due ${fmtDue(t)}`,
                      isWaitingLong(t) && `waiting ${waitedFor(t.createdAt)}`,
                      t.comments.length ? `💬 ${t.comments.length}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
                <DeleteIcon task={t} me={me} />
              </li>
            );
          })}
        </ul>
      )}

      {toClaim.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ready to claim</p>
          <ul className="flex flex-col gap-2">
            {toClaim.map((t) => (
              <li key={t.id} className={cn("flex items-center gap-2 rounded-xl border bg-card px-2.5 py-2", needsAttention(t) && "border-attention/50 bg-attention-soft/60")}>
                <button type="button" onClick={() => setOpen(t)} className="min-w-0 flex-1 text-left">
                  <span className="block break-words text-sm font-semibold text-foreground">
                    <span aria-hidden>{taskIcon(t.title)} </span>
                    {t.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    from {firstName(t.createdByName)} · waiting {waitedFor(t.createdAt)}
                  </span>
                </button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busyId === t.id}
                  onClick={async () => {
                    setBusyId(t.id);
                    await doAction(t, "claim");
                    setBusyId(null);
                  }}
                >
                  <Hand className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Claim
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={addQuick} className="mt-3 flex gap-2">
        <label htmlFor="today-quick-add" className="sr-only">
          Add a quick to-do
        </label>
        <input
          id="today-quick-add"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          maxLength={120}
          placeholder="+ Add a quick to-do…"
          className="min-w-0 flex-1 rounded-lg border border-dashed bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={adding || !quick.trim()}>
          Add
        </Button>
      </form>

      {mine.length > 0 && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
            <div className="h-full rounded-full bg-success transition-all duration-500" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {done} of {mine.length} done
          </p>
        </div>
      )}

      <Link to="/console/tasks" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
        Open Task Board →
      </Link>

      <TaskDetailsDialog task={open} onClose={() => setOpen(null)} />
    </aside>
  );
}

// ---------------------------------------------------------------
// New task
// ---------------------------------------------------------------

type DueChoice = "none" | "today" | "tomorrow" | "pick";

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-primary bg-primary/10 text-primary" : "bg-card text-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

const fieldClass =
  "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function NewTaskDialog({
  open,
  onClose,
  defaultAssignTo = "team",
}: {
  open: boolean;
  onClose: () => void;
  defaultAssignTo?: TaskAssignTo | undefined;
}) {
  const { me } = useTasks();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [assignTo, setAssignTo] = useState<TaskAssignTo>(defaultAssignTo);
  const [personId, setPersonId] = useState("");
  const [people, setPeople] = useState<TaskPerson[] | null>(null);
  const [due, setDue] = useState<DueChoice>("none");
  const [pickDate, setPickDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setNote("");
    setAssignTo(defaultAssignTo);
    setPersonId("");
    setDue("none");
    setPickDate("");
    setTime("");
    setError(null);
  }, [open, defaultAssignTo]);

  useEffect(() => {
    if (open && assignTo === "person" && !people) {
      fetchPeople()
        .then((d) => setPeople(d.people))
        .catch(() => setPeople([]));
    }
  }, [open, assignTo, people]);

  const dueDate =
    due === "today"
      ? localToday()
      : due === "tomorrow"
        ? localToday(new Date(Date.now() + 24 * 60 * 60 * 1000))
        : due === "pick"
          ? pickDate || null
          : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Write what needs doing.");
    if (assignTo === "person" && !personId) return setError("Choose who the task is for.");
    if (due === "pick" && !pickDate) return setError("Pick a day, or choose “No time”.");
    setSaving(true);
    try {
      await createTask({
        title: title.trim(),
        note: note.trim() || undefined,
        assignTo,
        personId: assignTo === "person" ? personId : undefined,
        dueDate,
        dueTime: dueDate && time ? time : null,
      });
      toast.success(assignTo === "me" ? "Added to your list" : "Task sent ✓");
      onClose();
    } catch (err) {
      setError(err instanceof TaskError ? err.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Only the first box is needed. Everything else is optional.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="task-title" className="text-sm font-semibold text-foreground">
              What needs doing?
            </label>
            <input id="task-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Call Sunil about the TV box" className={fieldClass} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-foreground">Who is it for?</span>
            <div className="flex flex-wrap gap-2">
              <Choice on={assignTo === "me"} onClick={() => setAssignTo("me")}>
                <Lock className="h-3.5 w-3.5" aria-hidden /> Me only
              </Choice>
              <Choice on={assignTo === "team"} onClick={() => setAssignTo("team")}>
                <Users className="h-3.5 w-3.5" aria-hidden /> Warehouse team
              </Choice>
              <Choice on={assignTo === "person"} onClick={() => setAssignTo("person")}>
                <UserRound className="h-3.5 w-3.5" aria-hidden /> A person
              </Choice>
            </div>
            {assignTo === "me" && <p className="text-xs text-muted-foreground">Private — only you will see it.</p>}
            {assignTo === "team" && <p className="text-xs text-muted-foreground">Anyone in the warehouse can claim it. Once claimed, it's theirs.</p>}
            {assignTo === "person" && (
              <>
                <label htmlFor="task-person" className="sr-only">
                  Choose a person
                </label>
                <select id="task-person" value={personId} onChange={(e) => setPersonId(e.target.value)} className={fieldClass}>
                  <option value="">{people ? "Choose a person…" : "Loading staff…"}</option>
                  {(people ?? [])
                    .filter((p) => p.id !== me?.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.role === "warehouse" ? " (warehouse)" : ""}
                      </option>
                    ))}
                </select>
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-foreground">
              When? <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <div className="flex flex-wrap gap-2">
              <Choice on={due === "none"} onClick={() => setDue("none")}>
                No time
              </Choice>
              <Choice on={due === "today"} onClick={() => setDue("today")}>
                Today
              </Choice>
              <Choice on={due === "tomorrow"} onClick={() => setDue("tomorrow")}>
                Tomorrow
              </Choice>
              <Choice on={due === "pick"} onClick={() => setDue("pick")}>
                Pick a day
              </Choice>
            </div>
            {due !== "none" && (
              <div className="flex flex-wrap gap-2">
                {due === "pick" && (
                  <>
                    <label htmlFor="task-date" className="sr-only">
                      Day
                    </label>
                    <input id="task-date" type="date" min={localToday()} value={pickDate} onChange={(e) => setPickDate(e.target.value)} className={cn(fieldClass, "w-auto")} />
                  </>
                )}
                <label htmlFor="task-time" className="sr-only">
                  Time (optional)
                </label>
                <input id="task-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(fieldClass, "w-auto")} />
                <span className="self-center text-xs text-muted-foreground">Time is optional</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="task-note" className="text-sm font-semibold text-foreground">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea id="task-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Anything that helps — a phone number, a box count…" className={fieldClass} />
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
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : assignTo === "me" ? "Add to my list" : "Send task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------
// Task details (comments + actions)
// ---------------------------------------------------------------

export function TaskDetailsDialog({ task: initial, onClose }: { task: StaffTask | null; onClose: () => void }) {
  const { tasks, me } = useTasks();
  // Always show the freshest copy (someone may comment while it's open).
  const task = initial ? (tasks.find((t) => t.id === initial.id) ?? initial) : null;
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setComment("");
    setConfirmDelete(false);
  }, [initial?.id]);

  if (!task) return null;
  const next = nextAction(task, me);
  const canDelete = !!me && (task.createdById === me.id || me.isAdmin);
  const canLetGo = task.assignTo === "team" && !!task.claimedById && (task.claimedById === me?.id || me?.isAdmin) && task.status !== "done";
  // Someone other than the asker, who may work on it (an unclaimed team task gets claimed).
  const canAnswerAndFinish = task.status !== "done" && task.createdById !== me?.id && !!next;
  const canReopen = task.status === "done" && !!me && (isMine(task, me.id) || task.createdById === me.id || me.isAdmin);

  const act = async (action: TaskAction) => {
    setBusy(true);
    await doAction(task, action);
    setBusy(false);
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = comment.trim();
    if (!text) return;
    setBusy(true);
    if (await run(() => commentOnTask(task.id, text))) setComment("");
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-6 text-left">
            <span aria-hidden>{taskIcon(task.title)}</span>
            <span className={cn("break-words", task.status === "done" && "line-through decoration-muted-foreground/60")}>{task.title}</span>
          </DialogTitle>
          <DialogDescription className="text-left">
            {task.createdById === me?.id ? "You made this" : `From ${task.createdByName}`} · {forWhom(task, me?.id)} · {waitedFor(task.createdAt)} ago
          </DialogDescription>
        </DialogHeader>

        <TaskChips task={task} />

        {task.note && <p className="whitespace-pre-wrap rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">{task.note}</p>}

        {task.customerId && !canSee("customer-profile") && task.customerName && (
          <p className="text-sm text-muted-foreground">Customer: {task.customerName}</p>
        )}
        {task.customerId && canSee("customer-profile") && (
          <Link to="/console/customers/$customerId" params={{ customerId: task.customerId }} className="text-sm font-medium text-primary hover:underline">
            Customer: {task.customerName ?? "open profile"} →
          </Link>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comments</p>
          {task.comments.length ? (
            <ul className="flex flex-col gap-2">
              {task.comments.map((c) => (
                <li key={c.id} className={cn("rounded-lg px-3 py-2 text-sm", c.byId === me?.id ? "bg-primary/10" : "bg-secondary")}>
                  <span className="font-semibold text-foreground">{c.byId === me?.id ? "You" : firstName(c.byName)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{waitedFor(c.at)} ago</span>
                  <p className="whitespace-pre-wrap break-words text-foreground">{c.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No comments yet. Add an update so everyone knows where it's at.</p>
          )}
          <form onSubmit={send} className="flex gap-2">
            <label htmlFor="task-comment" className="sr-only">
              Add a comment
            </label>
            <input id="task-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="e.g. Called him, coming Friday" className={cn(fieldClass, "min-w-0 flex-1")} />
            <Button type="submit" variant="secondary" disabled={busy || !comment.trim()}>
              Send
            </Button>
          </form>
          {/* The warehouse answering a question: reply and finish in one tap. */}
          {canAnswerAndFinish && comment.trim() && (
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                const text = comment.trim();
                setBusy(true);
                if (await run(() => commentOnTask(task.id, text))) {
                  setComment("");
                  await doAction(task, "done");
                }
                setBusy(false);
              }}
              className="self-end"
            >
              <Check className="mr-1 h-4 w-4" aria-hidden /> Send & Done
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <div className="flex flex-wrap gap-2">
            {canDelete &&
              (confirmDelete ? (
                <>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      if (await removeTask(task)) onClose();
                      setBusy(false);
                    }}
                  >
                    Yes, delete
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </Button>
                </>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="text-muted-foreground">
                  <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Delete
                </Button>
              ))}
            {canLetGo && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => act("unclaim")}>
                Let go
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canReopen && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => act("reopen")}>
                Open again
              </Button>
            )}
            {next && next.action === "start" && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => act("start")}>
                Start
              </Button>
            )}
            {next && next.action === "claim" && (
              <Button type="button" disabled={busy} onClick={() => act("claim")}>
                <Hand className="mr-1 h-4 w-4" aria-hidden /> Claim
              </Button>
            )}
            {next && next.action !== "claim" && (
              <Button type="button" disabled={busy} onClick={() => act("done")}>
                <Check className="mr-1 h-4 w-4" aria-hidden /> Done
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NewTaskButton({ className, defaultAssignTo }: { className?: string; defaultAssignTo?: TaskAssignTo | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className={className}>
        <Plus className="mr-1 h-4 w-4" aria-hidden /> New task
      </Button>
      <NewTaskDialog open={open} onClose={() => setOpen(false)} defaultAssignTo={defaultAssignTo} />
    </>
  );
}
