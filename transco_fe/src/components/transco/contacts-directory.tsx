import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
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
  MessageSquare,
  Package,
  Paperclip,
  Pencil,
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
  CUSTOMER_STATUS_LABELS,
  STAFF_CUSTOMER_STATUSES,
  type CampaignAttachment,
  type ContactSourceFilter,
  type Conversation,
  type CustomerSource,
  type CustomerStatus,
  type CustomerStatusFilter,
  type EmailCampaignResult,
  type Segment,
  type SegmentFilter,
} from "@/lib/transco/types";
import { formatPhone, phoneMatches } from "@/lib/transco/phone";
import { fetchSchedule, type ScheduleDate } from "@/lib/transco/schedule";
import { sendPortalMessage, type PortalMessageResult } from "@/lib/transco/api";

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

/** Active and Historical are both just a normal customer — no tag. */
function isNormal(s: CustomerStatus): boolean {
  return s === "ACTIVE" || s === "HISTORICAL";
}

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
  statusFilter: CustomerStatusFilter,
  hasEmailOnly: boolean,
): boolean {
  if (!matchesSourceFilter(c, sourceFilter)) return false;
  if (statusFilter === "ok_email") {
    if (!canEmail(c)) return false;
  } else if (statusFilter === "ACTIVE" || statusFilter === "HISTORICAL") {
    if (!isNormal(statusFor(c))) return false;
  } else if (statusFilter !== "any" && statusFor(c) !== statusFilter) return false;
  if (hasEmailOnly && !c.email) return false;
  return true;
}

/** When the customer first came to us: every record's id holds the time
 * it was made (MongoDB ObjectId), so this works for every customer, even
 * ones saved before we kept a separate date. Old records show the day
 * they were imported. */
function addedAt(c: Conversation): Date | null {
  return /^[0-9a-f]{24}$/i.test(c.id) ? new Date(parseInt(c.id.slice(0, 8), 16) * 1000) : null;
}

/** YYYY-MM-DD in the browser's own (Sydney) time. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const shortDate = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
const isoToDate = (iso: string) => new Date(`${iso}T00:00:00`);

type DateRange = { from: string; to: string };
type Funnel = "all" | "chatted" | "shipped" | "notShipped" | "returning" | "allShipped" | "sheet" | "silent";

/** First saved by a shipment sheet import — an old customer, even if staff
 * later added the same number again (that joins the same record and only
 * adds the Manual tag). Their Added date is the import day. */
const onlyFromSheet = (c: Conversation) =>
  c.createdByImport ?? sourcesFor(c).every((s) => s === "historical");
/** The customer sent at least one message — not just our welcome/bot ones. */
const customerWrote = (c: Conversation) => c.messages.some((m) => m.sender === "CUSTOMER");
/** Has a BL dated on/after `from` — an older shipment doesn't count. */
const hasShipmentSince = (c: Conversation, from: string) =>
  c.shipmentDates ? c.shipmentDates.some((d) => d >= from) : (c.totalShipments ?? 0) > 0;
/** Opened the website chat but never typed — not someone we know yet. */
const silentVisitor = (c: Conversation) => sourcesFor(c).every((s) => s === "website") && !customerWrote(c);
/** Counted as a new customer in the summary. */
const isFresh = (c: Conversation) => !onlyFromSheet(c) && !silentVisitor(c);

function presetRanges(): Record<string, { label: string; range: DateRange }> {
  const now = new Date();
  const today = ymd(now);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    today: { label: "Today", range: { from: today, to: today } },
    week: { label: "This week", range: { from: ymd(monday), to: today } },
    month: { label: "This month", range: { from: ymd(monthStart), to: today } },
    lastMonth: { label: "Last month", range: { from: ymd(lastStart), to: ymd(lastEnd) } },
  };
}

/** One shipment period = the day after the last cutoff up to this cutoff
 * (Shipping calendar, Sri Lanka). Only periods that have started. */
