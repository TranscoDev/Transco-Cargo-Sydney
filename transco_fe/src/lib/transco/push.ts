// Console notifications (backend pushNotify.js): new bookings and tasks
// pop up on this computer/phone even when the console tab isn't open.
// public/sw.js shows them.
import { API_BASE_URL } from "./config";
import { getAuthToken } from "./auth";

export interface PushPrefs {
  bookings: boolean;
  tasks: boolean;
}

export type PushSupport = "ok" | "unsupported" | "blocked";

function headers(): Record<string, string> {
  const token = getAuthToken();
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/push${path}`, {
    method,
    headers: headers(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Notifications request failed (${res.status})`);
  return data as T;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission === "denied" ? "blocked" : "ok";
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js");
}

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** This browser's current state and choices. */
export async function getPushState(): Promise<{ subscribed: boolean; prefs: PushPrefs }> {
  let endpoint = "";
  if (pushSupport() === "ok") {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    endpoint = sub?.endpoint ?? "";
  }
  return call("GET", `/staff?endpoint=${encodeURIComponent(endpoint)}`);
}

/** Asks permission (first time), then saves this browser with the choices. */
export async function turnOnPush(prefs: PushPrefs): Promise<{ subscribed: boolean; prefs: PushPrefs }> {
  const { key } = await call<{ key: string | null }>("GET", "/key");
  if (!key) throw new Error("Notifications aren't set up on the server yet.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not allowed. Allow them in the browser's site settings (the 🔒 next to the address).");
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  return call("POST", "/staff", { subscription: sub.toJSON(), prefs });
}

export async function turnOffPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  await call("DELETE", "/staff", { endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => {});
}
