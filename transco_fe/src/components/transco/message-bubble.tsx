import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/lib/transco/time";
import { renderWhatsAppText } from "@/lib/transco/whatsapp-format";
import type { Message } from "@/lib/transco/types";

import { MessageStatusIcon } from "./message-status";

export function MessageBubble({
  message,
  flagged = false,
}: {
  message: Message;
  /** True for the specific message that triggered a needs-attention flag —
   * gives it a visible outline so staff can spot it while scrolling,
   * instead of having to guess which message the flag banner refers to. */
  flagged?: boolean;
}) {
  const outgoing = message.sender !== "CUSTOMER";
  const isHuman = message.sender === "HUMAN";

  return (
    <div className={cn("flex w-full", outgoing ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm sm:max-w-[65%]",
          !outgoing && "rounded-tl-sm bg-bubble-in text-foreground ring-1 ring-inset ring-border",
          outgoing && !isHuman && "rounded-tr-sm bg-bubble-out text-foreground",
          isHuman &&
            "rounded-tr-sm bg-human-soft text-foreground ring-1 ring-inset ring-human-border",
          flagged && "ring-2 ring-destructive ring-offset-1 ring-offset-chat-canvas",
        )}
      >
        {message.sender === "CHATBOT" && (
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Chatbot
          </p>
        )}
        {isHuman && (
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-human-foreground">
            Staff
          </p>
        )}
        {flagged && (
          <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-destructive">
            ⚠️ Flagged
          </p>
        )}
        <p className="whitespace-pre-wrap break-words leading-snug">
          {renderWhatsAppText(message.body)}
        </p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] tabular-nums text-muted-foreground">
          {formatMessageTime(message.createdAt)}
          {outgoing && <MessageStatusIcon status={message.status} />}
        </p>
      </div>
    </div>
  );
}