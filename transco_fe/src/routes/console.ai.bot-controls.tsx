import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bot, Globe, MessageCircle, MessageSquareText, PauseCircle, PlayCircle, RotateCcw } from "lucide-react";

import { PageHeader, PageShell } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { fetchPauseMessage, savePauseMessage } from "@/lib/transco/api";
import { useConversations } from "@/lib/transco/store";
import { cn } from "@/lib/utils";

// Same on/off flags as the Bot controls button in the header — both
// stay in sync live, so staff can use whichever they find first.
export const Route = createFileRoute("/console/ai/bot-controls")({
  component: BotSettingsPage,
});

function BotSettingsPage() {
  const { websitePaused, whatsappPaused, updatePauseState } = useConversations();
  const anyPaused = websitePaused || whatsappPaused;
  const allPaused = websitePaused && whatsappPaused;

  const confirmAndApply = (message: string, partial: { websitePaused?: boolean; whatsappPaused?: boolean }) => {
    if (window.confirm(message)) updatePauseState(partial);
  };

  return (
    <PageShell>
      <PageHeader icon={Bot} title="Bot settings" description="Turn the chat bots on or off, and choose what customers see while they're paused." />

      {/* Friendly status strip — green when everything is replying. */}
      <div
        className={cn(
          "mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4",
          anyPaused ? "bg-linear-to-r from-warning/15 via-card to-card" : "bg-linear-to-r from-primary/10 via-card to-card",
        )}
      >
        <div className="flex items-center gap-4">
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg",
              anyPaused ? "bg-warning/25 text-warning-foreground" : "bg-primary text-primary-foreground",
            )}
          >
            {anyPaused ? <PauseCircle className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-foreground">
              {allPaused
                ? "Both bots are paused ⏸️"
                : websitePaused
                  ? "Website bot is paused ⏸️"
                  : whatsappPaused
                    ? "WhatsApp bot is paused ⏸️"
                    : "All bots are replying 👍"}
            </p>
            <p className="text-sm text-muted-foreground">
              {anyPaused
                ? "Customers get the paused message below. Chats you've taken over still work as normal."
                : "Customers get automatic replies on the website and WhatsApp."}
            </p>
          </div>
        </div>
        {anyPaused ? (
          <Button
            type="button"
            className="gap-1.5"
            onClick={() =>
              confirmAndApply("Resume BOTH bots — website and WhatsApp? They'll start replying automatically again.", {
                websitePaused: false,
                whatsappPaused: false,
              })
            }
          >
            <PlayCircle className="h-4 w-4" />
            Resume all
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              confirmAndApply(
                "Pause BOTH bots — website and WhatsApp? Every customer will get the paused message until you resume them.",
                { websitePaused: true, whatsappPaused: true },
              )
            }
          >
            <PauseCircle className="h-4 w-4" />
            Pause all
          </Button>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <ChannelCard
            icon={MessageCircle}
            tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
            title="WhatsApp bot"
            description="Automatic replies to customers who message the WhatsApp number."
            paused={whatsappPaused}
            onToggle={() =>
              confirmAndApply(
                whatsappPaused
                  ? "Resume the WhatsApp bot? It will start replying automatically again."
                  : "Pause the WhatsApp bot? WhatsApp customers will get the paused message until you resume it. The website is unaffected.",
                { whatsappPaused: !whatsappPaused },
              )
            }
          />
          <ChannelCard
            icon={Globe}
            tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
            title="Website bot"
            description="The chat box on transcosydney.com.au."
            paused={websitePaused}
            onToggle={() =>
              confirmAndApply(
                websitePaused
                  ? "Resume the website bot? It will start replying automatically again on transcosydney.com.au."
                  : "Pause the website bot? Website chats will get the paused message until you resume it. WhatsApp is unaffected.",
                { websitePaused: !websitePaused },
              )
            }
          />
          <div className="rounded-xl border bg-secondary/40 p-4 text-sm text-muted-foreground">
            <p className="mb-1.5 font-medium text-foreground">💡 When to pause</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Someone is spamming or playing with the bot.</li>
              <li>The bot is giving wrong answers (e.g. prices changed).</li>
              <li>You want to answer every chat yourselves for a while.</li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <PauseMessageCard />
        </div>
      </div>
    </PageShell>
  );
}

/** Same card look as the Settings page: coloured icon, title, one-line explanation. */
function SettingsCard({
  icon: Icon,
  tone,
  title,
  description,
  action,
  children,
}: {
  icon: typeof Bot;
  tone: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-5 pb-3">
        <div className="flex items-start gap-3">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone)}>
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-5 pt-2">{children}</CardContent>
    </Card>
  );
}

function ChannelCard({
  icon,
  tone,
  title,
  description,
  paused,
  onToggle,
}: {
  icon: typeof Bot;
  tone: string;
  title: string;
  description: string;
  paused: boolean;
  onToggle: () => void;
}) {
  return (
    <SettingsCard icon={icon} tone={tone} title={title} description={description}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium",
            paused ? "bg-warning-soft text-warning-foreground" : "bg-success-soft text-success-foreground",
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", paused ? "bg-warning" : "bg-success")} />
          {paused ? "Paused" : "On — replying"}
        </span>
        <Button type="button" variant={paused ? "default" : "outline"} size="sm" className="gap-1.5" onClick={onToggle}>
          {paused ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>
    </SettingsCard>
  );
}

function PauseMessageCard() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [defaultMessage, setDefaultMessage] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const apply = (data: { message: string; isDefault: boolean; defaultMessage: string }) => {
    setText(data.message);
    setSaved(data.message);
    setIsDefault(data.isDefault);
    setDefaultMessage(data.defaultMessage);
  };

  useEffect(() => {
    fetchPauseMessage()
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the paused message"))
      .finally(() => setLoading(false));
  }, []);

  const save = async (message: string, doneText: string) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      apply(await savePauseMessage(message));
      setSuccess(doneText);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the paused message");
    } finally {
      setSaving(false);
    }
  };

  const changed = text.trim() !== saved.trim();

  return (
    <SettingsCard
      icon={MessageSquareText}
      tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
      title="Paused message"
      description="What customers get while a bot is paused. Same text on WhatsApp and the website."
    >
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <span className="self-start rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
            {isDefault ? "Using the standard message (English, Sinhala, Tamil)" : "Using your own message"}
          </span>
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSuccess(null);
            }}
            rows={9}
            maxLength={1000}
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Tip: keep the phone number in it so customers can still reach you. {text.length}/1000
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && <p className="text-xs text-success-foreground">{success}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={saving || !changed || !text.trim()} onClick={() => save(text, "Saved. Customers will get this message while a bot is paused.")}>
              {saving ? "Saving…" : "Save message"}
            </Button>
            {!isDefault && (
              <Button
                type="button"
                variant="outline"
                className="gap-1.5"
                disabled={saving}
                onClick={() => {
                  if (window.confirm("Go back to the standard 3-language message?")) save("", "Back to the standard message.");
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Use standard message
              </Button>
            )}
            {changed && (
              <Button type="button" variant="ghost" disabled={saving} onClick={() => setText(saved)}>
                Cancel
              </Button>
            )}
          </div>
          {!isDefault && defaultMessage && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">See the standard message</summary>
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-secondary/50 p-3">{defaultMessage}</p>
            </details>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