function shipmentPeriods(dates: ScheduleDate[]): { key: string; label: string; range: DateRange }[] {
  const cutoffs = [...new Set(dates.map((d) => d.cutoff))].sort();
  const today = ymd(new Date());
  const out: { key: string; label: string; range: DateRange }[] = [];
  for (let i = 1; i < cutoffs.length; i++) {
    const prev = isoToDate(cutoffs[i - 1] as string);
    prev.setDate(prev.getDate() + 1);
    const from = ymd(prev);
    const to = cutoffs[i] as string;
    if (from > today) continue;
    out.push({
      key: `ship:${to}`,
      label: `Shipment closing ${shortDate(isoToDate(to))} (from ${shortDate(prev)})`,
      range: { from, to },
    });
  }
  return out.reverse();
}

function toCsvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(rows: Conversation[]) {
  const header = ["Name", "Added", "Phone", "Email", "Sources", "Status", "Notes"];
  const lines = [header.join(",")];
  for (const c of rows) {
    const added = addedAt(c);
    lines.push(
      [
        c.customerName,
        added ? ymd(added) : "",
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
  onUpdateContact: (id: string, info: { email?: string; notes?: string; name?: string }) => void;
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
  const [statusFilter, setStatusFilter] = useState<CustomerStatusFilter>("any");
  const [hasEmailOnly, setHasEmailOnly] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [emailRecipients, setEmailRecipients] = useState<Conversation[] | null>(null);
  const [portalRecipients, setPortalRecipients] = useState<Conversation[] | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saveSegmentOpen, setSaveSegmentOpen] = useState(false);
  // "When added" filter: "any", a preset key, "ship:<cutoff>", or "custom".
  const [rangeKey, setRangeKey] = useState("any");
  const [custom, setCustom] = useState<DateRange>({ from: "", to: "" });
  const [funnel, setFunnel] = useState<Funnel>("all");
  const [sortBy, setSortBy] = useState<"name" | "added">("name");
  const [schedule, setSchedule] = useState<ScheduleDate[]>([]);

  useEffect(() => {
    fetchSchedule("sri_lanka")
      .then((r) => setSchedule(r.dates))
      .catch(() => setSchedule([]));
  }, []);

  const presets = useMemo(() => presetRanges(), []);
  const periods = useMemo(() => shipmentPeriods(schedule), [schedule]);
  const range: DateRange | null =
    rangeKey === "any"
      ? null
      : rangeKey === "custom"
        ? custom.from || custom.to
          ? { from: custom.from || "0000-01-01", to: custom.to || "9999-12-31" }
          : null
        : (presets[rangeKey]?.range ?? periods.find((p) => p.key === rangeKey)?.range ?? null);

  const sorted = useMemo(() => {
    const rows = foldLinkedWebsiteChats(conversations);
    return sortBy === "added"
      ? rows.sort((a, b) => (addedAt(b)?.getTime() ?? 0) - (addedAt(a)?.getTime() ?? 0))
      : rows.sort((a, b) => a.customerName.localeCompare(b.customerName));
  }, [conversations, sortBy]);

  // Every record whose Added date falls in the dates picked.
  const dated = useMemo(() => {
    if (!range) return sorted;
    return sorted.filter((c) => {
      const d = addedAt(c);
      const day = d ? ymd(d) : "";
      return day >= range.from && day <= range.to;
    });
  }, [sorted, range?.from, range?.to]);

  // With dates picked, the page shows only who first came to us in them:
  // old shipment-sheet customers (Added = import day) and website
  // visitors who never typed are left out of the list, chips and counts.
  const inRange = useMemo(() => (range ? dated.filter(isFresh) : sorted), [range, dated, sorted]);

  const filtered = useMemo(
    () => inRange.filter((c) => matchesAllFilters(c, filter, statusFilter, hasEmailOnly)),
    [inRange, filter, statusFilter, hasEmailOnly],
  );

  const leftOut = useMemo(
    () => (range ? dated.filter((c) => !isFresh(c) && matchesAllFilters(c, filter, statusFilter, hasEmailOnly)) : []),
    [range, dated, filter, statusFilter, hasEmailOnly],
  );

  const from = range?.from ?? "";
  const to = range?.to ?? "";
  // Returning customers: we had them before these dates (or from old
  // shipment sheets) and they made a new shipment (BL) inside them.
  const returning = useMemo(() => {
    if (!range) return [];
    const fresh = new Set(filtered.map((c) => c.id));
    return sorted.filter(
      (c) =>
        !fresh.has(c.id) &&
        matchesAllFilters(c, filter, statusFilter, hasEmailOnly) &&
        (c.shipmentDates ?? []).some((d) => d >= from && d <= to),
    );
  }, [range, filtered, sorted, filter, statusFilter, hasEmailOnly, from, to]);

  const summary = useMemo(() => {
    const shipped = filtered.filter((c) => hasShipmentSince(c, from)).length;
    return {
      total: filtered.length,
      chatted: filtered.filter(customerWrote).length,
      shipped,
      notShipped: filtered.length - shipped,
      sheet: leftOut.filter(onlyFromSheet).length,
      silent: leftOut.filter(silentVisitor).length,
      returning: returning.length,
    };
  }, [filtered, leftOut, from, returning]);

  const funnelled = useMemo(() => {
    if (!range) return filtered;
    if (funnel === "returning") return returning;
    if (funnel === "allShipped") return [...filtered.filter((c) => hasShipmentSince(c, from)), ...returning];
    if (funnel === "sheet") return leftOut.filter(onlyFromSheet);
    if (funnel === "silent") return leftOut.filter(silentVisitor);
    if (funnel === "chatted") return filtered.filter(customerWrote);
    if (funnel === "shipped") return filtered.filter((c) => hasShipmentSince(c, from));
    if (funnel === "notShipped") return filtered.filter((c) => !hasShipmentSince(c, from));
    return filtered;
  }, [filtered, leftOut, funnel, range, from, returning]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return funnelled;
    return funnelled.filter((c) => {
      // phoneMatches: "0418 448 203", "0418" or "61418…" all find 61418448203.
      return (
        c.customerName.toLowerCase().includes(q) ||
        phoneMatches(c.phoneNumber, q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [funnelled, query]);

  // Chip counts follow the dates picked.
  const counts = useMemo(() => {
    const c: Record<ContactSourceFilter, number> = {
      all: inRange.length,
      portal: 0,
      website: 0,
      manual: 0,
      whatsapp: 0,
      imported: 0,
    };
    for (const conv of inRange) {
      for (const key of SOURCE_FILTERS) {
        if (key !== "all" && matchesSourceFilter(conv, key)) c[key] += 1;
      }
    }
    return c;
  }, [inRange]);

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

  const okToEmailCount = useMemo(() => sorted.filter(canEmail).length, [sorted]);

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
            onChange={(e) => setStatusFilter(e.target.value as CustomerStatusFilter)}
            aria-label="Filter by status"
            className="h-9 rounded-md border border-input bg-secondary/60 px-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="any">Anyone</option>
            <option value="ok_email">OK to email ({okToEmailCount})</option>
            {/* Only when an old saved list asks for it. */}
            {isNormal(statusFilter as CustomerStatus) && <option value={statusFilter}>Normal</option>}
            <option value="REVIEW">Needs review ({stats.byStatus.REVIEW})</option>
            <option value="DO_NOT_CONTACT">Do not contact ({stats.byStatus.DO_NOT_CONTACT})</option>
            <option value="BLOCKED">Blocked ({stats.byStatus.BLOCKED})</option>
          </select>

          <select
            value={rangeKey}
            onChange={(e) => {
              setRangeKey(e.target.value);
              setFunnel("all");
            }}
            aria-label="When the customer was added"
            title="When the customer first came to us"
            className={cn(
              "h-9 max-w-[260px] rounded-md border border-input bg-secondary/60 px-2 text-sm text-foreground outline-none focus:border-ring",
              range && "border-primary bg-primary/5",
            )}
          >
            <option value="any">Added: any time</option>
            {Object.entries(presets).map(([key, p]) => (
              <option key={key} value={key}>Added: {p.label.toLowerCase()}</option>
            ))}
            {periods.length > 0 && (
              <optgroup label="Shipment period (Sri Lanka)">
                {periods.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </optgroup>
            )}
            <option value="custom">Added: pick dates…</option>
          </select>

          {rangeKey === "custom" && (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <input
                type="date"
                value={custom.from}
                onChange={(e) => setCustom((r) => ({ ...r, from: e.target.value }))}
                aria-label="Added from"
                className="h-9 rounded-md border border-input bg-secondary/60 px-2 text-sm text-foreground outline-none focus:border-ring"
              />
              to
              <input
                type="date"
                value={custom.to}
                onChange={(e) => setCustom((r) => ({ ...r, to: e.target.value }))}
                aria-label="Added to"
                className="h-9 rounded-md border border-input bg-secondary/60 px-2 text-sm text-foreground outline-none focus:border-ring"
              />
            </span>
          )}

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
            <button
              type="button"
              onClick={() => setPortalRecipients(visible)}
              disabled={visible.length === 0}
              title="Send a message into the My Transco chat of the customers shown below"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary px-3 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-40"
            >
              <MessageSquare className="h-4 w-4" />
              Message on My Transco
            </button>
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

        {range && (
          // Two plain answers for the dates picked: how many new customers
          // came and how many of them shipped; how many customers shipped
          // in total. Every number filters the list below.
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-secondary/30 px-3 py-2.5">
              <SummaryNumber active={funnel === "all"} onClick={() => setFunnel("all")} value={summary.total} label="new customers" big />
              <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                <SummaryNumber active={funnel === "chatted"} onClick={() => setFunnel("chatted")} value={summary.chatted} label="chatted" />
                <SummaryNumber
                  active={funnel === "shipped"}
                  onClick={() => setFunnel("shipped")}
                  value={summary.shipped}
                  label={`shipped${summary.total ? ` (${Math.round((summary.shipped / summary.total) * 100)}%)` : ""}`}
                />
                <SummaryNumber active={funnel === "notShipped"} onClick={() => setFunnel("notShipped")} value={summary.notShipped} label="not shipped yet" />
              </p>
            </div>
            <div className="rounded-md border border-border bg-secondary/30 px-3 py-2.5">
              <SummaryNumber
                active={funnel === "allShipped"}
                onClick={() => setFunnel("allShipped")}
                value={summary.shipped + summary.returning}
                label="customers shipped"
                big
              />
              <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                <SummaryNumber active={funnel === "shipped"} onClick={() => setFunnel("shipped")} value={summary.shipped} label="new" />
                <SummaryNumber active={funnel === "returning"} onClick={() => setFunnel("returning")} value={summary.returning} label="returning" />
              </p>
            </div>
            {(summary.sheet > 0 || summary.silent > 0) && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Not counted as new:{" "}
                {summary.sheet > 0 && (
                  <button type="button" onClick={() => setFunnel("sheet")} className={cn("underline-offset-2 hover:underline", funnel === "sheet" && "font-semibold text-foreground")}>
                    {summary.sheet} old customers from shipment sheets
                  </button>
                )}
                {summary.sheet > 0 && summary.silent > 0 && " · "}
                {summary.silent > 0 && (
                  <button type="button" onClick={() => setFunnel("silent")} className={cn("underline-offset-2 hover:underline", funnel === "silent" && "font-semibold text-foreground")}>
                    {summary.silent} website visitors who never typed
                  </button>
                )}
              </p>
            )}
          </div>
        )}

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
              onClick={() => setPortalRecipients(selectedConversations)}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Message on My Transco
            </button>
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
          <table className="w-full min-w-[980px] border-collapse text-sm">
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
                <th className="min-w-[200px] px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => setSortBy("name")}
                    className={cn("hover:text-foreground", sortBy === "name" && "text-foreground")}
                  >
                    Name{sortBy === "name" && " ↑"}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => setSortBy("added")}
                    title="When the customer first came to us — old records show the day they were imported"
                    className={cn("hover:text-foreground", sortBy === "added" && "text-foreground")}
                  >
                    Added{sortBy === "added" && " ↓"}
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium">Bookings</th>
                <th className="px-4 py-3 text-right font-medium">Shipments</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Last Activity</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3 font-medium">Status</th>
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
        <AddContactModal customers={sorted} onClose={() => setAddOpen(false)} onAddContact={onAddContact} />
      )}

      {emailRecipients && onSendEmailCampaign && (
        <EmailCampaignModal
          recipients={emailRecipients}
          onClose={() => setEmailRecipients(null)}
          onSend={onSendEmailCampaign}
        />
      )}

      {portalRecipients && (
        <PortalMessageModal
          recipients={portalRecipients}
          onClose={() => setPortalRecipients(null)}
          onSendEmail={onSendEmailCampaign}
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
  onUpdateContact: (id: string, info: { email?: string; notes?: string; name?: string }) => void;
  onViewProfile: () => void;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const [email, setEmail] = useState(conversation.email ?? "");
  const [notes, setNotes] = useState(conversation.notes ?? "");
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(conversation.customerName);
  const status = statusFor(conversation);

  const startNameEdit = () => {
    setName(conversation.customerName);
    setEditingName(true);
  };

  // Blank or unchanged = keep the old name (a name is never cleared).
  const commitName = () => {
    const trimmed = name.trim().slice(0, 80);
    setEditingName(false);
    if (trimmed && trimmed !== conversation.customerName)
      onUpdateContact(conversation.id, { name: trimmed });
  };

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
          {editingName ? (
            <input
              autoFocus
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setName(conversation.customerName);
                  setEditingName(false);
                }
              }}
              aria-label="Customer name"
              className="h-7 w-48 rounded border border-ring bg-secondary/60 px-1.5 text-sm font-medium text-foreground outline-none"
            />
          ) : (
            <>
              <Link
                to="/console/customers/$customerId"
                params={{ customerId: conversation.id }}
                title="Open customer profile"
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                {conversation.customerName}
              </Link>
              <button
                type="button"
                onClick={startNameEdit}
                aria-label={`Edit name of ${conversation.customerName}`}
                title="Edit name"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {!editingName && conversation.messages.length > 0 && (
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
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
        {(() => {
          const d = addedAt(conversation);
          return d ? shortDate(d) : "—";
        })()}
      </td>
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
      <td className="whitespace-nowrap px-4 py-3">
        {/* Active/Historical are just the steady state — left blank — so
            a tag only appears when staff need to notice it
            (Review/DNC/Blocked). Last column, so the blanks don't sit
            in the middle of the table. */}
        {isNormal(status) ? null : (
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
                value={isNormal(status) ? "ACTIVE" : status}
                onChange={(e) => onUpdateStatus(conversation.id, e.target.value as CustomerStatus)}
                className="h-8 rounded-md border border-input bg-secondary/60 px-2 text-xs text-foreground outline-none focus:border-ring"
              >
                {STAFF_CUSTOMER_STATUSES.map((s) => (
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

/** Same number, however it's typed: 0412 345 678 = +61 412 345 678. */
function samePhone(a: string, b: string): boolean {
  const tail = (v: string) => v.replace(/\D/g, "").slice(-9);
  return tail(a).length === 9 && tail(a) === tail(b);
}

function AddContactModal({
  customers,
  onClose,
  onAddContact,
}: {
  customers: Conversation[];
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

  // Like saving a contact on a phone: while staff type, show who we
  // already have, so the same customer isn't added twice.
  const phoneDigits = phone.replace(/\D/g, "");
  // Website chat visitors have an id here, not a number.
  const withPhone = useMemo(() => customers.filter((c) => /^\+?[\d\s()-]{8,}$/.test(c.phoneNumber)), [customers]);
  const exact = phoneDigits.length >= 9 ? withPhone.find((c) => samePhone(c.phoneNumber, phone)) : undefined;
  const byPhone = phoneDigits.length >= 4 && !exact ? withPhone.filter((c) => phoneMatches(c.phoneNumber, phone)).slice(0, 4) : [];
  const nameQ = name.trim().toLowerCase();
  const byName =
    nameQ.length >= 3
      ? customers.filter((c) => c.id !== exact?.id && !byPhone.includes(c) && c.customerName.toLowerCase().includes(nameQ)).slice(0, 4)
      : [];

  const canSave = name.trim().length > 0 && phone.trim().length > 0 && !saving && !exact;

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
          {exact && (
            <div className="rounded-md border border-border bg-warning-soft px-2.5 py-2 text-warning-foreground">
              <p className="font-medium">This number is already saved:</p>
              <ExistingCustomer c={exact} onOpen={onClose} />
            </div>
          )}
          {byPhone.length > 0 && (
            <div className="rounded-md border border-border bg-secondary/40 px-2.5 py-2">
              <p className="text-muted-foreground">Numbers like this already saved — is it one of them?</p>
              {byPhone.map((c) => <ExistingCustomer key={c.id} c={c} onOpen={onClose} />)}
            </div>
          )}
          {byName.length > 0 && (
            <div className="rounded-md border border-border bg-secondary/40 px-2.5 py-2">
              <p className="text-muted-foreground">Same name already saved (check it isn't them with another number):</p>
              {byName.map((c) => <ExistingCustomer key={c.id} c={c} onOpen={onClose} />)}
            </div>
          )}
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
          {exact ? (
            <Link
              to="/console/customers/$customerId"
              params={{ customerId: exact.id }}
              onClick={onClose}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Open this customer
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add customer"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryNumber({ value, label, active, onClick, big }: {
  value: number; label: string; active: boolean; onClick: () => void; big?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded text-left underline-offset-4 hover:underline",
        active && "underline decoration-2 decoration-primary",
        big ? "text-base text-foreground" : "",
      )}
    >
      <b className={cn("tabular-nums text-foreground", big && "text-xl")}>{value}</b> {label}
    </button>
  );
}

function ExistingCustomer({ c, onOpen }: { c: Conversation; onOpen: () => void }) {
  const shipments = c.totalShipments ?? 0;
  return (
    <Link
      to="/console/customers/$customerId"
      params={{ customerId: c.id }}
      onClick={onOpen}
      className="mt-1 flex items-center justify-between gap-2 rounded px-1 py-0.5 text-foreground hover:bg-panel"
    >
      <span className="min-w-0 truncate">
        <span className="font-medium">{c.customerName}</span>
        <span className="text-muted-foreground"> · {formatPhone(c.phoneNumber)}</span>
        {shipments > 0 && <span className="text-muted-foreground"> · {shipments} shipment{shipments === 1 ? "" : "s"}</span>}
      </span>
      <span className="shrink-0 text-primary">Open →</span>
    </Link>
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

/**
 * One message into each customer's My Transco chat (shows as "Transco team"
 * with a red unread count when they open the website). Only customers with a
 * My Transco account get it — the server counts them first (dry run).
 * Optionally the same message by email too (the email campaign above).
 */
function PortalMessageModal({
  recipients,
  onClose,
  onSendEmail,
}: {
  recipients: Conversation[];
  onClose: () => void;
  onSendEmail?:
    | ((customerIds: string[], subject: string, body: string, attachment?: CampaignAttachment | undefined) => Promise<EmailCampaignResult>)
    | undefined;
}) {
  const ids = useMemo(() => recipients.map((c) => c.id), [recipients]);
  const [count, setCount] = useState<PortalMessageResult | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  // A flyer/photo shown with the message (and attached to the email, if ticked).
  const [picture, setPicture] = useState<{ file: CampaignAttachment; previewUrl: string } | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  useEffect(() => () => {
    if (picture) URL.revokeObjectURL(picture.previewUrl);
  }, [picture]);

  const pickPicture = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setPictureError(null);
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setPictureError("Pick a picture (JPG or PNG).");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setPictureError("That picture is too big (max 6 MB).");
      return;
    }
    try {
      setPicture({ file: await readFileAsAttachment(file), previewUrl: URL.createObjectURL(file) });
      setConfirming(false);
    } catch {
      setPictureError("Couldn't read that picture. Try another one.");
    }
  };
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [subject, setSubject] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ portal: PortalMessageResult; email: EmailCampaignResult | null; emailError: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    sendPortalMessage(ids, "", true)
      .then((r) => !cancelled && setCount(r))
      .catch((e: unknown) => !cancelled && setCountError(e instanceof Error ? e.message : "Couldn't count who can get it."));
    return () => {
      cancelled = true;
    };
  }, [ids]);

  const emailCount = recipients.filter(canEmail).length;
  const willReach = count?.willReach ?? 0;
  const canSend =
    (body.trim().length > 0 || picture !== null) &&
    !sending &&
    willReach > 0 &&
    (!alsoEmail || (subject.trim().length > 0 && body.trim().length > 0));

  const handleSend = async () => {
    if (!canSend) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const portal = await sendPortalMessage(
        ids,
        body.trim(),
        false,
        picture ? { data: picture.file.contentBase64, mimeType: picture.file.contentType } : undefined,
      );
      let email: EmailCampaignResult | null = null;
      let emailError: string | null = null;
      if (alsoEmail && onSendEmail && emailCount > 0) {
        try {
          email = await onSendEmail(ids, subject.trim(), body.trim(), picture?.file);
        } catch (e) {
          emailError = e instanceof Error ? e.message : "The email didn't go out.";
        }
      }
      setResult({ portal, email, emailError });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send — please try again.");
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {result ? "Message sent" : "Message on My Transco"}
            </h3>
            {!result && (
              <p className="text-xs text-muted-foreground">
                Shows in each customer's My Transco chat from "Transco team", with a red count when they open the website.
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-secondary" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          <div className="space-y-2 px-5 py-6 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-success-foreground" />
              <p className="text-base">
                In the My Transco chat of <span className="font-semibold text-foreground">{result.portal.sent}</span>{" "}
                {result.portal.sent === 1 ? "customer" : "customers"}
              </p>
            </div>
            {result.portal.failed > 0 && (
              <p className="text-attention-foreground">{result.portal.failed} didn't go through — try them again later.</p>
            )}
            {result.email && (
              <p className="text-muted-foreground">
                Also emailed {result.email.sent} {result.email.sent === 1 ? "customer" : "customers"}
                {result.email.failed > 0 ? ` (${result.email.failed} failed)` : ""}.
              </p>
            )}
            {result.emailError && <p className="text-attention-foreground">Email: {result.emailError}</p>}
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
                {countError ? (
                  <p className="text-attention-foreground">{countError}</p>
                ) : !count ? (
                  <p className="text-muted-foreground">Checking who has a My Transco account…</p>
                ) : (
                  <>
                    <p className="text-foreground">
                      Will reach <span className="font-semibold">{willReach}</span> of {recipients.length}
                    </p>
                    {count.skippedNoAccount > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {count.skippedNoAccount} {count.skippedNoAccount === 1 ? "has" : "have"} no My Transco account — skipped
                      </p>
                    )}
                    {count.skippedExcludedStatus > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {count.skippedExcludedStatus} marked Do not contact / Blocked — skipped
                      </p>
                    )}
                  </>
                )}
              </div>

              <Field label="Message">
                <textarea
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setConfirming(false);
                  }}
                  rows={6}
                  autoFocus
                  placeholder="e.g. Hi! Our next shipment to Sri Lanka closes Saturday 7 Nov. Book online in 2 minutes from your My Transco."
                  className="w-full resize-y rounded-md border border-input bg-secondary/60 px-2.5 py-2 text-sm outline-none focus:border-ring"
                />
              </Field>

              <Field label="Flyer or photo (optional)">
                {picture ? (
                  <div className="flex items-start gap-3 rounded-md border border-input bg-secondary/40 p-2">
                    <img src={picture.previewUrl} alt="Picture to send" className="h-24 w-24 shrink-0 rounded object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-foreground">{picture.file.filename}</p>
                      <p className="text-xs text-muted-foreground">Shows in their chat with the message.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPicture(null);
                        setConfirming(false);
                      }}
                      aria-label="Remove picture"
                      className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-input text-muted-foreground hover:bg-secondary/40">
                    <Paperclip className="h-3.5 w-3.5" />
                    Add a picture
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pickPicture} className="hidden" />
                  </label>
                )}
                {pictureError && <p className="mt-1 text-xs text-attention-foreground">{pictureError}</p>}
              </Field>

              {onSendEmail && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-foreground">
                    <input
                      type="checkbox"
                      checked={alsoEmail}
                      onChange={(e) => {
                        setAlsoEmail(e.target.checked);
                        setConfirming(false);
                      }}
                    />
                    Also send by email ({emailCount} {emailCount === 1 ? "has" : "have"} an email address)
                  </label>
                  {alsoEmail && (
                    <Field label="Email subject">
                      <input
                        value={subject}
                        onChange={(e) => {
                          setSubject(e.target.value);
                          setConfirming(false);
                        }}
                        placeholder="e.g. Next shipment to Sri Lanka closes Saturday"
                        className="h-9 w-full rounded-md border border-input bg-secondary/60 px-2.5 text-sm outline-none focus:border-ring"
                      />
                    </Field>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-attention-foreground">{error}</p>}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
              {confirming && !sending && (
                <p className="mr-auto text-xs text-muted-foreground">Messages can't be taken back once sent.</p>
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
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {sending ? "Sending…" : confirming ? `Yes, send to ${willReach}` : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
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
