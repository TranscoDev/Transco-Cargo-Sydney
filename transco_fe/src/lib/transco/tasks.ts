import { useEffect, useSyncExternalStore } from "react";

import { API_BASE_URL } from "./config";
import { getAuthToken } from "./auth";

/**
 * Staff tasks (transco_be/taskRoutes.js). One shared copy of "the tasks I
 * can see" feeds the menu badge, the Today panel and the Task Board, and
 * re-reads itself when any staff member changes a task (live event
 * "task.changed", passed on by store.tsx) or every minute as a fallback.
 * If the tasks can't load, everything else in the console carries on.
 */

export type TaskAssignTo = "me" | "person" | "team";
export type TaskStatus = "open" | "in_progress" | "done";

export interface TaskComment {
  id: string;
  byId: string;
  byName: string;
  text: string;
  at: string;
}

export interface StaffTask {
  id: string;
  title: string;
  note: string | null;
  assignTo: TaskAssignTo;
  team: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdById: string;
  createdByName: string;
  claimedById: string | null;
  claimedByName: string | null;
  status: TaskStatus;
  /** YYYY-MM-DD, optional */
  dueDate: string | null;
  /** HH:MM, optional (only with a date) */
  dueTime: string | null;
  customerId: string | null;
  customerName: string | null;
  bookingId: string | null;
  comments: TaskComment[];
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  doneByName: string | null;
}

export interface TaskMe {
  id: string;
  name: string;
  isAdmin: boolean;
  isWarehouse: boolean;
  /** Admin + named staff (CHAT_DELETE_EMAILS) may delete chats. */
  canDeleteChats?: boolean;
}

export interface NewTaskInput {
  title: string;
  note?: string | undefined;
  assignTo: TaskAssignTo;
  personId?: string | undefined;
  dueDate?: string | null;
  dueTime?: string | null;
  customerId?: string | undefined;
  customerName?: string | undefined;
  bookingId?: string | undefined;
}

export interface TaskPerson {
  id: string;
  name: string;
  role: string | null;
}

export type TaskAction = "claim" | "unclaim" | "start" | "done" | "reopen";

/** A tasks call the server refused, in words staff can act on. */
export class TaskError extends Error {
  field: string | null;
  constructor(message: string, field: string | null) {
    super(message);
    this.field = field;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getAuthToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/tasks${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : null,
    });
  } catch {
    throw new TaskError("Couldn't reach the server. Check the internet and try again.", null);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string | null };
  if (!res.ok) throw new TaskError(data.error || `Something went wrong (${res.status})`, data.field ?? null);
  return data as T;
}

// ---------- shared store ----------

interface TasksState {
  tasks: StaffTask[];
  me: TaskMe | null;
  loaded: boolean;
  failed: boolean;
}

