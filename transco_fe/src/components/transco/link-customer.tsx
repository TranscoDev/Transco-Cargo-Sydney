import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link2, Search, X } from "lucide-react";

import { formatPhone } from "@/lib/transco/phone";
import type { Conversation } from "@/lib/transco/types";

/** Last 9 digits — matches 0412 345 678, +61 412 345 678 and 61412345678 alike. */
const phoneKey = (s: string | null | undefined) => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-9) : null;
};

/** Existing customers a website chat can be linked to (never another website chat). */
export function linkCandidates(conversations: Conversation[]) {
  return conversations.filter((c) => c.channel !== "website");
}

/**
 * A customer whose phone or email the visitor typed in this chat. Only a
 * suggestion — anyone can type someone else's number, so staff confirm.
 */
export function suggestCustomer(chat: Conversation, candidates: Conversation[]): Conversation | null {
  if (chat.channel !== "website" || chat.linkedAccount) return null;
  const typed = chat.messages.filter((m) => m.sender === "CUSTOMER").map((m) => m.body ?? "").join(" ");
  const phones = new Set((typed.match(/\+?\d[\d\s-]{7,}\d/g) ?? []).map(phoneKey).filter(Boolean));
  const emails = new Set((typed.match(/[^\s@]+@[^\s@]+\.[^\s@]+/g) ?? []).map((e) => e.toLowerCase()));
  if (!phones.size && !emails.size) return null;
  const found = candidates.find(
    (c) => (phoneKey(c.phoneNumber) && phones.has(phoneKey(c.phoneNumber))) || (c.email && emails.has(c.email.toLowerCase())),
  );
  return found && found.id !== chat.inbox?.dismissedLink ? found : null;
}

/** Yellow bar above a website chat: "This might be Anojan (CUS-000005)". */
export function LinkSuggestion({
  customer,
  onLink,
  onDismiss,
  onSearch,
}: {
  customer: Conversation;
  onLink: () => void;
  onDismiss: () => void;
  onSearch: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground md:px-4">
      <Link2 className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        This might be <strong>{customer.customerName}</strong>
        {customer.customerCode ? ` (${customer.customerCode})` : ""} — they typed their {customer.email ? "number or email" : "number"}.
      </span>
      <button type="button" onClick={onLink} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
        Link
      </button>
      <button type="button" onClick={onDismiss} className="rounded-md px-2 py-1 text-xs font-medium hover:bg-warning/20">
        Not them
      </button>
      <button type="button" onClick={onSearch} className="rounded-md px-2 py-1 text-xs font-medium underline hover:bg-warning/20">
        Someone else…
      </button>
    </div>
  );
}

/** Search existing customers by name, number, email or CUS code, and pick one. */
export function LinkCustomerDialog({
  open,
  onOpenChange,
  visitorName,
  candidates,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visitorName: string;
  candidates: Conversation[];
  onPick: (customer: Conversation) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    return candidates
      .filter(
        (c) =>
          c.customerName.toLowerCase().includes(q) ||
          (c.customerCode ?? "").toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (digits.length >= 3 && c.phoneNumber.replace(/\D/g, "").includes(digits)),
      )
      .slice(0, 20);
  }, [candidates, query]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQuery("");
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[calc(100%-32px)] max-w-md -translate-x-1/2 flex-col rounded-xl border border-border bg-panel shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-border p-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">Link to a customer</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                Who is {visitorName}? Staff only — the visitor doesn't get access to the account.
              </Dialog.Description>
            </div>
            <Dialog.Close className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="relative p-4 pb-2">
            <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, phone, email or CUS number"
              className="h-10 w-full rounded-md border border-input bg-secondary/60 pl-9 pr-3 text-sm outline-none focus:border-ring focus:bg-panel"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {query.trim().length < 2 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Start typing to find the customer.</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No customer found. Check the spelling or try their number.</p>
            ) : (
              results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPick(c)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left hover:bg-secondary"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{c.customerName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[c.customerCode, formatPhone(c.phoneNumber), c.email].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-primary">Link</span>
                </button>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
