import { useMemo, useState } from "react";
import { Globe, MessageCircle, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { MODE_LABELS, type Conversation } from "@/lib/transco/types";

/**
 * Address-book view of every customer — separate from ContactList (the
 * conversation inbox sidebar). This is a flat, searchable directory for
 * staff to look someone up by phone/email/name and add contact notes,
 * independent of chat history.
 */
export function ContactsDirectory({
  conversations,
  onSelect,
  onUpdateContact,
}: {
  conversations: Conversation[];
  onSelect: (id: string) => void;
  onUpdateContact: (id: string, info: { email?: string; notes?: string }) => void;
}) {
  const [query, setQuery] = useState("");

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => a.customerName.localeCompare(b.customerName)),
    [conversations],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => {
      const phone = c.phoneNumber.replace(/\s/g, "").toLowerCase();
      return (
        c.customerName.toLowerCase().includes(q) ||
        phone.includes(q.replace(/\s/g, "")) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [sorted, query]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Contacts</h2>
          <p className="text-[11px] text-muted-foreground">{conversations.length} customers</p>
        </div>
        <div className="relative mt-3 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, email, or notes"
            aria-label="Search contacts"
            className="h-9 w-full rounded-md border border-input bg-secondary/60 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:bg-panel"
          />
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
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-4 py-2 font-medium">Mode</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <ContactRow key={c.id} conversation={c} onSelect={onSelect} onUpdateContact={onUpdateContact} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ContactRow({
  conversation,
  onSelect,
  onUpdateContact,
}: {
  conversation: Conversation;
  onSelect: (id: string) => void;
  onUpdateContact: (id: string, info: { email?: string; notes?: string }) => void;
}) {
  const [email, setEmail] = useState(conversation.email ?? "");
  const [notes, setNotes] = useState(conversation.notes ?? "");

  const commitEmail = () => {
    const trimmed = email.trim();
    if (trimmed !== (conversation.email ?? "")) onUpdateContact(conversation.id, { email: trimmed });
  };

  const commitNotes = () => {
    const trimmed = notes.trim();
    if (trimmed !== (conversation.notes ?? "")) onUpdateContact(conversation.id, { notes: trimmed });
  };

  return (
    <tr className="border-b border-border/60 hover:bg-secondary/40">
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
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
            conversation.channel === "website"
              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {conversation.channel === "website" ? (
            <Globe className="h-3 w-3" />
          ) : (
            <MessageCircle className="h-3 w-3" />
          )}
          {conversation.channel === "website" ? "Website" : "WhatsApp"}
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
    </tr>
  );
}
