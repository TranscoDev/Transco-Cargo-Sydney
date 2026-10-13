import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingRows, PageHeader, PageShell, StatusBadge } from "@/components/transco/page-kit";
import { TaskDetailsDialog } from "@/components/transco/task-kit";
import { cn } from "@/lib/utils";
import {
  fetchAllTasks,
  fetchPeople,
  firstName,
  fmtDue,
  forWhom,
  isOverdue,
  needsAttention,
  reassignTask,
  taskIcon,
  TaskError,
  waitedFor,
  type StaffTask,
  type TaskPerson,
} from "@/lib/transco/tasks";

export const Route = createFileRoute("/console/all-tasks")({
  component: AllTasksPage,
});

type StatusFilter = "active" | "open" | "in_progress" | "done" | "all";

const STATUS_LABEL = { open: "Open", in_progress: "In progress", done: "Done" } as const;

/**
 * Admin only: every task from every person and team (except private
 * "Me only" to-dos), with simple filters and Reassign for a stuck task.
 */
function AllTasksPage() {
  const [tasks, setTasks] = useState<StaffTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<TaskPerson[]>([]);
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [onlyLate, setOnlyLate] = useState(false);
  const [open, setOpen] = useState<StaffTask | null>(null);

  const load = useCallback(() => {
    fetchAllTasks()
      .then((d) => {
        setTasks(d.tasks);
        setError(null);
      })
      .catch((err) => setError(err instanceof TaskError ? err.message : "Couldn't load the tasks."));
  }, []);

  useEffect(() => {
    load();
    fetchPeople()
      .then((d) => setPeople(d.people))
      .catch(() => setPeople([]));
    const onChange = () => load();
    window.addEventListener("transco:tasks-changed", onChange);
    return () => window.removeEventListener("transco:tasks-changed", onChange);
  }, [load]);

  const today = new Date().toDateString();
  const summary = useMemo(() => {
    const list = tasks ?? [];
    return {
      open: list.filter((t) => t.status !== "done").length,
      late: list.filter((t) => needsAttention(t)).length,
      doneToday: list.filter((t) => t.status === "done" && t.doneAt && new Date(t.doneAt).toDateString() === today).length,
    };
  }, [tasks, today]);

  const rows = useMemo(() => {
    return (tasks ?? [])
      .filter((t) => (status === "all" ? true : status === "active" ? t.status !== "done" : t.status === status))
      .filter((t) => !onlyLate || needsAttention(t))
      .filter((t) => !person || t.createdById === person || t.assigneeId === person || t.claimedById === person)
      .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || b.createdAt.localeCompare(a.createdAt));
  }, [tasks, status, onlyLate, person]);

  const reassign = async (task: StaffTask, value: string) => {
    if (!value) return;
    try {
      const updated = value === "team" ? await reassignTask(task.id, "team") : await reassignTask(task.id, "person", value);
      setTasks((list) => (list ?? []).map((t) => (t.id === updated.id ? updated : t)));
      toast.success(value === "team" ? "Given to the warehouse team" : `Given to ${firstName(updated.assigneeName)}`);
    } catch (err) {
      toast.error(err instanceof TaskError ? err.message : "Couldn't reassign. Please try again.");
    }
  };

  const selectClass = "rounded-lg border bg-card px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <PageShell>
      <PageHeader
        icon={ShieldCheck}
        title="All tasks"
        description="Every task across the team, for the admin. Private “Me only” to-dos are not shown."
      />

      {error ? (
        <ErrorState title={error} onRetry={load} />
      ) : !tasks ? (
        <LoadingRows rows={4} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-lg bg-secondary px-3 py-1.5 text-sm font-semibold text-foreground">
              <span className="tabular-nums">{summary.open}</span> open
            </span>
            <span className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold", summary.late ? "bg-attention-soft text-attention-foreground" : "bg-secondary text-foreground")}>
              <span className="tabular-nums">{summary.late}</span> late or waiting
            </span>
            <span className="rounded-lg bg-success-soft px-3 py-1.5 text-sm font-semibold text-success-foreground">
              <span className="tabular-nums">{summary.doneToday}</span> done today
            </span>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label htmlFor="all-person" className="sr-only">
              Person
            </label>
            <select id="all-person" value={person} onChange={(e) => setPerson(e.target.value)} className={selectClass}>
              <option value="">Everyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label htmlFor="all-status" className="sr-only">
              Status
            </label>
            <select id="all-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={selectClass}>
              <option value="active">Not done yet</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done (last 7 days)</option>
              <option value="all">Everything</option>
            </select>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input id="all-late" type="checkbox" checked={onlyLate} onChange={(e) => setOnlyLate(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
              Only late or waiting
            </label>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <EmptyState compact title="No tasks match" description="Try another filter." />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2.5 font-semibold">Task</th>
                    <th className="px-3 py-2.5 font-semibold">From</th>
                    <th className="px-3 py-2.5 font-semibold">For</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Waiting</th>
                    <th className="px-3 py-2.5 font-semibold">Give to</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const late = needsAttention(t);
                    return (
                      <tr key={t.id} className={cn("border-b last:border-0", late && "bg-attention-soft/40")}>
                        <td className={cn("px-3 py-2.5", late && "border-l-4 border-l-attention")}>
                          <button type="button" onClick={() => setOpen(t)} className="text-left font-medium text-foreground hover:underline">
                            <span aria-hidden>{taskIcon(t.title)} </span>
                            {t.title}
                          </button>
                          {fmtDue(t) && <span className={cn("block text-xs", isOverdue(t) ? "text-attention-foreground" : "text-muted-foreground")}>Due {fmtDue(t)}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{firstName(t.createdByName)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{forWhom(t)}</td>
                        <td className="px-3 py-2.5">
                          <StatusBadge tone={t.status === "done" ? "success" : late ? "attention" : t.status === "in_progress" ? "info" : "pending"}>{STATUS_LABEL[t.status]}</StatusBadge>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{t.status === "done" ? "—" : waitedFor(t.createdAt)}</td>
                        <td className="px-3 py-2.5">
                          {t.status !== "done" && (
                            <>
                              <label htmlFor={`reassign-${t.id}`} className="sr-only">
                                Give “{t.title}” to
                              </label>
                              <select id={`reassign-${t.id}`} value="" onChange={(e) => void reassign(t, e.target.value)} className={selectClass}>
                                <option value="">Reassign…</option>
                                <option value="team">Warehouse team</option>
                                {people.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <TaskDetailsDialog task={open} onClose={() => setOpen(null)} />
    </PageShell>
  );
}
