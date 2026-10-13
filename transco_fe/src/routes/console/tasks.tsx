import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ListTodo, Sunrise } from "lucide-react";

import { EmptyState, ErrorState, LoadingRows, PageHeader, PageShell } from "@/components/transco/page-kit";
import { NewTaskButton, TaskCard, TaskDetailsDialog } from "@/components/transco/task-kit";
import { cn } from "@/lib/utils";
import { isMine, needsAttention, reloadTasks, useTasks, type StaffTask, type TaskStatus } from "@/lib/transco/tasks";

export const Route = createFileRoute("/console/tasks")({
  component: TasksPage,
});

type Tab = "mine" | "sent" | "team";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Task Board: My tasks, Sent by me, Team tasks — each as three
 * columns (Open / In progress / Done). Cards move with one tap (Claim,
 * Start, Done), never by dragging, so it works the same on a phone.
 */
function TasksPage() {
  const { tasks, me, loaded, failed } = useTasks();
  const [tab, setTab] = useState<Tab>(() => (typeof window !== "undefined" && window.location.hash === "#team" ? "team" : "mine"));
  const [open, setOpen] = useState<StaffTask | null>(null);

  const lists = useMemo(() => {
    const recent = (t: StaffTask) => t.status !== "done" || (!!t.doneAt && Date.now() - new Date(t.doneAt).getTime() < DAY_MS);
    const shown = tasks.filter(recent);
    return {
      mine: me ? shown.filter((t) => isMine(t, me.id)) : [],
      sent: me ? shown.filter((t) => t.createdById === me.id && t.assignTo !== "me") : [],
      team: shown.filter((t) => t.assignTo === "team"),
    };
  }, [tasks, me]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "mine", label: "My tasks" },
    { key: "sent", label: "Sent by me" },
    { key: "team", label: "Team tasks" },
  ];
  const openCount = (list: StaffTask[]) => list.filter((t) => t.status !== "done").length;
  const current = lists[tab];

  return (
    <PageShell>
      <PageHeader
        icon={ListTodo}
        title="Tasks"
        description="Jobs for yourself, a colleague or the warehouse team. Tap a task to see comments."
        actions={<NewTaskButton defaultAssignTo={tab === "mine" ? "me" : "team"} />}
      />

      <div role="tablist" aria-label="Task lists" className="mb-5 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const n = openCount(lists[t.key]);
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === t.key ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
            >
              {t.label}
              {n > 0 && (
                <span className={cn("min-w-5 rounded-full px-1.5 text-center text-xs leading-5", tab === t.key ? "bg-white/25" : "bg-card")}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      {!loaded ? (
        <LoadingRows rows={3} />
      ) : failed && !me ? (
        <ErrorState title="Couldn't load the tasks" description="The rest of the console still works. Try again in a moment." onRetry={() => void reloadTasks()} />
      ) : current.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Sunrise}
            title={tab === "mine" ? "Nothing on your list" : tab === "sent" ? "You haven't sent any tasks" : "No team tasks right now"}
            description={
              tab === "mine"
                ? "Add a to-do for yourself, or wait for one from a colleague."
                : tab === "sent"
                  ? "Use New task to give a job to the warehouse or a colleague."
                  : "When someone sends a job to the warehouse team, it shows here."
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = current
              .filter((t) => t.status === col.status)
              .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || b.updatedAt.localeCompare(a.updatedAt));
            return (
              <section key={col.status} aria-label={col.label} className="min-w-0 rounded-xl bg-secondary/50 p-3">
                <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold text-foreground">
                  {col.label}
                  <span className="text-xs font-medium text-muted-foreground">{items.length}</span>
                </h2>
                <div className="flex flex-col gap-2">
                  {items.map((t) => (
                    <TaskCard key={t.id} task={t} me={me} onOpen={() => setOpen(t)} />
                  ))}
                  {items.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted-foreground">Nothing here</p>}
                  {col.status === "done" && items.length > 0 && <p className="px-1 text-xs text-muted-foreground">Done tasks hide after a day.</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <TaskDetailsDialog task={open} onClose={() => setOpen(null)} />
    </PageShell>
  );
}
