import { useState } from "react";
import { BellOff, Heart, Pin } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/transco/time";
import type { ConversationSummary, InboxFlags } from "@/lib/transco/types";

import { ChatMenu } from "./chat-menu";

export interface LinkActions {
  onLink?: (() => void) | undefined;
  onUnlink?: (() => void) | undefined;
}
import { ModeTag } from "./mode-tag";
import { ChannelTag } from "./channel-tag";
import { MessageStatusIcon } from "./message-status";
import { UnreadBadge } from "./unread-badge";
import { formatPhone } from "@/lib/transco/phone";
import { WarehouseTag } from "./ask-warehouse";

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

/** "…678" — enough to tell two customers with the same name apart. */
function phoneEnding(phone: string | null | undefined) {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length >= 6 ? `…${d.slice(-3)}` : null;
}

export function ContactCard({
  conversation,
  selected,
  onSelect,
  onInbox,
  onMarkRead,
  canDelete,
  linkActions,
}: {
  conversation: ConversationSummary;
  selected: boolean;
  onSelect: (id: string) => void;
  onInbox: (flags: InboxFlags) => void;
  onMarkRead: () => void;
  canDelete: boolean;
  linkActions: LinkActions;
}) {
  const { lastMessage, mode, channel, unreadCount, needsAttention, needsAttentionMessage } = conversation;
  const inbox = conversation.inbox ?? {};
  const isHuman = mode === "HUMAN";
  const preview = lastMessage?.body ?? "No messages yet";
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="group relative"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
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
          needsAttention && "bg-attention",
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
              "flex shrink-0 items-center gap-1 text-xs tabular-nums",
              unreadCount > 0 ? "font-medium text-primary" : "text-muted-foreground",
            )}
          >
            {inbox.favourite && <Heart className="h-3 w-3 fill-current text-attention" aria-label="Favourite" />}
            {inbox.muted && <BellOff className="h-3 w-3 text-muted-foreground" aria-label="Muted" />}
            {inbox.pinned && <Pin className="h-3 w-3 text-muted-foreground" aria-label="Pinned" />}
            {formatRelativeTime(conversation.lastActivityAt)}
          </span>
        </span>

        {/* Tells same-name customers apart: customer number · last digits of the phone. */}
        <span className="block truncate text-xs text-muted-foreground">
          {[
            conversation.customerCode,
            channel === "website" && !conversation.linkedAccount ? "Website visitor" : phoneEnding(conversation.linkedAccount?.phoneNumber ?? conversation.phoneNumber),
          ]
            .filter(Boolean)
            .join(" · ")}
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
          {unreadCount > 0 ? (
            <UnreadBadge count={unreadCount} />
          ) : (
            inbox.markedUnread && <span className="h-3 w-3 shrink-0 rounded-full bg-primary" aria-label="Marked unread" />
          )}
        </span>

        {needsAttention && (
          <span className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <span className="shrink-0">⚠️</span>
            <span className="truncate">{needsAttentionMessage?.content ?? "Flagged for follow-up"}</span>
          </span>
        )}

        <span className="mt-1.5 flex flex-wrap items-center gap-1">
          <ModeTag mode={mode} />
          <WarehouseTag conversation={conversation} />
          {conversation.mergedIds?.length ? (
            // One customer, both channels (see merge-conversations.ts).
            <>
              <span className="inline-flex items-center rounded bg-success-soft px-1.5 py-0.5 text-xs font-medium text-success-foreground">💬 WhatsApp</span>
              <ChannelTag />
            </>
          ) : (
            channel === "website" && <ChannelTag />
          )}
          {channel === "website" && !conversation.linkedAccount && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">not signed in</span>
          )}
          {/* Signed in to My Transco while chatting on the website — we know
              who this is: their real number and customer code. */}
          {conversation.linkedAccount && !conversation.mergedIds?.length && (
            <span
              className="inline-flex items-center gap-1 rounded bg-success-soft px-1.5 py-0.5 text-xs font-medium text-success-foreground"
              title={`${conversation.linkedAccount.byStaff ? "Linked by staff" : "Signed in to My Transco"} · ${formatPhone(conversation.linkedAccount.phoneNumber ?? "")}`}
            >
              {conversation.linkedAccount.byStaff ? "🔗 Linked" : "✓ Signed in"}
              {conversation.linkedAccount.customerCode ? ` · ${conversation.linkedAccount.customerCode}` : ""}
            </span>
          )}
        </span>
      </span>
    </button>
    <div className="absolute bottom-2.5 right-3">
      <ChatMenu
        conversation={conversation}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onChange={onInbox}
        onMarkRead={onMarkRead}
        canDelete={canDelete}
        onLink={linkActions.onLink}
        onUnlink={linkActions.onUnlink}
      />
    </div>
    </div>
  );
}