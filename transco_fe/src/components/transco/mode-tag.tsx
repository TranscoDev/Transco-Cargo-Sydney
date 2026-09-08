import { Bot, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { MODE_LABELS, type ConversationMode } from "@/lib/transco/types";

export function ModeTag({ mode, className }: { mode: ConversationMode; className?: string }) {
  const isHuman = mode === "HUMAN";
  const Icon = isHuman ? UserRound : Bot;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        isHuman
          ? "bg-human-soft text-human-foreground"
          : "bg-secondary text-muted-foreground ring-1 ring-inset ring-border",
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {MODE_LABELS[mode]}
    </span>
  );
}