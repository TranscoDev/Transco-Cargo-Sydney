import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import {
  Bookmark,
  BookmarkPlus,
  CheckSquare,
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
  Upload,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
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
  type ImportResult,
  type Segment,
  type SegmentFilter,
} from "@/lib/transco/types";

/**
 * Address-book view of every customer — separate from ContactList (the
 * conversation inbox sidebar). This is a flat, searchable directory for
 * staff to look someone up by phone/email/name and add contact notes,
 * independent of chat history. Also the CRM surface for historical
 * (Excel-imported) customers: filterable by source, with a profile view
 * for shipment history and a staff-controlled status (separate from
 * source — see CustomerStatus in types.ts).
 */

const SOURCE_BADGE: Record<CustomerSource, { label: string; icon: typeof Globe; className: string }> = {
  whatsapp: {
    label: "WhatsApp",
    icon: MessageCircle,
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  website: {
    label: "Website",
    icon: Globe,
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  historical: {
    label: "Historical",
    icon: Package,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  manual: {
    label: "Manual",
    icon: Plus,
    className: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
};

const STATUS_BADGE: Record<CustomerStatus, string> = {
  ACTIVE: "bg-secondary text-muted-foreground",
  HISTORICAL: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  REVIEW: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  DO_NOT_CONTACT: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  BLOCKED: "bg-red-500/15 text-red-600 dark:text-red-400",
};

/** Old records predate the sources[] field — derive a sensible source list
 * from `channel` instead of showing nothing. */
function sourcesFor(c: Conversation): CustomerSource[] {
  if (c.sources && c.sources.length > 0) return c.sources;
  return [c.channel === "website" ? "website" : "whatsapp"];
}

function statusFor(c: Conversation): CustomerStatus {
  return c.status ?? "ACTIVE";
}

function matchesSourceFilter(c: Conversation, filter: ContactSourceFilter): boolean {
  if (filter === "all") return true;
  const sources = sourcesFor(c);
  if (filter === "imported") {
    return sources.includes("historical") && !sources.includes("whatsapp") && !sources.includes("website");
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
  onImportCustomers,
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
  onImportCustomers?: (file: File) => Promise<ImportResult>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContactSourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | "any">("any");
  const [hasEmailOnly, setHasEmailOnly] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [saveSegmentOpen, setSaveSegmentOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => a.customerName.localeCompare(b.customerName)),
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
      const phone = c.phoneNumber.replace(/\s/g, "").toLowerCase();
      return (
        c.customerName.toLowerCase().includes(q) ||
        phone.includes(q.replace(/\s/g, "")) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [filtered, query]);

  const counts = useMemo(() => {
    const c = { all: sorted.length, whatsapp: 0, website: 0, imported: 0 };
    for (const conv of sorted) {
      if (matchesSourceFilter(conv, "whatsapp")) c.whatsapp += 1;
      if (matchesSourceFilter(conv, "website")) c.website += 1;
      if (matchesSourceFilter(conv, "imported")) c.imported += 1;
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

  const profileContact = profileId ? conversations.find((c) => c.id === profileId) ?? null : null;

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

  const exportRows = selectedIds.size > 0 ? selectedConversations : visible;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Contacts</h2>
          <div className="flex items-center gap-2">
            <p className="mr-1 text-[11px] text-muted-foreground">{sorted.length} customers</p>
            {onImportCustomers && (
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                title="For a bulk sheet update — for one contact, use Add Contact instead"
                className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary"
              >
                <Upload className="h-3.5 w-3.5" />
                Import Excel
              </button>
            )}
            {onAddContact && (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Contact
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(
            [
              ["total", "Total", stats.total],
              ["ACTIVE", "Active", stats.byStatus.ACTIVE],
              ["HISTORICAL", "Historical", stats.byStatus.HISTORICAL],
              ["REVIEW", "Needs Review", stats.byStatus.REVIEW],
              ["excluded", "Do Not Contact / Blocked", stats.byStatus.DO_NOT_CONTACT + stats.byStatus.BLOCKED],
              ["withEmail", "With Email", stats.withEmail],
            ] as [string, string, number][]
          ).map(([key, label, value]) => (
            <div
              key={key}
              className="rounded-md border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px]"
            >
              <span className="font-semibold text-foreground">{value}</span>{" "}
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", `All`],
              ["whatsapp", `WhatsApp`],
              ["website", `Website`],
              ["imported", `Imported`],
            ] as [ContactSourceFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                filter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
              )}
            >
              {label} <span className="opacity-70">{counts[key]}</span>
            </button>
          ))}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CustomerStatus | "any")}
            aria-label="Filter by status"
            className="h-7 rounded-full border border-input bg-secondary/60 px-2 text-[11px] text-foreground outline-none focus:border-ring"
          >
            <option value="any">Any status</option>
            {CUSTOMER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CUSTOMER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={hasEmailOnly}
              onChange={(e) => setHasEmailOnly(e.target.checked)}
              className="h-3 w-3"
            />
            Has email only
          </label>
        </div>

        {(segments.length > 0 || onSaveSegment) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Segments:</span>
            {segments.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-full bg-secondary/60 pl-2.5 pr-1 py-1 text-[11px] text-muted-foreground"
              >
                <button
                  type="button"
                  onClick={() => {
                    setFilter(s.filter.sourceFilter);
                    setStatusFilter(s.filter.statusFilter);
                    setHasEmailOnly(s.filter.hasEmailOnly);
                  }}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Bookmark className="h-3 w-3" />
                  {s.name}
                </button>
                {onDeleteSegment && (
                  <button
                    type="button"
                    onClick={() => onDeleteSegment(s.id)}
                    aria-label={`Delete segment ${s.name}`}
                    className="rounded p-0.5 hover:bg-secondary"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            ))}
            {onSaveSegment && (
              <button
                type="button"
                onClick={() => setSaveSegmentOpen(true)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-input px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary/60"
              >
                <BookmarkPlus className="h-3 w-3" />
                Save current filter
              </button>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, email, or notes"
              aria-label="Search contacts"
              className="h-9 w-full rounded-md border border-input bg-secondary/60 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:bg-panel"
            />
          </div>

          <button
            type="button"
            onClick={() => downloadCsv(exportRows)}
            className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV {selectedIds.size > 0 ? `(${selectedIds.size} selected)` : `(${visible.length} shown)`}
          </button>

          {onSendEmailCampaign && (
            <button
              type="button"
              onClick={() => setEmailModalOpen(true)}
              disabled={selectedIds.size === 0}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              <Mail className="h-3.5 w-3.5" />
              Email Selected {selectedIds.size > 0 && `(${selectedIds.size})`}
            </button>
          )}

          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear selection
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No contacts match this search.
          </p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-panel text-left text-[11px] text-muted-foreground shadow-[0_1px_0_0_theme(colors.border)]">
              <tr>
                <th className="px-2 py-2">
                  <button
                    type="button"
                    onClick={toggleSelectAllVisible}
                    aria-label={visibleAllSelected ? "Deselect all visible" : "Select all visible"}
                    className="flex items-center text-muted-foreground hover:text-foreground"
                  >
                    {visibleAllSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                  </button>
                </th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Mode</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Notes</th>
                <th className="px-4 py-2 font-medium" />
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

      {emailModalOpen && onSendEmailCampaign && (
        <EmailCampaignModal
          recipients={selectedConversations}
          onClose={() => setEmailModalOpen(false)}
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

      {importOpen && onImportCustomers && (
        <ImportCustomersModal onClose={() => setImportOpen(false)} onImport={onImportCustomers} />
      )}
    </div>
  );
}

function SourceBadges({ sources }: { sources: CustomerSource[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {sources.map((s) => {
        const badge = SOURCE_BADGE[s];
        const Icon = badge.icon;
        return (
          <span
            key={s}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
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
    if (trimmed !== (conversation.email ?? "")) onUpdateContact(conversation.id, { email: trimmed });
  };

  const commitNotes = () => {
    const trimmed = notes.trim();
    if (trimmed !== (conversation.notes ?? "")) onUpdateContact(conversation.id, { notes: trimmed });
  };

  return (
    <tr className={cn("border-b border-border/60 hover:bg-secondary/40", selected && "bg-secondary/30")}>
      <td className="px-2 py-2">
        <button
          type="button"
          onClick={onToggleSelected}
          aria-label={selected ? `Deselect ${conversation.customerName}` : `Select ${conversation.customerName}`}
          className="flex items-center text-muted-foreground hover:text-foreground"
        >
          {selected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
      </td>
      <td className="px-4 py-2">
        <button
          type="button"
          onClick={() => onSelect(conversation.id)}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {conversation.customerName}
        </button>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{conversation.phoneNumber}</td>
      <td className="px-4 py-2">
        <SourceBadges sources={sourcesFor(conversation)} />
      </td>
      <td className="px-4 py-2">
        <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px]", STATUS_BADGE[status])}>
          {CUSTOMER_STATUS_LABELS[status]}
        </span>
      </td>
      <td className="px-4 py-2 text-muted-foreground">{MODE_LABELS[conversation.mode]}</td>
      <td className="px-4 py-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={commitEmail}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="Add email"
          className="h-7 w-40 rounded border border-transparent bg-transparent px-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground hover:border-input focus:border-ring focus:bg-secondary/60"
        />
      </td>
      <td className="px-4 py-2">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="Add note"
          className="h-7 w-56 rounded border border-transparent bg-transparent px-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground hover:border-input focus:border-ring focus:bg-secondary/60"
        />
      </td>
      <td className="px-2 py-2">
        <button
          type="button"
          onClick={onViewProfile}
          aria-label={`View profile for ${conversation.customerName}`}
          title="View profile"
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Customer Profile</h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-secondary" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-xs">
          <div>
            <p className="text-[15px] font-semibold text-foreground">{conversation.customerName}</p>
            <p className="mt-0.5 text-muted-foreground">{conversation.phoneNumber}</p>
            {conversation.email && <p className="text-muted-foreground">{conversation.email}</p>}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
            <SourceBadges sources={sources} />
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</p>
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
              <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px]", STATUS_BADGE[status])}>
                {CUSTOMER_STATUS_LABELS[status]}
              </span>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
                      <p className="mt-1 text-[10px] text-muted-foreground">Batch #{s.batchNumber}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {conversation.notes && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Add Contact</h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-secondary" aria-label="Close">
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

          {error && <p className="text-[11px] text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add Contact"}
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
      resolve({ filename: file.name, contentType: file.type || "application/octet-stream", contentBase64: base64 });
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
      setAttachmentError(`"${file.name}" is too large (max 6MB) — try a smaller image or a compressed PDF.`);
      return;
    }
    try {
      setAttachment(await readFileAsAttachment(file));
    } catch {
      setAttachmentError("Could not read that file — try a different one.");
    }
  };

  const excludedCount = recipients.filter((c) => statusFor(c) === "DO_NOT_CONTACT" || statusFor(c) === "BLOCKED").length;
  const noEmailCount = recipients.filter((c) => !c.email).length;
  const willSendCount = recipients.length - excludedCount - noEmailCount;

  const canSend = subject.trim().length > 0 && body.trim().length > 0 && !sending && willSendCount > 0;

  const handleSend = async () => {
    if (!canSend) return;
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
      setError(err instanceof Error ? err.message : "Failed to send campaign");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            {result ? "Campaign Sent" : "Email Selected Customers"}
          </h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-secondary" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          <div className="space-y-2 px-4 py-4 text-xs">
            <p>
              <span className="font-semibold text-foreground">{result.sent}</span> sent
            </p>
            <p className="text-muted-foreground">{result.skippedNoEmail} skipped — no email on file</p>
            <p className="text-muted-foreground">{result.skippedExcludedStatus} skipped — Do Not Contact / Blocked</p>
            {result.failed > 0 && <p className="text-red-500">{result.failed} failed to send</p>}
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3 overflow-y-auto px-4 py-4 text-xs">
              <p className="rounded-md bg-secondary/40 px-2.5 py-2 text-muted-foreground">
                Sending to <span className="font-semibold text-foreground">{willSendCount}</span> of{" "}
                {recipients.length} selected
                {noEmailCount > 0 && ` — ${noEmailCount} have no email on file`}
                {excludedCount > 0 && ` — ${excludedCount} excluded (Do Not Contact / Blocked)`}
              </p>
              <Field label="Subject">
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-secondary/60 px-2 text-xs outline-none focus:border-ring"
                  autoFocus
                />
              </Field>
              <Field label="Message">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  placeholder="Hi {name} gets prepended automatically — just write the message itself."
                  className="w-full resize-none rounded-md border border-input bg-secondary/60 px-2 py-1.5 text-xs outline-none focus:border-ring"
                />
              </Field>

              <Field label="Flyer / image / PDF (optional)">
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
                    <input type="file" accept="image/*,.pdf" onChange={handleFileChange} className="hidden" />
                  </label>
                )}
                {attachmentError && <p className="mt-1 text-[11px] text-red-500">{attachmentError}</p>}
              </Field>

              {error && <p className="text-[11px] text-red-500">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {sending ? "Sending…" : `Send to ${willSendCount}`}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Save Current Filter as Segment</h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-secondary" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 text-xs">
          <Field label="Segment name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Historical with email"
              className="h-8 w-full rounded-md border border-input bg-secondary/60 px-2 text-xs outline-none focus:border-ring"
              autoFocus
            />
          </Field>
          {error && <p className="text-[11px] text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Segment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportCustomersModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (file: File) => Promise<ImportResult>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setFile(e.target.files?.[0] ?? null);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const res = await onImport(file);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            {result ? "Import Complete" : "Import Excel / CSV"}
          </h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-secondary" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          <div className="space-y-2 overflow-y-auto px-4 py-4 text-xs">
            <p>
              <span className="font-semibold text-foreground">{result.summary.processed}</span> rows processed
            </p>
            <p className="text-muted-foreground">{result.summary.matchedExisting} existing customers matched</p>
            <p className="text-muted-foreground">{result.summary.createdNew} new customers created</p>
            <p className="text-muted-foreground">{result.summary.shipmentsLinked} shipment records linked</p>
            <p className="text-muted-foreground">{result.summary.skippedSection} skipped (pre-flagged junk in sheet)</p>
            {result.summary.needsReview > 0 && (
              <p className="text-yellow-600 dark:text-yellow-400">{result.summary.needsReview} rows need review</p>
            )}
            {result.reviewRows.length > 0 && (
              <div className="mt-2 rounded-md border border-border/60 px-2.5 py-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Needs review
                </p>
                <ul className="space-y-1">
                  {result.reviewRows.map((r, i) => (
                    <li key={i} className="text-muted-foreground">
                      {r.senderName}: "{r.rawPhone}" — {r.reason}
                    </li>
                  ))}
                </ul>
                {result.reviewRowsTruncated && (
                  <p className="mt-1 text-muted-foreground">…and more not shown here.</p>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3 px-4 py-4 text-xs">
              <p className="text-muted-foreground">
                For a bulk sheet update from management — matches existing customers by phone number, only creates
                new ones where there's no match. Safe to re-run the same or an updated sheet; nothing gets
                duplicated.
              </p>
              <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-input text-muted-foreground hover:bg-secondary/40">
                <Upload className="h-4 w-4" />
                {file ? file.name : "Choose a .xlsx, .xls, or .csv file"}
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} className="hidden" />
              </label>
              {error && <p className="text-[11px] text-red-500">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={!file || importing}
                className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
