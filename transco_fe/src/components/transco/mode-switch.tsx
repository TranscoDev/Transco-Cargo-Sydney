import { Bot, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationMode } from "@/lib/transco/types";

/**
 * Who is answering this customer, in plain words, with the one thing
 * staff can do about it: take over from the bot, or hand the chat back.
 * (Replaces a CHATBOT/STAFF toggle plus a second "Switch to…" button
 * that did the same thing.)
 */
export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: ConversationMode;
  onChange: (mode: ConversationMode) => void;
}) {
  const isHuman = mode === "HUMAN";

  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex",
          isHuman ? "bg-human-soft text-human-foreground" : "bg-secondary text-secondary-foreground",
        )}
      >
        {isHuman ? <UserRound className="h-3.5 w-3.5" aria-hidden /> : <Bot className="h-3.5 w-3.5" aria-hidden />}
        {isHuman ? "You're replying" : "Bot is replying"}
      </span>
      {isHuman ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange("CHATBOT")}>
          <Bot className="mr-1.5 h-4 w-4" aria-hidden />
          Hand back to bot
        </Button>
      ) : (
        <Button type="button" size="sm" onClick={() => onChange("HUMAN")}>
          <UserRound className="mr-1.5 h-4 w-4" aria-hidden />
          Take over chat
        </Button>
      )}
    </div>
  );
}
