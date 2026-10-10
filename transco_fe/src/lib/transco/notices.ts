import { API_BASE_URL } from "./config";
import { getAuthToken } from "./auth";

/** A website notice (console → Website notices; backend notices.js). */
export type NoticeKind = "closure" | "offer" | "info";
export type NoticeTheme =
  | "none" | "christmas" | "newyear" | "avurudu" | "vesak" | "deepavali" | "ramadan" | "offer" | "celebration";

export interface Notice {
  id: string;
  kind: NoticeKind;
  title: string;
  message: { en: string; si: string; ta: string };
  theme: NoticeTheme;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  link: { label: string; url: string } | null;
  pauseBot: boolean;
  blockDates: boolean;
  dismissible: boolean;
}
export type NoticeInput = Omit<Notice, "id" | "dismissible">;

function headers(json = false): Record<string, string> {
  const token = getAuthToken();
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/notices${path}`, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export async function fetchNotices(): Promise<Notice[]> {
  const d = await call<{ notices: Notice[] }>("", { headers: headers() });
  return d.notices;
}
export async function saveNotice(id: string | null, input: NoticeInput): Promise<Notice> {
  const d = await call<{ notice: Notice }>(id ? `/${id}` : "", { method: id ? "PUT" : "POST", headers: headers(true), body: JSON.stringify(input) });
  return d.notice;
}
export async function deleteNotice(id: string): Promise<void> {
  await call(`/${id}`, { method: "DELETE", headers: headers() });
}
