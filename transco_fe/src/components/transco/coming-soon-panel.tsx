import type { LucideIcon } from "lucide-react";

/** Shared empty-state for nav sections whose module hasn't shipped yet
 * (per the phased CRM/ERP rollout) — keeps the full target navigation
 * visible and clickable from day one instead of a broken link or a
 * fake data screen, without inventing numbers for anything real. */
export function ComingSoonPanel({
  icon: Icon,
  title,
  phase,
}: {
  icon: LucideIcon;
  title: string;
  phase: string;
}) {
  return (
    <div className="grid h-full place-items-center bg-chat-canvas px-6 text-center">
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-secondary text-muted-foreground">
          <Icon className="h-6 w-6" />
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{phase}</p>
      </div>
    </div>
  );
}
