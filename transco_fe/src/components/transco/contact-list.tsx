import { useMemo, useState } from "react";
import { Archive, ArrowLeft, CheckCircle2, Search, MessageCircle, Globe, PauseCircle } from "lucide-react";
import { EmptyState } from "./page-kit";

import { cn } from "@/lib/utils";
import type { ConversationSummary, InboxFlags } from "@/lib/transco/types";

import { ContactCard } from "./contact-card";

type StatusFilter = "ALL" | "UNREAD" | "HUMAN" | "ATTENTION" | "FAVOURITES" | "INTERNAL";
type Channel = "ALL" | "WHATSAPP" | "WEBSITE";

const statusFilters: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "UNREAD", label: "Unread" },
  { key: "ATTENTION", label: "Needs staff" },
  { key: "HUMAN", label: "Taken over" },
  { key: "FAVOURITES", label: "Favourites" },
  { key: "INTERNAL", label: "Internal" },
];

const isUnread = (c: ConversationSummary) => c.unreadCount > 0 || !!c.inbox?.markedUnread;

// Pinned chats first (like WhatsApp), then newest activity.
function byPinThenRecent(a: ConversationSummary, b: ConversationSummary) {
  const pin = Number(!!b.inbox?.pinned) - Number(!!a.inbox?.pinned);
  return pin || Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
}

const channels: { key: Channel; label: string; Icon: typeof MessageCircle }[] = [
  { key: "ALL", label: "All", Icon: MessageCircle },
  { key: "WHATSAPP", label: "WhatsApp", Icon: MessageCircle },
  { key: "WEBSITE", label: "Website", Icon: Globe },
];

// Absent channel means WhatsApp — every conversation that existed before
// this field was added stays correctly in the WhatsApp view.
function matchesChannel(c: ConversationSummary, channel: Channel): boolean {
  // A customer row with both channels shows under both tabs.
  if (channel === "WEBSITE") return c.channel === "website" || !!c.channels?.includes("website");
  if (channel === "WHATSAPP") return c.channel !== "website" || !!c.channels?.includes("whatsapp");
  return true;
}

