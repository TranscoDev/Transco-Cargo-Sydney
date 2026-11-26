import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

declare const __BUILD_ID__: string;

// After a deploy, an open console keeps running the old version until it is
// reloaded (moving between pages never reloads it). This checks
// /version.json every 2 minutes and when the tab comes back, and when a newer
// build is live it reloads by itself at a safe moment — the tab is hidden or
// staff move to another page — but never while something is typed, so no
// work is lost. A small bar offers "Refresh" meanwhile.
const CHECK_EVERY_MS = 2 * 60 * 1000;

function somethingTyped() {
  return Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type]), input[type=text], input[type=tel], input[type=email], input[type=number]"))
    .some((el) => !el.readOnly && !el.disabled && el.value.trim() !== "");
}

export function UpdateCheck() {
  const router = useRouter();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let newer = false;
    let stopped = false;

    const reloadIfSafe = () => {
      if (newer && !somethingTyped()) window.location.reload();
    };

    const check = async () => {
      if (newer || stopped) return;
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return; // dev, or an older deploy without the file
        const { id } = (await r.json()) as { id?: string };
        if (id && id !== __BUILD_ID__) {
          newer = true;
          setStale(true);
          if (document.hidden) reloadIfSafe();
        }
      } catch {
        /* offline — try again next time */
      }
    };

    const onVisibility = () => {
      if (document.hidden) reloadIfSafe();
      else void check();
    };
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    // Staff opened another page: a good moment to switch to the new version.
    const unsubscribe = router.subscribe("onResolved", () => reloadIfSafe());
    void check();

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      unsubscribe();
    };
  }, [router]);

  if (!stale) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full border bg-background px-4 py-2 text-sm shadow-lg">
      <span>The console was updated.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Refresh
      </button>
    </div>
  );
}
