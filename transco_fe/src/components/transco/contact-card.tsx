import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/transco/time";
import type { ConversationSummary } from "@/lib/transco/types";

import { ModeTag } from "./mode-tag";
import { ChannelTag } from "./channel-tag";
import { MessageStatusIcon } from "./message-status";
import { UnreadBadge } from "./unread-badge";

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function ContactCard({
  conversation,
  selected,
  onSelect,
}: {
  conversation: ConversationSummary;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { lastMessage, mode, channel, unreadCount, needsAttention, needsAttentionMessage } = conversation;
  const isHuman = mode === "HUMAN";
  const preview = lastMessage?.body ?? "No messages yet";

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-current={selected}
      className={cn(
        "relative flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition-colors",
        "hover:bg-secondary/70",
        isHuman && "bg-human-tint hover:bg-human-soft/50",
        selected && "bg-secondary",
        selected && isHuman && "bg-human-soft/60",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          isHuman ? "bg-human" : "bg-transparent",
          needsAttention && "bg-destructive",
          selected && !isHuman && !needsAttention && "bg-primary",
        )}
      />
      <span className="relative mt-0.5 shrink-0">
        <span
          className={cn(
            "grid h-10 w-10 place-items-center rounded-full text-xs font-semibold",
            isHuman
              ? "bg-human-soft text-human-foreground"
              : "bg-secondary text-secondary-foreground",
          )}
        >
          {initials(conversation.customerName)}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-sm text-foreground",
              unreadCount > 0 ? "font-semibold" : "font-medium",
            )}
          >
            {conversation.customerName}
          </span>
          <span
            className={cn(
              "shrink-0 text-[11px] tabular-nums",
              unreadCount > 0 ? "font-medium text-primary" : "text-muted-foreground",
            )}
          >
            {formatRelativeTime(conversation.lastActivityAt)}
          </span>
        </span>

        <span className="mt-1 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            {lastMessage && lastMessage.sender !== "CUSTOMER" && (
              <MessageStatusIcon status={lastMessage.status} className="shrink-0" />
            )}
            <span
              className={cn(
                "truncate text-xs",
                unreadCount > 0 ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {preview}
            </span>
          </span>
          <UnreadBadge count={unreadCount} />
        </span>

        {needsAttention && (
          <span className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <span className="shrink-0">⚠️</span>
            <span className="truncate">{needsAttentionMessage?.content ?? "Flagged for follow-up"}</span>
          </span>
        )}

        <span className="mt-1.5 flex items-center gap-1">
          <ModeTag mode={mode} />
          {channel === "website" && <ChannelTag />}
        </span>
      </span>
    </button>
  );
}