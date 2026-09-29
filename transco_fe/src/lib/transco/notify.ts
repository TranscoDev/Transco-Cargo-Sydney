import { toast } from "sonner";

/**
 * Calm action feedback for staff: a small toast after something worked
 * ("✓ Booking confirmed") or didn't ("Couldn't save … Nothing was
 * changed."). Use for results of a click — not for page-load errors
 * (those use ErrorState on the page).
 */
export const notify = {
  /** Pass `undo` to offer a one-click way back (kept on screen longer). */
  success(message: string, description?: string, undo?: () => void) {
    toast.success(message, {
      description,
      duration: undo ? 8000 : 3000,
      ...(undo ? { action: { label: "Undo", onClick: undo } } : {}),
    });
  },
  error(message: string, description = "Please try again. Nothing was changed.") {
    toast.error(message, { description, duration: 6000 });
  },
  info(message: string, description?: string) {
    toast(message, { description, duration: 4000 });
  },
};

/** Turns any thrown value into a short, staff-readable sentence. */
export function friendlyError(err: unknown, fallback = "Something went wrong"): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!raw) return fallback;
  // Hide raw transport/status noise; keep real validation messages.
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return "Couldn't reach the server. Check your internet connection.";
  if (/\(\s*5\d\d\s*\)|status 5\d\d|internal server error/i.test(raw)) return fallback;
  return raw;
}
