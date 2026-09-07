import { API_BASE_URL } from "./config";

/**
 * Real auth against transco_be's /api/auth endpoints. The UI only uses
 * `login`, `logout`, `isAuthenticated`, and `getCurrentUser` — same surface
 * as the mock this replaced, so no route/component needed to change.
 */
const SESSION_KEY = "transco.session";

export interface StaffUser {
  email: string;
  name: string;
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

/** Used by api.ts to attach Authorization headers on outgoing requests. */
export function getAuthToken(): string | null {
  return readStoredSession()?.token ?? null;
}
