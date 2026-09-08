import { Bot, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { MODE_LABELS, type ConversationMode } from "@/lib/transco/types";

export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: ConversationMode;
  onChange: (mode: ConversationMode) => void;
}) {
  const isHuman = mode === "HUMAN";

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex items-center rounded-md border border-border bg-secondary/60 p-0.5"
        role="group"
        aria-label="Conversation mode"
      >
        {(["CHATBOT", "HUMAN"] as ConversationMode[]).map((m) => {
          const active = mode === m;
          const Icon = m === "HUMAN" ? UserRound : Bot;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(m)}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                !active && "text-muted-foreground hover:text-foreground",
                active && m === "HUMAN" && "bg-human text-human-foreground shadow-sm",
                active && m === "CHATBOT" && "bg-panel text-foreground shadow-sm",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {MODE_LABELS[m]}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onChange(isHuman ? "CHATBOT" : "HUMAN")}
        className={cn(
          "hidden rounded-md px-3 py-1.5 text-xs font-medium transition-colors lg:inline-flex",
          isHuman
            ? "border border-human-border bg-human-tint text-human-foreground hover:bg-human-soft"
            : "border border-border bg-panel text-foreground hover:bg-secondary",
        )}
      >
        {isHuman ? "Switch to Chatbot" : "Switch to Staff"}
      </button>
    </div>
  );
}