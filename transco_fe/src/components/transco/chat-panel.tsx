import { useEffect, useRef } from "react";
import { AlertTriangle, ArrowLeft, Clock, Phone } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDayDivider } from "@/lib/transco/time";
import type { Conversation, ConversationMode, Message } from "@/lib/transco/types";

import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { ModeSwitch } from "./mode-switch";

function groupByDay(messages: Message[]) {
  const groups: { label: string; items: Message[] }[] = [];
  for (const m of messages) {
    const label = formatDayDivider(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(m);
    else groups.push({ label, items: [m] });
  }
  return groups;
}

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** WhatsApp only lets a free-form reply through within 24h of the
 * customer's last message — outside that window every send fails with
 * error 131047 until they write in again. Website chat has no such
 * restriction. Surfaced proactively here so staff see it before typing,
 * not just as a failed-send icon after the fact. */
function whatsappWindowClosedHoursAgo(conversation: Conversation): number | null {
  if (conversation.channel === "website") return null;
  const lastCustomerMessage = [...conversation.messages]
    .reverse()
    .find((m) => m.sender === "CUSTOMER");
  if (!lastCustomerMessage) return null;
  const elapsedMs = Date.now() - new Date(lastCustomerMessage.createdAt).getTime();
  if (elapsedMs < WHATSAPP_WINDOW_MS) return null;
  return Math.floor((elapsedMs - WHATSAPP_WINDOW_MS) / (60 * 60 * 1000));
}

export function ChatPanel({
  conversation,
  sending,
  onSend,
  onSendAttachment,
  onModeChange,
  onBack,
}: {
  conversation: Conversation;
  sending: boolean;
  onSend: (body: string) => void;
  onSendAttachment?: ((file: File, caption?: string) => Promise<void>) | undefined;
  onModeChange: (mode: ConversationMode) => void;
  onBack?: () => void;
}) {
  const isHuman = conversation.mode === "HUMAN";
  const scrollRef = useRef<HTMLDivElement>(null);
  const flaggedCreatedAt = conversation.needsAttention
    ? conversation.needsAttentionMessage?.createdAt
    : undefined;
  const windowClosedHoursAgo = whatsappWindowClosedHoursAgo(conversation);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation.id, conversation.messages.length]);

  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col border transition-colors",
        isHuman ? "border-human-border bg-human-tint" : "border-border bg-chat-canvas",
      )}
    >
      <header
        className={cn(
          "grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2.5 md:px-4",
          isHuman ? "border-human-border bg-human-tint" : "border-border bg-panel",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversations"
              className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary md:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">
              {conversation.customerName}
            </h1>
            <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
              <Phone className="h-3 w-3 shrink-0" />
              {conversation.phoneNumber}
            </p>
          </div>
        </div>
        <ModeSwitch mode={conversation.mode} onChange={onModeChange} />
      </header>

      {conversation.needsAttention && (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 md:px-6">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-destructive">Flagged for follow-up</p>
            <p className="truncate text-xs text-destructive/90">
              {conversation.needsAttentionMessage?.content ?? "The chatbot handed this off to staff."}
            </p>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4 md:px-6">
        {groupByDay(conversation.messages).map((group) => (
          <div key={group.label} className="space-y-2">
            <div className="flex justify-center py-1">
              <span className="rounded bg-panel px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border">
                {group.label}
              </span>
            </div>
            {group.items.map((m) => (
              <MessageBubble key={m.id} message={m} flagged={m.createdAt === flaggedCreatedAt} />
            ))}
          </div>
        ))}
      </div>

      {windowClosedHoursAgo !== null && (
        <div className="flex shrink-0 items-start gap-2 border-t border-amber-600/30 bg-amber-500/10 px-3 py-2 md:px-6">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This customer hasn't messaged in over 24 hours ({windowClosedHoursAgo}h past the window), so
            WhatsApp will block a new message until they write in again.
          </p>
        </div>
      )}

      <MessageComposer
        mode={conversation.mode}
        channel={conversation.channel}
        disabled={sending}
        onSend={onSend}
        onSendAttachment={onSendAttachment}
      />
    </section>
  );
}