let state: TasksState = { tasks: [], me: null, loaded: false, failed: false };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function setState(next: Partial<TasksState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function reloadTasks(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = request<{ tasks: StaffTask[]; me: TaskMe }>("GET", "")
    .then((data) => setState({ tasks: data.tasks, me: data.me, loaded: true, failed: false }))
    .catch(() => setState({ loaded: true, failed: true }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Put a task the server just returned straight into the list (no wait). */
function upsert(task: StaffTask) {
  const rest = state.tasks.filter((t) => t.id !== task.id);
  setState({ tasks: [task, ...rest] });
}

let started = false;
function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  void reloadTasks();
  window.addEventListener("transco:tasks-changed", () => void reloadTasks());
  window.addEventListener("focus", () => void reloadTasks());
  window.setInterval(() => void reloadTasks(), 60 * 1000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_STATE: TasksState = { tasks: [], me: null, loaded: false, failed: false };

export function useTasks(): TasksState {
  useEffect(startSync, []);
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

// ---------- actions ----------

export async function createTask(input: NewTaskInput): Promise<StaffTask> {
  const { task } = await request<{ task: StaffTask }>("POST", "", input);
  upsert(task);
  return task;
}

export async function actOnTask(id: string, action: TaskAction): Promise<StaffTask> {
  const { task } = await request<{ task: StaffTask }>("PATCH", `/${id}`, { action });
  upsert(task);
  return task;
}

export async function editTask(id: string, changes: { title?: string; note?: string | null; dueDate?: string | null; dueTime?: string | null }): Promise<StaffTask> {
  const { task } = await request<{ task: StaffTask }>("PATCH", `/${id}`, changes);
  upsert(task);
  return task;
}

export async function commentOnTask(id: string, text: string): Promise<StaffTask> {
  const { task } = await request<{ task: StaffTask }>("POST", `/${id}/comments`, { text });
  upsert(task);
  return task;
}

export async function deleteTask(id: string): Promise<void> {
  await request<void>("DELETE", `/${id}`);
  setState({ tasks: state.tasks.filter((t) => t.id !== id) });
}

export function fetchPeople(): Promise<{ people: TaskPerson[] }> {
  return request("GET", "/people");
}

export function fetchAllTasks(): Promise<{ tasks: StaffTask[] }> {
  return request("GET", "/all");
}

export async function reassignTask(id: string, assignTo: "team" | "person", personId?: string): Promise<StaffTask> {
  const { task } = await request<{ task: StaffTask }>("PATCH", `/${id}/reassign`, { assignTo, personId });
  return task;
}

// ---------- helpers for the screens ----------

/** Minutes a sent task can sit untouched before it turns orange. */
export const WAITING_MINUTES = 30;

export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A small picture for the task, guessed from its words — no extra field to fill. */
export function taskIcon(title: string): string {
  const t = title.toLowerCase();
  if (/\b(call|phone|ring)\b/.test(t)) return "📞";
  if (/\b(photo|picture|pic)\b/.test(t)) return "📸";
  if (/\b(pay|paid|payment|invoice|money|cash)\b/.test(t)) return "💰";
  if (/\b(declaration|form|document|bl|hbl)\b/.test(t)) return "🧾";
  if (/\b(box|boxes|parcel|arriv|weight|warehouse|pickup|deliver)/.test(t)) return "📦";
  if (/\b(chat|message|reply|whatsapp|email)\b/.test(t)) return "💬";
  return "📝";
}

/** Past its due day/time. */
export function isOverdue(task: StaffTask, now = new Date()): boolean {
  if (task.status === "done" || !task.dueDate) return false;
  const today = localToday(now);
  if (task.dueDate < today) return true;
  if (task.dueDate > today || !task.dueTime) return false;
  const [h = 0, m = 0] = task.dueTime.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() > h * 60 + m;
}

/** Sent to someone else and nobody has picked it up for a while. */
export function isWaitingLong(task: StaffTask, now = new Date()): boolean {
  if (task.assignTo === "me" || task.status !== "open") return false;
  if (task.assignTo === "team" && task.claimedById) return false;
  return now.getTime() - new Date(task.createdAt).getTime() > WAITING_MINUTES * 60 * 1000;
}

export function needsAttention(task: StaffTask, now = new Date()): boolean {
  return isOverdue(task, now) || isWaitingLong(task, now);
}

/** "12 min", "1 h 10", "3 days" */
export function waitedFor(iso: string, now = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours} h ${mins % 60}` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function fmtDueTime(t: string): string {
  const [h = 0, m = 0] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

/** "Today 10:30am", "Tomorrow", "Fri 17 Oct" */
export function fmtDue(task: StaffTask, now = new Date()): string | null {
  if (!task.dueDate) return null;
  const today = localToday(now);
  const tomorrow = localToday(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const day =
    task.dueDate === today
      ? "Today"
      : task.dueDate === tomorrow
        ? "Tomorrow"
        : new Date(`${task.dueDate}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  return task.dueTime ? `${day} ${fmtDueTime(task.dueTime)}` : day;
}

/** Who the task is for, in plain words. */
export function forWhom(task: StaffTask, meId?: string): string {
  if (task.assignTo === "me") return "My to-do";
  if (task.assignTo === "person") return task.assigneeId === meId ? "For me" : `For ${task.assigneeName ?? "a colleague"}`;
  return task.claimedByName ? `Warehouse · ${task.claimedById === meId ? "you" : task.claimedByName}` : "Warehouse team · not claimed";
}

/** Tasks this person should do (personal, given to them, or team tasks they claimed). */
export function isMine(task: StaffTask, meId: string): boolean {
  if (task.assignTo === "me") return task.createdById === meId;
  if (task.assignTo === "person") return task.assigneeId === meId;
  return task.claimedById === meId;
}

/** Shows in Today: due today, overdue, or with no date at all; done ones only if done today. */
export function isForToday(task: StaffTask, now = new Date()): boolean {
  const today = localToday(now);
  if (task.status === "done") return !!task.doneAt && localToday(new Date(task.doneAt)) === today;
  return !task.dueDate || task.dueDate <= today;
}

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "Staff";
}
