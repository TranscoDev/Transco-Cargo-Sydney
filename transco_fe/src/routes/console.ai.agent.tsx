import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpenText, History, Lock, Phone, RotateCcw } from "lucide-react";

import { PageHeader, PageShell } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchAgentKnowledge,
  fetchAgentKnowledgeHistory,
  restoreAgentKnowledge,
  saveAgentKnowledge,
  type AgentKnowledge,
  type AgentKnowledgeVersion,
} from "@/lib/transco/api";

// What the chat bot knows (agentKnowledge.js): contact details swapped into
// every ready-made reply, and information sections it answers other
// questions from. Prices and shipping dates are not edited here.
export const Route = createFileRoute("/console/ai/agent")({
  component: AgentKnowledgePage,
});

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }) : "";

function AgentKnowledgePage() {
  const [data, setData] = useState<AgentKnowledge | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [sections, setSections] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const apply = (k: AgentKnowledge) => {
    setData(k);
    setDetails(Object.fromEntries(k.details.map((d) => [d.key, d.value])));
    setSections(Object.fromEntries(k.sections.map((s) => [s.key, s.text])));
  };

  useEffect(() => {
    fetchAgentKnowledge()
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the agent knowledge"));
  }, []);

  const changed = useMemo(() => {
    if (!data) return false;
    return (
      data.details.some((d) => (details[d.key] ?? "").trim() !== d.value) ||
      data.sections.some((s) => (sections[s.key] ?? "").trim() !== s.text.trim())
    );
  }, [data, details, sections]);

  const groups = useMemo(() => {
    const map = new Map<string, AgentKnowledge["details"]>();
    for (const d of data?.details ?? []) map.set(d.group, [...(map.get(d.group) ?? []), d]);
    return [...map.entries()];
  }, [data]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      apply(await saveAgentKnowledge({ details, sections }));
      setSuccess("Saved. The bot uses this from the next message.");
      setHistoryKey((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const restore = async (v: AgentKnowledgeVersion) => {
    if (!window.confirm(`Put back the version saved ${when(v.updatedAt)}${v.updatedBy ? ` by ${v.updatedBy}` : ""}? The current one is kept in the history.`)) return;
    setError(null);
    try {
      apply(await restoreAgentKnowledge(v.id));
      setSuccess("Older version put back. The bot uses it from the next message.");
      setHistoryKey((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore");
    }
  };

  return (
    <PageShell>
      <PageHeader
        icon={BookOpenText}
        title="Agent Transco"
        description="What the chat bot knows. Change it here and the bot uses it from the next message — WhatsApp and the website."
      />

      <div className="mb-6 rounded-xl border bg-secondary/40 p-4 text-sm text-muted-foreground">
        <p className="mb-1.5 font-medium text-foreground">💡 How the bot uses this</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Contact details</b> go into every bot reply (English, Sinhala and Tamil).</li>
          <li><b>Information</b> is used to answer questions the bot has no ready answer for. If the answer isn't here, the chat goes to staff.</li>
          <li>
            Single <b>questions &amp; answers</b> (e.g. "I only have an Australian passport") go on{" "}
            <Link to="/console/ai/faqs" className="underline underline-offset-2">Bot Q&amp;A</Link>.
          </li>
          <li><b>Prices</b> are worked out by the bot's price calculator, and <b>shipping dates</b> come from the Shipping calendar — not edited here.</li>
        </ul>
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="h-4 w-4" /> Contact details
              </CardTitle>
              <p className="text-sm text-muted-foreground">Used in every bot reply.</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 p-5 pt-2">
              {groups.map(([group, items]) => (
                <div key={group} className="flex flex-col gap-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                  {items.map((d) => {
                    const locked = !!d.adminOnly && !data.isAdmin;
                    return (
                      <label key={d.key} className="flex flex-col gap-1 text-sm">
                        <span className="flex items-center gap-1.5 text-foreground">
                          {d.label}
                          {d.adminOnly && <Lock className="h-3 w-3 text-muted-foreground" />}
                        </span>
                        <Input
                          value={details[d.key] ?? ""}
                          disabled={locked}
                          maxLength={200}
                          placeholder={d.default}
                          onChange={(e) => {
                            setDetails((s) => ({ ...s, [d.key]: e.target.value }));
                            setSuccess(null);
                          }}
                        />
                        {(details[d.key] ?? "").trim() !== d.default && (details[d.key] ?? "").trim() && (
                          <span className="text-xs text-muted-foreground">Changed from: {d.default}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            {data.sections.map((s) => (
              <Card key={s.key}>
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-5 pb-3">
                  <CardTitle className="text-base">{s.title}</CardTitle>
                  {s.default && (sections[s.key] ?? "").trim() !== s.default && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => {
                        if (window.confirm(`Put "${s.title}" back to the standard text?`)) setSections((x) => ({ ...x, [s.key]: s.default }));
                      }}
                    >
                      <RotateCcw className="h-3 w-3" /> Standard text
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="p-5 pt-2">
                  <Textarea
                    value={sections[s.key] ?? ""}
                    rows={Math.min(14, Math.max(4, (sections[s.key] ?? "").split("\n").length + 1))}
                    maxLength={4000}
                    className="text-sm"
                    placeholder={s.key === "faq" ? "Q: Do you ship medicine?\nA: No, we can't ship medicine." : ""}
                    onChange={(e) => {
                      setSections((x) => ({ ...x, [s.key]: e.target.value }));
                      setSuccess(null);
                    }}
                  />
                </CardContent>
              </Card>
            ))}
            <HistoryCard key={historyKey} onRestore={restore} />
          </div>
        </div>
      )}

      {data && (
        <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur">
          <Button type="button" disabled={saving || !changed} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {changed && (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => apply(data)}>
              Cancel
            </Button>
          )}
          {error && <span className="text-sm text-destructive">{error}</span>}
          {success && <span className="text-sm text-success-foreground">{success}</span>}
          {!error && !success && data.updatedAt && (
            <span className="text-xs text-muted-foreground">
              Last saved {when(data.updatedAt)}
              {data.updatedBy ? ` by ${data.updatedBy}` : ""}
            </span>
          )}
        </div>
      )}
    </PageShell>
  );
}

function HistoryCard({ onRestore }: { onRestore: (v: AgentKnowledgeVersion) => void }) {
  const [versions, setVersions] = useState<AgentKnowledgeVersion[] | null>(null);

  useEffect(() => {
    fetchAgentKnowledgeHistory()
      .then(setVersions)
      .catch(() => setVersions([]));
  }, []);

  return (
    <Card>
      <CardHeader className="p-5 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Earlier versions
        </CardTitle>
        <p className="text-sm text-muted-foreground">Made a mistake? Put an earlier version back.</p>
      </CardHeader>
      <CardContent className="p-5 pt-2">
        {!versions ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No earlier versions yet.</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {v.updatedAt ? when(v.updatedAt) : "Standard text"}
                  {v.updatedBy && <span className="text-muted-foreground"> · {v.updatedBy}</span>}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => onRestore(v)}>
                  Put back
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
