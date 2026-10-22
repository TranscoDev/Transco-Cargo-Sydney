import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  BellOff,
  Bell,
  ChevronDown,
  Heart,
  HeartOff,
  MailOpen,
  Mail,
  Pin,
  PinOff,
  Trash2,
  UserCog,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { ConversationSummary, InboxFlags } from "@/lib/transco/types";

/** WhatsApp-style ⌄ menu on a chat row. Opens from the arrow, or from a
 * right-click on the row (open/onOpenChange are controlled by the row). */
export function ChatMenu({
  conversation,
  open,
  onOpenChange,
  onChange,
  onMarkRead,
  canDelete,
}: {
  conversation: ConversationSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (flags: InboxFlags) => void;
  onMarkRead: () => void;
  canDelete: boolean;
}) {
  const inbox = conversation.inbox ?? {};
  const unread = conversation.unreadCount > 0 || !!inbox.markedUnread;

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Chat options"
          className={cn(
            "grid h-6 w-6 place-items-center rounded-full bg-panel/90 text-muted-foreground shadow-sm hover:text-foreground",
            "opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100",
            open && "opacity-100",
          )}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[200px] rounded-lg border border-border bg-panel p-1 text-sm shadow-lg"
        >
          {!inbox.archived && (
            <Item icon={inbox.pinned ? PinOff : Pin} onSelect={() => onChange({ pinned: !inbox.pinned })}>
              {inbox.pinned ? "Unpin chat" : "Pin chat"}
            </Item>
          )}
          <Item icon={unread ? MailOpen : Mail} onSelect={() => (unread ? onMarkRead() : onChange({ markedUnread: true }))}>
            {unread ? "Mark as read" : "Mark as unread"}
          </Item>
          <Item icon={inbox.favourite ? HeartOff : Heart} onSelect={() => onChange({ favourite: !inbox.favourite })}>
            {inbox.favourite ? "Remove from favourites" : "Add to favourites"}
          </Item>
          <Item icon={inbox.muted ? Bell : BellOff} onSelect={() => onChange({ muted: !inbox.muted })}>
            {inbox.muted ? "Unmute" : "Mute"}
          </Item>
          <Item icon={inbox.archived ? ArchiveRestore : Archive} onSelect={() => onChange({ archived: !inbox.archived })}>
            {inbox.archived ? "Unarchive chat" : "Archive chat"}
          </Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <Item icon={UserCog} onSelect={() => onChange({ isStaff: !inbox.isStaff })}>
            {inbox.isStaff ? "Not a staff member" : "Mark as staff (Internal)"}
          </Item>
          {canDelete && (
            <Item
              icon={Trash2}
              danger
              onSelect={() => {
                if (window.confirm(`Delete the chat with ${conversation.customerName}? It's removed from the list; the messages are kept, and it comes back if they write again.`)) {
                  onChange({ deleted: true });
                }
              }}
            >
              Delete chat
            </Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Item({
  icon: Icon,
  danger,
  onSelect,
  children,
}: {
  icon: typeof Pin;
  danger?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-secondary",
        danger ? "text-destructive" : "text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      {children}
    </DropdownMenu.Item>
  );
}