export function ContactList({
  conversations,
  selectedId,
  onSelect,
  websitePaused,
  whatsappPaused,
  onInbox,
  onMarkRead,
  canDelete,
}: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInbox: (id: string, flags: InboxFlags) => void;
  onMarkRead: (id: string) => void;
  canDelete: boolean;
  /** Shows a paused indicator directly on the Website tab, independent of
   * whatsappPaused — so staff can see at a glance which channel (if any)
   * is currently paused without opening the Bot Controls dropdown. */
  websitePaused: boolean;
  whatsappPaused: boolean;
}) {
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<Channel>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [showArchived, setShowArchived] = useState(false);

  // Scoped to the selected channel — Unread/Human/Attention counts and
  // filtering apply within "Website" or "WhatsApp" independently, not
  // across both at once, whenever a specific channel is picked.
  // Deleted chats never show; our own staff only show under Internal.
  const inChannel = useMemo(
    () => conversations.filter((c) => !c.inbox?.deleted && matchesChannel(c, channel)),
    [conversations, channel],
  );
  const customerChats = useMemo(() => inChannel.filter((c) => !c.inbox?.isStaff), [inChannel]);
  const archived = useMemo(() => customerChats.filter((c) => c.inbox?.archived), [customerChats]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base =
      status === "INTERNAL"
        ? inChannel.filter((c) => c.inbox?.isStaff)
        : showArchived
          ? archived
          : customerChats.filter((c) => !c.inbox?.archived);
    return base
      .filter((c) => {
        if (status === "UNREAD" && !isUnread(c)) return false;
        if (status === "HUMAN" && c.mode !== "HUMAN") return false;
        if (status === "ATTENTION" && !c.needsAttention) return false;
        if (status === "FAVOURITES" && !c.inbox?.favourite) return false;
        if (!q) return true;
        return (
          c.customerName.toLowerCase().includes(q) ||
          c.phoneNumber.replace(/\s/g, "").includes(q.replace(/\s/g, ""))
        );
      })
      .sort(byPinThenRecent);
  }, [inChannel, customerChats, archived, showArchived, status, query]);

  // Muted and staff chats don't add to the unread count.
  const counted = customerChats.filter((c) => !c.inbox?.muted && !c.inbox?.archived);
  const unreadTotal = counted.filter(isUnread).length;
  const humanTotal = counted.filter((c) => c.mode === "HUMAN").length;
  const attentionTotal = counted.filter((c) => c.needsAttention).length;
  const archivedUnread = archived.filter(isUnread).length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="border-b border-border px-3 py-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <h1 className="truncate text-base font-semibold text-foreground">Conversations</h1>
          <p className="shrink-0 text-xs text-muted-foreground">
            {unreadTotal} unread · {humanTotal} taken over
            {attentionTotal > 0 && (
              <span className="font-medium text-attention-foreground"> · {attentionTotal} need staff</span>
            )}
          </p>
        </div>

        {/* Channel switcher — a separate inbox per platform, "All" combines both.
            A channel tab whose bot is currently paused gets amber styling
            (matching the Bot Controls banner/dropdown elsewhere), so staff
            can see which channel is paused without opening that dropdown. */}
        <div className="mt-3 flex gap-1 rounded-md bg-secondary/60 p-1">
          {channels.map((c) => {
            const active = channel === c.key;
            const paused = c.key === "WEBSITE" ? websitePaused : c.key === "WHATSAPP" ? whatsappPaused : false;
            const label = paused ? `${c.label} (Paused)` : c.label;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setChannel(c.key)}
                title={label}
                aria-label={label}
                aria-current={active}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors",
                  paused
                    ? active
                      ? "bg-warning-soft text-warning-foreground shadow-sm ring-1 ring-warning/40"
                      : "bg-warning-soft/60 text-warning-foreground hover:bg-warning-soft"
                    : active
                      ? "bg-panel text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                )}
              >
                {paused ? <PauseCircle className="h-3.5 w-3.5" /> : <c.Icon className="h-3.5 w-3.5" />}
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or number"
            aria-label="Search conversations"
            className="h-9 w-full rounded-md border border-input bg-secondary/60 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:bg-panel"
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {statusFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setStatus(f.key);
                setShowArchived(false);
              }}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                status === f.key
                  ? f.key === "ATTENTION"
                    ? "bg-attention-soft text-attention-foreground ring-1 ring-attention/40"
                    : "bg-accent text-accent-foreground"
                  : f.key === "ATTENTION" && attentionTotal > 0
                    ? "text-attention-foreground hover:bg-attention-soft"
                    : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* WhatsApp-style "Archived" row at the top of the list. */}
        {status !== "INTERNAL" && (showArchived || archived.length > 0) && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left text-sm hover:bg-secondary/70"
          >
            {showArchived ? <ArrowLeft className="h-4 w-4 text-primary" /> : <Archive className="h-4 w-4 text-primary" />}
            <span className="flex-1 font-medium text-foreground">{showArchived ? "Back to chats" : "Archived"}</span>
            {!showArchived && (
              <span className={cn("text-xs", archivedUnread > 0 ? "font-semibold text-primary" : "text-muted-foreground")}>
                {archivedUnread > 0 ? `${archivedUnread} unread` : archived.length}
              </span>
            )}
          </button>
        )}
        {visible.length === 0 ? (
          <EmptyState
            compact
            icon={query ? Search : CheckCircle2}
            title={query ? "No conversations found" : "Nothing here right now"}
            description={query ? "Try a different name or number." : "You're all caught up in this view."}
          />
        ) : (
          visible.map((c) => (
            <ContactCard
              key={c.id}
              conversation={c}
              selected={c.id === selectedId}
              onSelect={onSelect}
              onInbox={(flags) => onInbox(c.id, flags)}
              onMarkRead={() => onMarkRead(c.id)}
              canDelete={canDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
