import {
  Archive,
  BarChart3,
  Bot,
  CalendarClock,
  ChevronDown,
  Clock3,
  Globe,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquareDot,
  Moon,
  PackageSearch,
  PauseCircle,
  PlayCircle,
  Receipt,
  Settings as SettingsIcon,
  Ship,
  Sparkles,
  Sun,
  UserRoundCheck,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/transco/theme";
import type { PauseState } from "@/lib/transco/api";
import { useConversations } from "@/lib/transco/store";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Single source of truth for the navigation (sidebar + phone menu).
 * Grouped by how staff work: the everyday Workspace first, then
 * Operations, CRM and Admin. Modules that aren't built yet live in a
 * greyed, collapsed "Coming later" group — still reachable (their pages
 * explain what's coming) but never presented as working features. */
export interface NavLeaf {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Shows the live "waiting" conversation count. */
  badge?: "conversations";
}
export interface NavGroup {
  label: string;
  items: NavLeaf[];
  /** Unfinished modules — muted and collapsed by default. */
  later?: boolean;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", to: "/console/dashboard", icon: LayoutDashboard },
      { label: "Conversations", to: "/console/conversations", icon: MessageCircle, badge: "conversations" },
      { label: "Customers", to: "/console/customers", icon: Users },
      { label: "Bookings", to: "/console/bookings", icon: CalendarClock },
      { label: "Shipments", to: "/console/shipments", icon: Ship },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Tracking", to: "/console/tracking", icon: MapPin },
      // "Packaging" = Transco-owned box supplies used on shipments — not
      // customer cargo (that would be Warehouse).
      { label: "Packaging", to: "/console/inventory/activity", icon: PackageSearch },
    ],
  },
  {
    label: "CRM",
    items: [
      { label: "Leads", to: "/console/leads", icon: Sparkles },
      // Customers who use the My Transco customer website.
      { label: "Online Accounts", to: "/console/my-transco", icon: UserRoundCheck },
    ],
  },
  {
    label: "Admin",
    items: [{ label: "Settings", to: "/console/settings", icon: SettingsIcon }],
  },
  {
    label: "Coming later",
    later: true,
    items: [
      { label: "Warehouse", to: "/console/warehouse", icon: Warehouse },
      { label: "Stock levels", to: "/console/inventory/stock", icon: Archive },
      { label: "Invoices", to: "/console/finance/invoices", icon: Receipt },
      { label: "Payments", to: "/console/finance/payments", icon: Wallet },
      { label: "Expenses", to: "/console/finance/expenses", icon: Wallet },
      { label: "Reports", to: "/console/finance/reports", icon: BarChart3 },
      { label: "Agent Transco", to: "/console/ai/agent", icon: Bot },
      { label: "Bot settings", to: "/console/ai/bot-controls", icon: Bot },
    ],
  },
];

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Conversations with an unread customer message or flagged for staff. */
function useWaitingConversations() {
  const { summaries } = useConversations();
  return summaries.filter((c) => c.unreadCount > 0 || c.needsAttention).length;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const waiting = useWaitingConversations();
  const laterGroup = NAV_GROUPS.find((g) => g.later);
  const [laterOpen, setLaterOpen] = useState(
    () => !!laterGroup?.items.some((i) => isActive(pathname, i.to)),
  );

  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-5">
      {NAV_GROUPS.map((group) => {
        if (group.later) {
          return (
            <div key={group.label} className="mt-auto border-t border-nav-border pt-4">
              <button
                type="button"
                onClick={() => setLaterOpen((o) => !o)}
                aria-expanded={laterOpen}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1 text-xs font-medium text-nav-muted/70 transition-colors hover:text-nav-muted"
              >
                <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", laterOpen && "rotate-180")} aria-hidden />
              </button>
              {laterOpen && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item.to);
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                            active ? "bg-nav-hover text-nav-foreground" : "text-nav-muted/60 hover:bg-nav-hover hover:text-nav-muted",
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                          <span className="flex-1">{item.label}</span>
                          <span className="rounded bg-white/5 px-1.5 text-[11px] text-nav-muted/70">Soon</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        }

        return (
          <div key={group.label}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-nav-muted/80">{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.to);
                const count = item.badge === "conversations" ? waiting : 0;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-nav-active font-medium text-nav-active-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"
                          : "text-nav-foreground/85 hover:bg-nav-hover hover:text-nav-foreground",
                      )}
                    >
                      <item.icon className={cn("h-4 w-4 shrink-0", active ? "opacity-100" : "opacity-70")} aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {count > 0 && (
                        <span
                          className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold leading-5 text-primary-foreground"
                          aria-label={`${count} waiting`}
                        >
                          {count}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-nav-border bg-nav px-3 py-5 md:flex">
      <NavLinks />
    </aside>
  );
}

/** Phones/small tablets: the same navigation in a slide-in panel. */
function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const waiting = useWaitingConversations();
  // Close after navigating.
  useEffect(() => setOpen(false), [pathname]);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open menu"
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/20 text-header-foreground transition-colors hover:bg-white/10 md:hidden"
        >
          <Menu className="h-4 w-4" />
          {waiting > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-header" aria-hidden />}
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-nav-border bg-nav p-0 text-nav-foreground">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="flex h-full flex-col overflow-y-auto px-3 py-5">
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ConsoleLayout({
  agentName,
  onLogout,
  websitePaused,
  whatsappPaused,
  onUpdatePauseState,
  children,
}: {
  agentName: string;
  onLogout: () => void;
  websitePaused: boolean;
  whatsappPaused: boolean;
  onUpdatePauseState: (partial: Partial<PauseState>) => void;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  const anyPaused = websitePaused || whatsappPaused;
  const allPaused = websitePaused && whatsappPaused;

  const confirmAndApply = (message: string, partial: Partial<PauseState>) => {
    if (window.confirm(message)) onUpdatePauseState(partial);
  };

  const toggleWebsite = () =>
    confirmAndApply(
      websitePaused
        ? "Resume the website bot? It will start replying automatically again on transcosydney.com.au."
        : 'Pause the website bot? Every website chat will get an automatic "we\'re briefly offline" reply until you resume it here. WhatsApp is unaffected.',
      { websitePaused: !websitePaused },
    );

  const toggleWhatsapp = () =>
    confirmAndApply(
      whatsappPaused
        ? "Resume the WhatsApp bot? It will start replying automatically again."
        : 'Pause the WhatsApp bot? Every WhatsApp conversation will get an automatic "we\'re briefly offline" reply until you resume it here. The website is unaffected.',
      { whatsappPaused: !whatsappPaused },
    );

  const stopAll = () =>
    confirmAndApply(
      'Pause BOTH bots — website and WhatsApp? Every conversation on either channel will get an automatic "we\'re briefly offline" reply until you resume them.',
      { websitePaused: true, whatsappPaused: true },
    );

  const resumeAll = () =>
    confirmAndApply(
      "Resume BOTH bots — website and WhatsApp? They'll start replying automatically again.",
      { websitePaused: false, whatsappPaused: false },
    );

  const bannerText = allPaused
    ? "⏸️ Both bots are paused — replies are on hold until you resume them."
    : websitePaused
      ? "⏸️ Website bot is paused — WhatsApp is still replying normally."
      : "⏸️ WhatsApp bot is paused — the website is still replying normally.";

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background">
      {anyPaused && (
        <div className="shrink-0 border-b border-warning/30 bg-warning-soft px-3 py-2 text-center text-sm font-medium text-warning-foreground md:px-4">
          {bannerText}
        </div>
      )}
      <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-header px-3 py-2 text-header-foreground md:px-4">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav />
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <MessageSquareDot className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-sm font-semibold tracking-tight text-header-foreground">
                Transco
              </span>
              <span className="hidden max-w-28 truncate text-xs capitalize text-header-foreground/65 sm:inline">
                {agentName}
              </span>
            </span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Bot controls"
                title="Bot controls"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  anyPaused
                    ? "border-warning/50 bg-warning/20 text-warning-soft hover:bg-warning/30"
                    : "border-white/20 text-header-foreground hover:bg-white/10",
                )}
              >
                {anyPaused ? (
                  <PauseCircle className="h-3.5 w-3.5" />
                ) : (
                  <PlayCircle className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">
                  {allPaused
                    ? "Both paused"
                    : websitePaused
                      ? "Website paused"
                      : whatsappPaused
                        ? "WhatsApp paused"
                        : "Bot controls"}
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Bot Controls</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleWebsite} className="gap-2">
                <Globe className="h-3.5 w-3.5" />
                {websitePaused ? "Resume Website Bot" : "Pause Website Bot"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleWhatsapp} className="gap-2">
                <MessageCircle className="h-3.5 w-3.5" />
                {whatsappPaused ? "Resume WhatsApp Bot" : "Pause WhatsApp Bot"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={stopAll}
                disabled={allPaused}
                className="gap-2 text-warning-foreground"
              >
                <PauseCircle className="h-3.5 w-3.5" />
                Stop All (Website + WhatsApp)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={resumeAll} disabled={!anyPaused} className="gap-2">
                <PlayCircle className="h-3.5 w-3.5" />
                Resume All (Website + WhatsApp)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/20 text-header-foreground transition-colors hover:bg-white/10"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/20 px-2.5 text-xs font-medium text-header-foreground transition-colors hover:bg-white/10"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/* min-w-0 is load-bearing here: without it, a wide child (e.g. the
            Contacts table's min-w-[1180px]) forces this flex item past the
            viewport width instead of scrolling internally — dragging the
            sidebar and header along with it. */}
        {/* flex-col + overflow: each page's own `flex-1 overflow-y-auto`
            wrapper scrolls inside here, so a long page (e.g. a batch with
            20+ HBLs) never scrolls the whole window and drags the sidebar
            away with it. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
      <Toaster position="bottom-right" theme={theme} />
    </div>
  );
}
