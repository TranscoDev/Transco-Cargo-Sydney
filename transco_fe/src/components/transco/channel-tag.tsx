import { Globe } from "lucide-react";

import { cn } from "@/lib/utils";

/** Only rendered for website-originated conversations — WhatsApp ones
 * (the default/implicit channel) show no badge at all, so the existing
 * WhatsApp view is visually unchanged. */
export function ChannelTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        "bg-secondary text-muted-foreground ring-1 ring-inset ring-border",
        className,
      )}
    >
      <Globe className="h-3 w-3" />
      Website
    </span>
  );
}
