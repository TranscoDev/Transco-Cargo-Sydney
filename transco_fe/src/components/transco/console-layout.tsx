import {
  Bot,
  CalendarClock,
  ChevronDown,
  Globe,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MessageSquareDot,
  Moon,
  PackageSearch,
  PauseCircle,
  PlayCircle,
  Settings as SettingsIcon,
  Sun,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/transco/theme";
import type { PauseState } from "@/lib/transco/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Single source of truth for the sidebar — every future module
 * (Phase 2+) gets added here, never as a new hand-written nav button.
 * Sections whose module hasn't shipped yet still appear (their routes
 * render a ComingSoonPanel) so the full target navigation is visible
 * and clickable from day one instead of dead-ending. */
export interface NavLeaf {
  label: string;
  to: string;
}
export interface NavSection {
  label: string;
  icon: typeof Users;
  /** A section with exactly one leaf (Dashboard, Settings) renders as a
   * single direct link instead of an expandable group. */
  items: NavLeaf[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    items: [{ label: "Dashboard", to: "/console/dashboard" }],
  },
  {
    label: "CRM",
    icon: Users,
    items: [
      { label: "Customers", to: "/console/customers" },
      { label: "My Transco", to: "/console/my-transco" },
      { label: "Leads", to: "/console/leads" },
      { label: "Conversations", to: "/console/conversations" },
    ],
  },
  {
    label: "Operations",
    icon: CalendarClock,
    items: [
      { label: "Bookings", to: "/console/bookings" },
      { label: "Shipments", to: "/console/shipments" },
      { label: "Tracking", to: "/console/tracking" },
      { label: "Warehouse", to: "/console/warehouse" },
    ],
  },
  {
    // "Packaging Stock" (Transco-owned box supplies) is deliberately not
    // called "Inventory" — that word is ambiguous with Warehouse Cargo
    // (customer goods in our custody), a completely separate concept.
    // Two real leaves (not the old Stock Movements/Suppliers/Purchase
    // Orders placeholders) — a 2+ item section renders as an expandable
    // group like its siblings (Finance, CRM, ...) instead of one bold
    // top-level link, matching what's actually built.
    label: "Packaging Stock",
    icon: PackageSearch,
    items: [
      { label: "Current Stock", to: "/console/inventory/stock" },
      { label: "Packaging Activity", to: "/console/inventory/activity" },
    ],
  },
  {
    label: "Finance",
    icon: Wallet,
    items: [
      { label: "Invoices", to: "/console/finance/invoices" },
      { label: "Payments", to: "/console/finance/payments" },
      { label: "Expenses", to: "/console/finance/expenses" },
      { label: "Reports", to: "/console/finance/reports" },
    ],
  },
  {
    label: "AI",
    icon: Bot,
    items: [
      { label: "Agent Transco", to: "/console/ai/agent" },
      { label: "Bot Controls", to: "/console/ai/bot-controls" },
    ],
  },
  {
    label: "Settings",
    icon: SettingsIcon,
    items: [{ label: "Settings", to: "/console/settings" }],
  },
];

function sectionContainsPath(section: NavSection, pathname: string) {
  return section.items.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
}

function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Groups start expanded only if they contain the active route; every
  // other multi-item group starts collapsed so the sidebar reads as
  // group headers with dropdowns rather than one long flat list.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const section of NAV_SECTIONS) {
      if (section.items.length > 1) initial[section.label] = sectionContainsPath(section, pathname);
    }
    return initial;
  });

  const toggleSection = (label: string) =>
    setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }));

  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-nav-border bg-nav px-2 py-3 md:flex">
      {NAV_SECTIONS.map((section) => {
        const Icon = section.icon;
        const [only] = section.items;
        if (section.items.length === 1 && only) {
          const active = pathname === only.to;
          return (
            <Link
              key={section.label}
              to={only.to}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-nav-active text-nav-active-foreground"
                  : "text-nav-foreground hover:bg-nav-hover",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {section.label}
            </Link>
          );
        }

        const isOpen = !!openSections[section.label];
        const groupActive = sectionContainsPath(section, pathname);

        return (
          <div key={section.label} className="mb-1">
            <button
              type="button"
              onClick={() => toggleSection(section.label)}
              aria-expanded={isOpen}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                groupActive
                  ? "bg-nav-hover text-nav-active-foreground"
                  : "text-nav-muted hover:bg-nav-hover hover:text-nav-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 text-left">{section.label}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform",
                  isOpen ? "rotate-180" : "",
                )}
              />
            </button>
            {isOpen && (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={cn(
                        "rounded-md px-4 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-nav-active font-medium text-nav-active-foreground"
                          : "text-nav-muted hover:bg-nav-hover hover:text-nav-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </aside>
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
        <div className="shrink-0 border-b border-amber-600/30 bg-amber-500/15 px-3 py-1.5 text-center text-xs font-medium text-amber-700 dark:text-amber-400 md:px-4">
          {bannerText}
        </div>
      )}
      <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-header px-3 py-2 text-header-foreground md:px-4">
        <div className="flex min-w-0 items-center gap-3">
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
        <div className="flex shrink-0 items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Bot controls"
                title="Bot controls"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  anyPaused
                    ? "border-amber-400/40 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                    : "border-white/20 text-header-foreground hover:bg-white/10",
                )}
              >
                {anyPaused ? (
                  <PauseCircle className="h-3.5 w-3.5" />
                ) : (
                  <PlayCircle className="h-3.5 w-3.5" />
                )}
                {allPaused
                  ? "Both Paused"
                  : websitePaused
                    ? "Website Paused"
                    : whatsappPaused
                      ? "WhatsApp Paused"
                      : "Bot Controls"}
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
                className="gap-2 text-amber-700 dark:text-amber-400"
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
            className="inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1.5 text-xs font-medium text-header-foreground transition-colors hover:bg-white/10"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
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
    </div>
  );
}
