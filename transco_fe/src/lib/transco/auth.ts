import { API_BASE_URL } from "./config";

/**
 * Real auth against transco_be's /api/auth endpoints. The UI only uses
 * `login`, `logout`, `isAuthenticated`, and `getCurrentUser` — same surface
 * as the mock this replaced, so no route/component needed to change.
 */
const SESSION_KEY = "transco.session";

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  /** "admin" | "warehouse" | "custom" | null (older accounts: every page). */
  role?: string | null;
  /** Console page keys this login may open; null/undefined = every page. */
  pages?: string[] | null;
}

interface StoredSession {
  token: string;
  user: StaffUser;
}

export async function login(email: string, password: string): Promise<StaffUser> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error("Unable to reach the server. Please try again.");
  }

  if (!res.ok) {
    throw new Error("Invalid email or password. Please try again.");
  }

  let session: StoredSession;
  try {
    session = (await res.json()) as StoredSession;
  } catch {
    throw new Error("Unable to sign in. Please try again.");
  }

  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  return session.user;
}

export function logout() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(SESSION_KEY);
}

function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function getCurrentUser(): StaffUser | null {
  return readStoredSession()?.user ?? null;
}

export function isAuthenticated(): boolean {
  return getCurrentUser() !== null;
}

/** Whether this login may open a console page (see staffAccess.js on the backend). */
export function canSee(page: string | undefined): boolean {
  // Settings (own password, theme) is open to every login; its staff
  // list checks the "settings" page itself.
  if (!page || page === "settings") return true;
  const pages = getCurrentUser()?.pages;
  return !pages || pages.includes(page);
}

/** Console path → page key, e.g. "/console/bookings/123" → "bookings". */
export function pageForPath(pathname: string): string | undefined {
  const rest = pathname.replace(/^\/console\/?/, "");
  if (!rest) return undefined;
  if (rest.startsWith("ai/bot-controls")) return "bot-controls";
  if (rest.startsWith("inventory/activity")) return "packaging";
  const first = rest.split("/")[0];
  return first || undefined;
}

/** Re-reads page access from the server (an admin may have changed it). */
export async function refreshAccess(): Promise<StaffUser | null> {
  const session = readStoredSession();
  if (!session || typeof window === "undefined") return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/session`, { headers: { Authorization: `Bearer ${session.token}` } });
    if (!res.ok) return session.user;
    const data = (await res.json()) as { user?: { pages?: string[] | null } };
    const user = { ...session.user, pages: data.user?.pages ?? null };
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, user }));
    return user;
  } catch {
    return session.user;
  }
}

/** Used by api.ts to attach Authorization headers on outgoing requests. */
export function getAuthToken(): string | null {
  return readStoredSession()?.token ?? null;
}
