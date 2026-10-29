import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bookmark,
  BookmarkPlus,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Download,
  Globe,
  Info,
  Mail,
  MessageCircle,
  Package,
  Paperclip,
  Plus,
  Search,
  Square,
  SquareUserRound,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/transco/page-kit";
import {
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_LABELS,
  MODE_LABELS,
  type CampaignAttachment,
  type ContactSourceFilter,
  type Conversation,
  type CustomerSource,
  type CustomerStatus,
  type EmailCampaignResult,
  type Segment,
  type SegmentFilter,
} from "@/lib/transco/types";
import { formatPhone, phoneMatches } from "@/lib/transco/phone";

/**
 * Address-book view of every customer — separate from ContactList (the
 * conversation inbox sidebar). This is a flat, searchable directory for
 * staff to look someone up by phone/email/name and add contact notes,
 * independent of chat history. Also the CRM surface for historical
 * (Excel-imported) customers: filterable by source, with a profile view
 * for shipment history and a staff-controlled status (separate from
 * source — see CustomerStatus in types.ts).
 */

const SOURCE_BADGE: Record<
  CustomerSource,
  { label: string; icon: typeof Globe; className: string }
> = {
  whatsapp: {
    label: "WhatsApp",
    icon: MessageCircle,
    className: "bg-success-soft text-success-foreground",
  },
  website: {
    label: "Website",
    icon: Globe,
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  historical: {
    label: "Historical",
    icon: Package,
    className: "bg-warning-soft text-warning-foreground",
  },
  manual: {
    label: "Manual",
    icon: Plus,
    className: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
  portal: {
    label: "Online account",
    icon: SquareUserRound,
    className: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
  },
};

const STATUS_BADGE: Record<CustomerStatus, string> = {
  ACTIVE: "bg-secondary text-muted-foreground",
  HISTORICAL: "bg-secondary text-secondary-foreground",
  REVIEW: "bg-warning-soft text-warning-foreground",
  DO_NOT_CONTACT: "bg-attention-soft text-attention-foreground",
  BLOCKED: "bg-attention-soft text-attention-foreground",
};

/** Old records predate the sources[] field — derive a sensible source list
 * from `channel` instead of showing nothing. */
function sourcesFor(c: Conversation): CustomerSource[] {
  if (c.sources && c.sources.length > 0) return c.sources;
  return [c.channel === "website" ? "website" : "whatsapp"];
}

/** One row per customer. Every website chat a signed-in (or staff-linked)
 * customer starts is its own record (one per browser), so without this the
 * same person shows once per chat. Those chats fold into the account's row —
 * their messages count toward its last activity and it gets the Website
 * badge. Never by name or phone: an unlinked website visitor keeps a row. */
function foldLinkedWebsiteChats(conversations: Conversation[]): Conversation[] {
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const ownerOf = (c: Conversation) => {
    const owner = c.channel === "website" && c.linkedAccount ? byId.get(c.linkedAccount.id) : undefined;
    return owner && owner.id !== c.id ? owner : undefined;
  };
  const folded = new Map<string, Conversation[]>();
  for (const c of conversations) {
    const owner = ownerOf(c);
    if (owner) folded.set(owner.id, [...(folded.get(owner.id) ?? []), c]);
  }
  return conversations
    .filter((c) => !ownerOf(c))
    .map((c) => {
      const web = folded.get(c.id);
      if (!web) return c;
      const sources = sourcesFor(c);
      return {
        ...c,
        sources: sources.includes("website") ? sources : [...sources, "website"],
        messages: [c, ...web]
          .flatMap((x) => x.messages)
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
      };
    });
}

function statusFor(c: Conversation): CustomerStatus {
  return c.status ?? "ACTIVE";
}

/** "How they joined" filter chips, in the order staff mostly need them. */
const SOURCE_FILTERS: ContactSourceFilter[] = ["all", "portal", "website", "manual", "whatsapp", "imported"];

const SOURCE_FILTER_LABELS: Record<ContactSourceFilter, string> = {
  all: "Everyone",
  portal: "Online account",
  website: "Website chat",
  manual: "Added by staff",
  whatsapp: "WhatsApp",
  imported: "Old records",
};

const SOURCE_FILTER_HINTS: Record<ContactSourceFilter, string> = {
  all: "Every customer",
  portal: "Signed up on the website, by a quick register link, or at the counter",
  website: "Chatted on the website",
  manual: "Added here with Add customer",
  whatsapp: "Messaged us on WhatsApp",
  imported: "Only in the old shipment sheets — never contacted us online",
};

/** Can be emailed: has an email and isn't Do Not Contact / Blocked. */
function canEmail(c: Conversation): boolean {
  const s = statusFor(c);
  return Boolean(c.email) && s !== "DO_NOT_CONTACT" && s !== "BLOCKED";
}

function matchesSourceFilter(c: Conversation, filter: ContactSourceFilter): boolean {
  if (filter === "all") return true;
  const sources = sourcesFor(c);
  if (filter === "imported") {
    return (
      sources.includes("historical") &&
      !sources.includes("whatsapp") &&
      !sources.includes("website")
    );
  }
  return sources.includes(filter);
}

function matchesAllFilters(
  c: Conversation,
  sourceFilter: ContactSourceFilter,
  statusFilter: CustomerStatus | "any",
  hasEmailOnly: boolean,
): boolean {
  if (!matchesSourceFilter(c, sourceFilter)) return false;
  if (statusFilter !== "any" && statusFor(c) !== statusFilter) return false;
  if (hasEmailOnly && !c.email) return false;
  return true;
}

function toCsvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(rows: Conversation[]) {
  const header = ["Name", "Phone", "Email", "Sources", "Status", "Notes"];
  const lines = [header.join(",")];
  for (const c of rows) {
    lines.push(
      [
        c.customerName,
        c.phoneNumber,
        c.email ?? "",
        sourcesFor(c).join(" | "),
        CUSTOMER_STATUS_LABELS[statusFor(c)],
        c.notes ?? "",
      ]
        .map(toCsvCell)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transco-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ContactsDirectory({
  conversations,
  onSelect,
  onUpdateContact,
  onUpdateStatus,
  onAddContact,
  onSendEmailCampaign,
  segments = [],
  onSaveSegment,
  onDeleteSegment,
}: {
  conversations: Conversation[];
  onSelect: (id: string) => void;
  onUpdateContact: (id: string, info: { email?: string; notes?: string }) => void;
  onUpdateStatus?: (id: string, status: CustomerStatus) => void;
  onAddContact?: (info: {
    name: string;
    phone: string;
    email?: string | undefined;
    notes?: string | undefined;
  }) => Promise<void>;
  onSendEmailCampaign?: (
    customerIds: string[],
    subject: string,
    body: string,
    attachment?: CampaignAttachment | undefined,
  ) => Promise<EmailCampaignResult>;
  segments?: Segment[];
  onSaveSegment?: (name: string, filter: SegmentFilter) => Promise<void>;
  onDeleteSegment?: (segmentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContactSourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | "any">("any");
  const [hasEmailOnly, setHasEmailOnly] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [emailRecipients, setEmailRecipients] = useState<Conversation[] | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saveSegmentOpen, setSaveSegmentOpen] = useState(false);

  const sorted = useMemo(
    () => foldLinkedWebsiteChats(conversations).sort((a, b) => a.customerName.localeCompare(b.customerName)),
    [conversations],
  );

  const filtered = useMemo(
    () => sorted.filter((c) => matchesAllFilters(c, filter, statusFilter, hasEmailOnly)),
    [sorted, filter, statusFilter, hasEmailOnly],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((c) => {
      // phoneMatches: "0418 448 203", "0418" or "61418…" all find 61418448203.
      return (
        c.customerName.toLowerCase().includes(q) ||
        phoneMatches(c.phoneNumber, q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [filtered, query]);

  const counts = useMemo(() => {
    const c: Record<ContactSourceFilter, number> = {
      all: sorted.length,
      portal: 0,
      website: 0,
      manual: 0,
      whatsapp: 0,
      imported: 0,
    };
    for (const conv of sorted) {
      for (const key of SOURCE_FILTERS) {
        if (key !== "all" && matchesSourceFilter(conv, key)) c[key] += 1;
      }
    }
    return c;
  }, [sorted]);

  const stats = useMemo(() => {
    const byStatus: Record<CustomerStatus, number> = {
      ACTIVE: 0,
      HISTORICAL: 0,
      REVIEW: 0,
      DO_NOT_CONTACT: 0,
      BLOCKED: 0,
    };
    let withEmail = 0;
    for (const c of sorted) {
      byStatus[statusFor(c)] += 1;
      if (c.email) withEmail += 1;
    }
    return { total: sorted.length, byStatus, withEmail };
  }, [sorted]);

  const profileContact = profileId ? (conversations.find((c) => c.id === profileId) ?? null) : null;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleAllSelected = visible.length > 0 && visible.every((c) => selectedIds.has(c.id));

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (visibleAllSelected) {
        for (const c of visible) next.delete(c.id);
      } else {
        for (const c of visible) next.add(c.id);
      }
      return next;
    });
  };

  const selectedConversations = useMemo(
    () => sorted.filter((c) => selectedIds.has(c.id)),
    [sorted, selectedIds],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="border-b border-border px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Customers</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Click a name to see their profile, bookings and shipments.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
              {/* Only surfaced when non-zero — these need staff action, unlike
                  Active/Historical which are just the normal steady state. */}
              {stats.byStatus.REVIEW > 0 && <StatusBadge tone="pending">{stats.byStatus.REVIEW} need review</StatusBadge>}
              {stats.byStatus.DO_NOT_CONTACT + stats.byStatus.BLOCKED > 0 && (
                <StatusBadge tone="attention">
                  {stats.byStatus.DO_NOT_CONTACT + stats.byStatus.BLOCKED} do not contact / blocked
                </StatusBadge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onAddContact && (
              <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add customer
              </Button>
            )}
          </div>
        </div>

        {/* One toolbar: search, then the filters, then the page actions. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, email or notes"
              aria-label="Search customers"
              className="h-9 w-full rounded-md border border-input bg-secondary/60 pl-8 pr-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:bg-panel"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CustomerStatus | "any")}
            aria-label="Filter by status"
            className="h-9 rounded-md border border-input bg-secondary/60 px-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="any">Any status</option>
            {CUSTOMER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CUSTOMER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-secondary/60 px-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={hasEmailOnly}
              onChange={(e) => setHasEmailOnly(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Has email <span className="text-muted-foreground">{stats.withEmail}</span>
          </label>

          {(segments.length > 0 || onSaveSegment) && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setSavedOpen((o) => !o)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-foreground hover:bg-secondary"
              >
                <Bookmark className="h-4 w-4" />
                Saved lists{segments.length > 0 && <span className="text-muted-foreground">{segments.length}</span>}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {savedOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setSavedOpen(false)} />
                  <div className="absolute left-0 z-30 mt-1 w-64 rounded-md border border-border bg-panel p-1 shadow-lg">
                    {segments.length === 0 && (
                      <p className="px-2.5 py-2 text-xs text-muted-foreground">
                        No saved lists yet. Pick your filters, then save them here to reuse later.
                      </p>
                    )}
                    {segments.map((s) => (
                      <div key={s.id} className="flex items-center rounded hover:bg-secondary">
                        <button
                          type="button"
                          onClick={() => {
                            setFilter(s.filter.sourceFilter);
                            setStatusFilter(s.filter.statusFilter);
                            setHasEmailOnly(s.filter.hasEmailOnly);
                            setSavedOpen(false);
                          }}
                          className="flex-1 truncate px-2.5 py-1.5 text-left text-sm text-foreground"
                        >
                          {s.name}
                        </button>
                        {onDeleteSegment && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Delete the saved list "${s.name}"?`)) onDeleteSegment(s.id);
                            }}
                            aria-label={`Delete saved list ${s.name}`}
                            className="mr-1 rounded p-1 text-muted-foreground hover:bg-panel hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {onSaveSegment && (
                      <button
                        type="button"
                        onClick={() => {
                          setSavedOpen(false);
                          setSaveSegmentOpen(true);
                        }}
                        className="mt-1 flex w-full items-center gap-1.5 border-t border-border px-2.5 pb-1.5 pt-2 text-left text-sm text-primary hover:bg-secondary"
                      >
                        <BookmarkPlus className="h-4 w-4" />
                        Save these filters
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadCsv(visible)}
              title="Download the customers shown below as a spreadsheet"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-foreground hover:bg-secondary"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            {onSendEmailCampaign && (
              <button
                type="button"
                onClick={() => setEmailRecipients(visible)}
                disabled={visible.length === 0}
                title="Email the customers shown below"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                <Mail className="h-4 w-4" />
                Email {visible.length === sorted.length ? "everyone" : `these ${visible.length}`}
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {SOURCE_FILTERS.filter((key) => key === "all" || key === filter || counts[key] > 0).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              title={SOURCE_FILTER_HINTS[key]}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {SOURCE_FILTER_LABELS[key]} <span className="opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>

        {selectedIds.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium text-foreground">{selectedIds.size} ticked</span>
            {onSendEmailCampaign && (
              <button
                type="button"
                onClick={() => setEmailRecipients(selectedConversations)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                <Mail className="h-3.5 w-3.5" />
                Email them
              </button>
            )}
            <button
              type="button"
              onClick={() => downloadCsv(selectedConversations)}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-panel px-2.5 py-1 text-xs text-foreground hover:bg-secondary"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Untick all
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No contacts match this search.
          </p>
        ) : (
          <table className="w-full min-w-[1080px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-panel text-left text-xs text-muted-foreground shadow-[0_1px_0_0_theme(colors.border)]">
              <tr>
                <th className="px-2 py-2">
                  <button
                    type="button"
                    onClick={toggleSelectAllVisible}
                    aria-label={visibleAllSelected ? "Deselect all visible" : "Select all visible"}
                    className="flex items-center text-muted-foreground hover:text-foreground"
                  >
                    {visibleAllSelected ? (
                      <CheckSquare className="h-3.5 w-3.5" />
                    ) : (
                      <Square className="h-3.5 w-3.5" />
                    )}
                  </button>
                </th>
                <th className="min-w-[200px] px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 text-right font-medium">Bookings</th>
                <th className="px-4 py-3 text-right font-medium">Shipments</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Last Activity</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <ContactRow
                  key={c.id}
                  conversation={c}
                  onSelect={onSelect}
                  onUpdateContact={onUpdateContact}
                  onViewProfile={() => setProfileId(c.id)}
                  selected={selectedIds.has(c.id)}
                  onToggleSelected={() => toggleSelected(c.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {profileContact && (
        <ContactProfileModal
          conversation={profileContact}
          onClose={() => setProfileId(null)}
          onUpdateStatus={onUpdateStatus}
        />
      )}

      {addOpen && onAddContact && (
        <AddContactModal onClose={() => setAddOpen(false)} onAddContact={onAddContact} />
      )}

      {emailRecipients && onSendEmailCampaign && (
        <EmailCampaignModal
          recipients={emailRecipients}
          onClose={() => setEmailRecipients(null)}
          onSend={onSendEmailCampaign}
        />
      )}

      {saveSegmentOpen && onSaveSegment && (
        <SaveSegmentModal
          filter={{ sourceFilter: filter, statusFilter, hasEmailOnly }}
          onClose={() => setSaveSegmentOpen(false)}
          onSave={onSaveSegment}
        />
      )}

    </div>
  );
}

function SourceBadges({ sources }: { sources: CustomerSource[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {sources.map((s) => {
        // A source this page doesn't know yet is skipped, never allowed
        // to take the whole Customers page down.
        const badge = SOURCE_BADGE[s] as (typeof SOURCE_BADGE)[CustomerSource] | undefined;
        if (!badge) return null;
        const Icon = badge.icon;
        return (
          <span
            key={s}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
              badge.className,
            )}
          >
            <Icon className="h-3 w-3" />
            {badge.label}
          </span>
        );
      })}
    </div>
  );
}

function ContactRow({
  conversation,
  onSelect,
  onUpdateContact,
  onViewProfile,
  selected,
  onToggleSelected,
}: {
  conversation: Conversation;
  onSelect: (id: string) => void;
  onUpdateContact: (id: string, info: { email?: string; notes?: string }) => void;
  onViewProfile: () => void;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const [email, setEmail] = useState(conversation.email ?? "");
  const [notes, setNotes] = useState(conversation.notes ?? "");
  const status = statusFor(conversation);

  const commitEmail = () => {
    const trimmed = email.trim();
    if (trimmed !== (conversation.email ?? ""))
      onUpdateContact(conversation.id, { email: trimmed });
  };

  const commitNotes = () => {
    const trimmed = notes.trim();
    if (trimmed !== (conversation.notes ?? ""))
      onUpdateContact(conversation.id, { notes: trimmed });
  };

  return (
    <tr
      className={cn(
        "border-b border-border/60 hover:bg-secondary/40",
        selected && "bg-secondary/30",
      )}
    >
      <td className="px-2 py-3">
        <button
          type="button"
          onClick={onToggleSelected}
          aria-label={
            selected
              ? `Deselect ${conversation.customerName}`
              : `Select ${conversation.customerName}`
          }
          className="flex items-center text-muted-foreground hover:text-foreground"
        >
          {selected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex items-center gap-1">
          {/* The name opens the customer's profile (the usual first stop
              when a customer calls or walks in); the chat icon opens their
              conversation. */}
          <Link
            to="/console/customers/$customerId"
            params={{ customerId: conversation.id }}
            title="Open customer profile"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {conversation.customerName}
          </Link>
          {conversation.messages.length > 0 && (
            <button
              type="button"
              onClick={() => onSelect(conversation.id)}
              aria-label={`Open conversation with ${conversation.customerName}`}
              title="Open conversation"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
        {formatPhone(conversation.phoneNumber)}
      </td>
      <td className="px-4 py-3">
        <SourceBadges sources={sourcesFor(conversation)} />
      </td>
      <td className="px-4 py-3">
        {/* Active/Historical are just the steady state — plain text, no
            pill — so the colored badge only draws the eye for statuses
            that actually need staff attention (Review/DNC/Blocked). */}
        {status === "ACTIVE" || status === "HISTORICAL" ? (
          <span className="text-muted-foreground">{CUSTOMER_STATUS_LABELS[status]}</span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
              STATUS_BADGE[status],
            )}
          >
            {CUSTOMER_STATUS_LABELS[status]}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{MODE_LABELS[conversation.mode]}</td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
        {conversation.totalBookings ?? 0}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
        {conversation.totalShipments ?? 0}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
        {formatLastActivity(conversation)}
      </td>
      <td className="px-4 py-3">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={commitEmail}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="Add email"
          className="h-7 w-40 rounded border border-transparent bg-transparent px-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground hover:border-input focus:border-ring focus:bg-secondary/60"
        />
      </td>
      <td className="px-4 py-3">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="Add note"
          className="h-7 w-56 rounded border border-transparent bg-transparent px-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground hover:border-input focus:border-ring focus:bg-secondary/60"
        />
      </td>
      <td className="px-2 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onViewProfile}
            aria-label={`Quick view for ${conversation.customerName}`}
            title="Quick view"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          <Link
            to="/console/customers/$customerId"
            params={{ customerId: conversation.id }}
            aria-label={`Open full CRM profile for ${conversation.customerName}`}
            title="Open full profile"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <SquareUserRound className="h-3.5 w-3.5" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

/** "3h ago" / "2 days ago" / a short date once it's old enough — same
 * lastActivity() a conversation row's own list already sorts by
 * (store.tsx), just formatted for a table cell here. */
function formatLastActivity(conversation: Conversation): string {
  const last = conversation.messages[conversation.messages.length - 1];
  if (!last) return "—";
  const date = new Date(last.createdAt);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return diffMins <= 1 ? "Just now" : `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function ContactProfileModal({
  conversation,
  onClose,
  onUpdateStatus,
}: {
  conversation: Conversation;
  onClose: () => void;
  onUpdateStatus?: ((id: string, status: CustomerStatus) => void) | undefined;
}) {
  const sources = sourcesFor(conversation);
  const status = statusFor(conversation);
  const shipments = conversation.shipments ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Customer Profile</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-xs">
          <div>
            <p className="text-[15px] font-semibold text-foreground">{conversation.customerName}</p>
            <p className="mt-0.5 text-muted-foreground">{formatPhone(conversation.phoneNumber)}</p>
            {conversation.email && <p className="text-muted-foreground">{conversation.email}</p>}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sources
            </p>
            <SourceBadges sources={sources} />
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </p>
            {onUpdateStatus ? (
              <select
                value={status}
                onChange={(e) => onUpdateStatus(conversation.id, e.target.value as CustomerStatus)}
                className="h-8 rounded-md border border-input bg-secondary/60 px-2 text-xs text-foreground outline-none focus:border-ring"
              >
                {CUSTOMER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CUSTOMER_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center rounded px-1.5 py-0.5 text-xs",
                  STATUS_BADGE[status],
                )}
              >
                {CUSTOMER_STATUS_LABELS[status]}
              </span>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Shipment History {shipments.length > 0 && `(${shipments.length})`}
            </p>
            {shipments.length === 0 ? (
              <p className="text-muted-foreground">No historical shipment records.</p>
            ) : (
              <ul className="space-y-2">
                {shipments.map((s) => (
                  <li key={s.id} className="rounded-md border border-border/60 px-2.5 py-2">
                    <p className="font-medium text-foreground">To {s.receiverName}</p>
                    <p className="text-muted-foreground">{s.receiverAddress}</p>
                    {s.receiverPhone && <p className="text-muted-foreground">{s.receiverPhone}</p>}
                    {s.batchNumber && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Shipment {s.batchNumber}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {conversation.notes && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Notes
              </p>
              <p className="whitespace-pre-wrap text-foreground">{conversation.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddContactModal({
  onClose,
  onAddContact,
}: {
  onClose: () => void;
  onAddContact: (info: {
    name: string;
    phone: string;
    email?: string | undefined;
    notes?: string | undefined;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && phone.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onAddContact({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add contact");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Add customer</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 text-xs">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-secondary/60 px-2 text-xs outline-none focus:border-ring"
              autoFocus
            />
          </Field>
          <Field label="Phone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 0412 345 678"
              className="h-8 w-full rounded-md border border-input bg-secondary/60 px-2 text-xs outline-none focus:border-ring"
            />
          </Field>
          <Field label="Email (optional)">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-secondary/60 px-2 text-xs outline-none focus:border-ring"
            />
          </Field>
          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-secondary/60 px-2 py-1.5 text-xs outline-none focus:border-ring"
            />
          </Field>

          {error && <p className="text-xs text-attention-foreground">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add customer"}
          </button>
        </div>
      </div>
    </div>
  );
}

const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

function readFileAsAttachment(file: File): Promise<CampaignAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.onload = () => {
      // dataURL looks like "data:image/png;base64,AAAA..." — Resend wants
      // just the base64 payload, not the data-URL prefix.
      const result = reader.result as string;
      const base64 = result.slice(result.indexOf(",") + 1);
      resolve({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        contentBase64: base64,
      });
    };
    reader.readAsDataURL(file);
  });
}

function EmailCampaignModal({
  recipients,
  onClose,
  onSend,
}: {
  recipients: Conversation[];
  onClose: () => void;
  onSend: (
    customerIds: string[],
    subject: string,
    body: string,
    attachment?: CampaignAttachment | undefined,
  ) => Promise<EmailCampaignResult>;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<CampaignAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EmailCampaignResult | null>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setAttachmentError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachmentError(
        `"${file.name}" is too large (max 6MB) — try a smaller image or a compressed PDF.`,
      );
      return;
    }
    try {
      setAttachment(await readFileAsAttachment(file));
    } catch {
      setAttachmentError("Could not read that file — try a different one.");
    }
  };

  const [confirming, setConfirming] = useState(false);
  const [showWho, setShowWho] = useState(false);

  // Same rules the server applies: blocked / do-not-contact first, then no email.
  const willGet = recipients.filter(canEmail);
  const excludedCount = recipients.filter(
    (c) => statusFor(c) === "DO_NOT_CONTACT" || statusFor(c) === "BLOCKED",
  ).length;
  const noEmailCount = recipients.length - willGet.length - excludedCount;
  const willSendCount = willGet.length;
  const previewName = willGet[0]?.customerName ?? "there";

  const canSend =
    subject.trim().length > 0 && body.trim().length > 0 && !sending && willSendCount > 0;

  const handleSend = async () => {
    if (!canSend) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await onSend(
        recipients.map((c) => c.id),
        subject.trim(),
        body.trim(),
        attachment ?? undefined,
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the email — please try again.");
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {result ? "Email sent" : "Send an email"}
            </h3>
            {!result && (
              <p className="text-xs text-muted-foreground">
                One email to each customer, from Transco. Each person only sees their own name.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          <div className="space-y-3 px-5 py-6 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-success-foreground" />
              <p className="text-base">
                Sent to <span className="font-semibold text-foreground">{result.sent}</span>{" "}
                {result.sent === 1 ? "customer" : "customers"}
              </p>
            </div>
            {result.skippedNoEmail > 0 && (
              <p className="text-muted-foreground">{result.skippedNoEmail} skipped — no email address</p>
            )}
            {result.skippedExcludedStatus > 0 && (
              <p className="text-muted-foreground">{result.skippedExcludedStatus} skipped — marked Do not contact / Blocked</p>
            )}
            {result.failed > 0 && (
              <p className="text-attention-foreground">
                {result.failed} didn't go through — their email address may be wrong.
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
              <div className="rounded-md border border-border bg-secondary/30 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-foreground">
                    <span className="font-semibold">{willSendCount}</span>{" "}
                    {willSendCount === 1 ? "customer will get it" : "customers will get it"}
                  </p>
                  {willSendCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowWho((v) => !v)}
                      className="text-xs text-primary underline-offset-2 hover:underline"
                    >
                      {showWho ? "Hide list" : "See who"}
                    </button>
                  )}
                </div>
                {noEmailCount > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {noEmailCount} {noEmailCount === 1 ? "has" : "have"} no email address — skipped
                  </p>
                )}
                {excludedCount > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {excludedCount} marked Do not contact / Blocked — skipped
                  </p>
                )}
                {willSendCount === 0 && (
                  <p className="mt-1 text-xs text-attention-foreground">
                    Nobody here has an email address yet. Add emails on the Customers page first.
                  </p>
                )}
                {showWho && (
                  <ul className="mt-2 max-h-36 space-y-0.5 overflow-y-auto border-t border-border pt-2 text-xs">
                    {willGet.map((c) => (
                      <li key={c.id} className="flex justify-between gap-3">
                        <span className="truncate text-foreground">{c.customerName}</span>
                        <span className="truncate text-muted-foreground">{c.email}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Field label="Subject">
                <input
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setConfirming(false);
                  }}
                  placeholder="e.g. Next shipment to Sri Lanka closes Friday"
                  className="h-9 w-full rounded-md border border-input bg-secondary/60 px-2.5 text-sm outline-none focus:border-ring"
                  autoFocus
                />
              </Field>
              <Field label="Message">
                <textarea
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setConfirming(false);
                  }}
                  rows={7}
                  placeholder="Write your message. We add “Hi (their name),” at the top for you."
                  className="w-full resize-y rounded-md border border-input bg-secondary/60 px-2.5 py-2 text-sm outline-none focus:border-ring"
                />
              </Field>

              <Field label="Flyer, photo or PDF (optional)">
                {attachment ? (
                  <div className="flex items-center justify-between rounded-md border border-input bg-secondary/60 px-2 py-1.5">
                    <span className="truncate text-foreground">{attachment.filename}</span>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      aria-label="Remove attachment"
                      className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-input text-muted-foreground hover:bg-secondary/40">
                    <Paperclip className="h-3.5 w-3.5" />
                    Attach a file
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                )}
                {attachmentError && (
                  <p className="mt-1 text-xs text-attention-foreground">{attachmentError}</p>
                )}
              </Field>

              {(subject.trim() || body.trim()) && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">How it will look</p>
                  <div className="rounded-md border border-border bg-background px-3 py-2.5 text-sm">
                    <p className="font-semibold text-foreground">{subject.trim() || "(no subject)"}</p>
                    <div className="mt-2 whitespace-pre-wrap text-foreground">
                      <p>Hi {previewName},</p>
                      <p className="mt-2">{body.trim()}</p>
                    </div>
                    {attachment && (
                      <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Paperclip className="h-3 w-3" />
                        {attachment.filename}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-attention-foreground">{error}</p>}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
              {confirming && !sending && (
                <p className="mr-auto text-xs text-muted-foreground">
                  Emails can't be taken back once sent.
                </p>
              )}
              <button
                type="button"
                onClick={confirming ? () => setConfirming(false) : onClose}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
              >
                {confirming ? "Go back" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {sending
                  ? "Sending…"
                  : confirming
                    ? `Yes, send to ${willSendCount}`
                    : `Send to ${willSendCount} ${willSendCount === 1 ? "customer" : "customers"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SaveSegmentModal({
  filter,
  onClose,
  onSave,
}: {
  filter: SegmentFilter;
  onClose: () => void;
  onSave: (name: string, filter: SegmentFilter) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), filter);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save segment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Save these filters as a list</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 text-xs">
          <Field label="List name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Online accounts with email"
              className="h-8 w-full rounded-md border border-input bg-secondary/60 px-2 text-xs outline-none focus:border-ring"
              autoFocus
            />
          </Field>
          {error && <p className="text-xs text-attention-foreground">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save list"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
