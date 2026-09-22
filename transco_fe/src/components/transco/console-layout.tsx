import { CalendarClock, ChevronDown, Globe, LogOut, MessageCircle, MessageSquareDot, Moon, PauseCircle, PlayCircle, Sun, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

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

export type ConsoleTab = "conversations" | "bookings" | "contacts";

export function ConsoleLayout({
  agentName,
  onLogout,
  activeTab,
  onTabChange,
  websitePaused,
  whatsappPaused,
  onUpdatePauseState,
  children,
}: {
  agentName: string;
  onLogout: () => void;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
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
        : "Pause the website bot? Every website chat will get an automatic \"we're briefly offline\" reply until you resume it here. WhatsApp is unaffected.",
      { websitePaused: !websitePaused },
    );

  const toggleWhatsapp = () =>
    confirmAndApply(
      whatsappPaused
        ? "Resume the WhatsApp bot? It will start replying automatically again."
        : "Pause the WhatsApp bot? Every WhatsApp conversation will get an automatic \"we're briefly offline\" reply until you resume it here. The website is unaffected.",
      { whatsappPaused: !whatsappPaused },
    );

  const stopAll = () =>
    confirmAndApply(
      "Pause BOTH bots — website and WhatsApp? Every conversation on either channel will get an automatic \"we're briefly offline\" reply until you resume them.",
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
      <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-panel px-3 py-2 md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <MessageSquareDot className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-sm font-semibold tracking-tight text-foreground">
                Transco
              </span>
              <span className="hidden max-w-28 truncate text-xs capitalize text-muted-foreground sm:inline">
                {agentName}
              </span>
            </span>
          </span>

          <nav className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onTabChange("conversations")}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                activeTab === "conversations"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              Conversations
            </button>
            <button
              type="button"
              onClick={() => onTabChange("bookings")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                activeTab === "bookings"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Bookings
            </button>
            <button
              type="button"
              onClick={() => onTabChange("contacts")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                activeTab === "contacts"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              <Users className="h-3.5 w-3.5" />
              Contacts
            </button>
          </nav>
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
                    ? "border-amber-600/40 bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
                    : "border-border text-foreground hover:bg-secondary",
                )}
              >
                {anyPaused ? (
                  <PauseCircle className="h-3.5 w-3.5" />
                ) : (
                  <PlayCircle className="h-3.5 w-3.5" />
                )}
                {allPaused ? "Both Paused" : websitePaused ? "Website Paused" : whatsappPaused ? "WhatsApp Paused" : "Bot Controls"}
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
              <DropdownMenuItem onClick={stopAll} disabled={allPaused} className="gap-2 text-amber-700 dark:text-amber-400">
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
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-foreground transition-colors hover:bg-secondary"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}