import { useMemo, useState } from "react";
import { Search, MessageCircle, Globe } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/transco/types";

import { ContactCard } from "./contact-card";

type StatusFilter = "ALL" | "UNREAD" | "HUMAN" | "ATTENTION";
type Channel = "ALL" | "WHATSAPP" | "WEBSITE";

const statusFilters: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "UNREAD", label: "Unread" },
  { key: "HUMAN", label: "Human" },
  { key: "ATTENTION", label: "⚠️ Attention" },
];

const channels: { key: Channel; label: string; Icon: typeof MessageCircle }[] = [
  { key: "ALL", label: "All", Icon: MessageCircle },
  { key: "WHATSAPP", label: "WhatsApp", Icon: MessageCircle },
  { key: "WEBSITE", label: "Website", Icon: Globe },
];

// Absent channel means WhatsApp — every conversation that existed before
// this field was added stays correctly in the WhatsApp view.
function matchesChannel(c: ConversationSummary, channel: Channel): boolean {
  if (channel === "WEBSITE") return c.channel === "website";
  if (channel === "WHATSAPP") return c.channel !== "website";
  return true;
}

export function ContactList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<Channel>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");

  // Scoped to the selected channel — Unread/Human/Attention counts and
  // filtering apply within "Website" or "WhatsApp" independently, not
  // across both at once, whenever a specific channel is picked.
  const inChannel = useMemo(
    () => conversations.filter((c) => matchesChannel(c, channel)),
    [conversations, channel],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inChannel.filter((c) => {
      if (status === "UNREAD" && c.unreadCount === 0) return false;
      if (status === "HUMAN" && c.mode !== "HUMAN") return false;
      if (status === "ATTENTION" && !c.needsAttention) return false;
      if (!q) return true;
      return (
        c.customerName.toLowerCase().includes(q) ||
        c.phoneNumber.replace(/\s/g, "").includes(q.replace(/\s/g, ""))
      );
    });
  }, [inChannel, status, query]);

  const unreadTotal = inChannel.reduce((n, c) => n + c.unreadCount, 0);
  const humanTotal = inChannel.filter((c) => c.mode === "HUMAN").length;
  const attentionTotal = inChannel.filter((c) => c.needsAttention).length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="border-b border-border px-3 py-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-foreground">Conversations</h2>
          <p className="shrink-0 text-[11px] text-muted-foreground">
            {unreadTotal} unread · {humanTotal} human
            {attentionTotal > 0 && (
              <span className="font-medium text-destructive"> · {attentionTotal} flagged</span>
            )}
          </p>
        </div>

        {/* Channel switcher — a separate inbox per platform, "All" combines both */}
        <div className="mt-3 flex gap-1 rounded-md bg-secondary/60 p-1">
          {channels.map((c) => {
            const active = channel === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setChannel(c.key)}
                title={c.label}
                aria-label={c.label}
                aria-current={active}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-panel text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <c.Icon className="h-3.5 w-3.5" />
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

        <div className="mt-2 flex gap-1">
          {statusFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatus(f.key)}
              className={cn(
                "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                status === f.key
                  ? f.key === "ATTENTION"
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-accent text-accent-foreground"
                  : f.key === "ATTENTION" && attentionTotal > 0
                    ? "text-destructive hover:bg-destructive/10"
                    : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No conversations match this view.
          </p>
        ) : (
          visible.map((c) => (
            <ContactCard
              key={c.id}
              conversation={c}
              selected={c.id === selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
