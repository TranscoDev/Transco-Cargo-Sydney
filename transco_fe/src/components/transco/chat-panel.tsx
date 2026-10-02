import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Clock, Phone, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDayDivider } from "@/lib/transco/time";
import type { Conversation, ConversationMode, Message } from "@/lib/transco/types";

import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { ModeSwitch } from "./mode-switch";
import { formatPhone } from "@/lib/transco/phone";

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
  // A signed-in website chat opens the customer's real profile, not the
  // anonymous chat record.
  const profileId = conversation.linkedAccount?.id ?? conversation.id;

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
            <h1 className="truncate text-base font-semibold text-foreground">
              <Link
                to="/console/customers/$customerId"
                params={{ customerId: profileId }}
                title="Open customer profile"
                className="hover:underline"
              >
                {conversation.customerName}
              </Link>
            </h1>
            <p className="flex items-center gap-3 truncate text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3 shrink-0" aria-hidden />
                {formatPhone(conversation.phoneNumber)}
              </span>
              {conversation.linkedAccount && (
                <span className="rounded bg-success-soft px-1.5 font-medium text-success-foreground">
                  ✓ Signed in{conversation.linkedAccount.customerCode ? ` · ${conversation.linkedAccount.customerCode}` : ""}
                </span>
              )}
              <Link
                to="/console/customers/$customerId"
                params={{ customerId: profileId }}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <UserRound className="h-3 w-3 shrink-0" aria-hidden />
                View profile
              </Link>
            </p>
          </div>
        </div>
        <ModeSwitch mode={conversation.mode} onChange={onModeChange} />
      </header>

      {conversation.needsAttention && (
        <div className="flex shrink-0 items-start gap-2.5 border-b border-attention/20 bg-attention-soft px-3 py-2.5 md:px-6">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-attention" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-attention-foreground">The bot asked for staff help</p>
            <p className="truncate text-sm text-attention-foreground/85">
              {conversation.needsAttentionMessage?.content ?? "The bot handed this chat to staff."}
            </p>
            {!isHuman && <p className="mt-0.5 text-xs text-attention-foreground/80">Take over the chat to reply yourself.</p>}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4 md:px-6">
        {groupByDay(conversation.messages).map((group) => (
          <div key={group.label} className="space-y-2">
            <div className="flex justify-center py-1">
              <span className="rounded-full bg-panel px-3 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">
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
        <div className="flex shrink-0 items-start gap-2 border-t border-warning/30 bg-warning-soft px-3 py-2 md:px-6">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p className="text-sm text-warning-foreground">
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