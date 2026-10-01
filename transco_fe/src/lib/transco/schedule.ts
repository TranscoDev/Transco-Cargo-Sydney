import { API_BASE_URL } from "./config";
import { getAuthToken } from "./auth";

/**
 * Shipping calendar (transco_be/scheduleRoutes.js): cutoff dates — the
 * last day to hand boxes over in Sydney — each with the estimated sea and
 * air arrival. Staff manage them here; the website reads the upcoming ones.
 */

export type ScheduleCountry = "sri_lanka" | "india";

export interface ScheduleDate {
  id: string;
  country: ScheduleCountry;
  /** YYYY-MM-DD */
  cutoff: string;
  seaArrival: string | null;
  airArrival: string | null;
  note: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ScheduleInput {
  country?: ScheduleCountry;
  cutoff?: string;
  seaArrival?: string | null;
  airArrival?: string | null;
  note?: string | null;
}

/** A save the server refused, naming the field to fix. */
export class ScheduleError extends Error {
  field: string | null;
  constructor(message: string, field: string | null) {
    super(message);
    this.field = field;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE_URL}/api/schedule${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string | null };
  if (!res.ok) throw new ScheduleError(data.error || `Request failed (${res.status})`, data.field ?? null);
  return data as T;
}

export function fetchSchedule(country: ScheduleCountry): Promise<{ today: string; dates: ScheduleDate[] }> {
  return request("GET", `?country=${country}`);
}

export function createScheduleDate(input: ScheduleInput): Promise<{ date: ScheduleDate }> {
  return request("POST", "", input);
}

export function updateScheduleDate(id: string, input: ScheduleInput): Promise<{ date: ScheduleDate }> {
  return request("PATCH", `/${id}`, input);
}

export function deleteScheduleDate(id: string): Promise<void> {
  return request("DELETE", `/${id}`);
}
