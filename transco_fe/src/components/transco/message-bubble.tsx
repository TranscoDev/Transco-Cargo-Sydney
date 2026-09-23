import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/lib/transco/time";
import { renderWhatsAppText } from "@/lib/transco/whatsapp-format";
import type { Message } from "@/lib/transco/types";

import { MessageStatusIcon } from "./message-status";

function MediaContent({ message }: { message: Message }) {
  if (!message.mediaUrl) return null;
  switch (message.mediaType) {
    case "image":
      return (
        <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={message.mediaUrl}
            alt={message.body || "Attachment"}
            className="mb-1 max-h-64 w-full rounded-md object-cover"
          />
        </a>
      );
    case "video":
      return (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={message.mediaUrl} controls className="mb-1 max-h-64 w-full rounded-md" />
      );
    case "audio":
      return <audio src={message.mediaUrl} controls className="mb-1 w-full" />;
    default:
      return (
        <a
          href={message.mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-1 flex items-center gap-2 rounded-md bg-black/5 px-2.5 py-2 underline-offset-2 hover:underline dark:bg-white/5"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate text-sm">Document</span>
        </a>
      );
  }
}

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
        <MediaContent message={message} />
        {message.body && (
          <p className="whitespace-pre-wrap break-words leading-snug">
            {renderWhatsAppText(message.body)}
          </p>
        )}
        {message.status === "FAILED" && message.failureReason && (
          <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-destructive">
            ⚠️ {message.failureReason}
          </p>
        )}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] tabular-nums text-muted-foreground">
          {formatMessageTime(message.createdAt)}
          {outgoing && (
            <MessageStatusIcon status={message.status} failureReason={message.failureReason} />
          )}
        </p>
      </div>
    </div>
  );
}