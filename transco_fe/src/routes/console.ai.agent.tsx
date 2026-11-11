import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BadgePercent, BookOpenText, ChevronRight, CreditCard, History, Lock, MapPin, MessageSquareText, MessagesSquare, Phone, RotateCcw, Search } from "lucide-react";

import { PageHeader, PageShell } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { canSee } from "@/lib/transco/auth";
import { BotFaqPage } from "@/routes/console.ai.faqs";
import { PricesPage } from "@/routes/console.prices";
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

// The page layout only — which boxes sit together on which card, with short
// labels (the card title gives the context). The saved data is unchanged.
type Field = { key: string; label: string; wide?: boolean; hint?: string };
type CardDef = { title: string; fields: Field[] };
type TabKey = "contacts" | "places" | "payment";

const LAYOUT: Record<TabKey, CardDef[]> = {
  contacts: [
    { title: "Office", fields: [{ key: "office_phone", label: "Phone (Transco #1)" }] },
    { title: "Pickup & appointments", fields: [{ key: "pickup_name", label: "Name" }, { key: "pickup_phone", label: "Phone (Transco #2)" }] },
    { title: "Insurance", fields: [{ key: "insurance_name", label: "Name" }, { key: "insurance_phone", label: "Phone" }] },
    {
      title: "Melbourne head office",
      fields: [
        { key: "head_office_phone", label: "Phone (also India)" },
        { key: "head_office_fax", label: "Fax" },
        { key: "head_office_name", label: "Personal effects contact" },
        { key: "head_office_email", label: "Email" },
      ],
    },
    { title: "India shipments", fields: [{ key: "india_name", label: "Name" }, { key: "india_email", label: "Email" }] },
    { title: "Tracking", fields: [{ key: "tracking_link", label: "BL tracking website", wide: true }] },
  ],
  places: [
    {
      title: "Sydney warehouse",
      fields: [
        { key: "warehouse_address", label: "Address", wide: true },
        { key: "warehouse_map", label: "Map link", wide: true },
        { key: "home_city", label: "Home city" },
      ],
    },
    {
      title: "Colombo warehouse (Wattala)",
      fields: [
        { key: "colombo_address", label: "Address", wide: true },
        { key: "colombo_phone_1", label: "Phone 1" },
        { key: "colombo_phone_2", label: "Phone 2" },
        { key: "colombo_phone_3", label: "Phone 3" },
        { key: "colombo_hotline", label: "Hotline (after arrival)" },
      ],
    },
    {
      title: "Partner shops (boxes)",
      fields: [
        { key: "partner_shop_1", label: "Shop 1", wide: true, hint: "Name, address, suburb — phone" },
        { key: "partner_shop_2", label: "Shop 2", wide: true, hint: "Type - for no shop" },
        { key: "partner_shop_3", label: "Shop 3", wide: true, hint: "Type - for no shop" },
      ],
    },
  ],
  payment: [
    { title: "PayID", fields: [{ key: "payid", label: "PayID" }, { key: "payid_name", label: "Account name" }] },
    { title: "Bank account", fields: [{ key: "bank_bsb", label: "BSB" }, { key: "bank_account", label: "Account number" }] },
  ],
};
const PLACED = new Set(Object.values(LAYOUT).flat().flatMap((c) => c.fields.map((f) => f.key)));

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

  const [tab, setTab] = useState("contacts");
  const showPrices = canSee("prices");
  const knowledgeTab = ["contacts", "places", "payment", "text"].includes(tab);
  // Open a tab from the link, e.g. /console/ai/agent?tab=prices.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && ["contacts", "places", "payment", "text", "qa", "prices", "history"].includes(t) && (t !== "prices" || canSee("prices"))) setTab(t);
  }, []);
  const [query, setQuery] = useState("");
  const [openSection, setOpenSection] = useState<string | null>(null);

  const unsaved = useMemo(() => {
    if (!data) return 0;
    return (
      data.details.filter((d) => (details[d.key] ?? "").trim() !== d.value).length +
      data.sections.filter((s) => (sections[s.key] ?? "").trim() !== s.text.trim()).length
    );
  }, [data, details, sections]);
  const changed = unsaved > 0;

  // Cards per tab; any detail the layout doesn't know yet goes on an "Other" card.
  const cards = useMemo(() => {
    const byKey = new Map((data?.details ?? []).map((d) => [d.key, d]));
    const build = (defs: CardDef[]) =>
      defs
        .map((c) => ({ title: c.title, fields: c.fields.filter((f) => byKey.has(f.key)).map((f) => ({ ...f, d: byKey.get(f.key)! })) }))
        .filter((c) => c.fields.length);
    const other = (data?.details ?? []).filter((d) => !PLACED.has(d.key)).map((d) => ({ key: d.key, label: d.label, d }));
    return {
      contacts: [...build(LAYOUT.contacts), ...(other.length ? [{ title: "Other", fields: other }] : [])],
      places: build(LAYOUT.places),
      payment: build(LAYOUT.payment),
    };
  }, [data]);

  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const cardMatches = (c: (typeof cards)["contacts"][number]) =>
    matches(c.title) || c.fields.some((f) => matches(f.label) || matches(details[f.key] ?? ""));

  const setDetail = (key: string, value: string) => {
    setDetails((s) => ({ ...s, [key]: value }));
    setSuccess(null);
  };

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
        description="Everything the chat bot knows, in one place. Changes reach WhatsApp and the website chat from the next message."
      />

      <div className="mb-6 rounded-xl border bg-secondary/40 p-4 text-sm text-muted-foreground">
        <p className="mb-1.5 font-medium text-foreground">💡 How the bot uses this</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Contacts, Places, Payment</b> go into every bot reply (English, Sinhala and Tamil).</li>
          <li><b>Bot text</b> is used to answer questions the bot has no ready answer for. If the answer isn't there, the chat goes to staff.</li>
          <li><b>Q&amp;A</b>: single questions the bot answers by itself (e.g. "I only have an Australian passport").</li>
          <li><b>Prices</b>: what the bot quotes and the offers it applies. <b>Shipping dates</b> come from the Shipping calendar.</li>
        </ul>
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>
      ) : (
        <>
          {(knowledgeTab || q) && (
            <div className="relative mb-4 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search — e.g. insurance, Wattala, BSB" className="pl-9" />
            </div>
          )}

          {q ? (
            // Search: matching cards and bot text from every tab.
            <div className="flex flex-col gap-4">
              <CardGrid
                cards={[...cards.contacts, ...cards.places, ...cards.payment].filter(cardMatches)}
                details={details}
                isAdmin={data.isAdmin}
                onChange={setDetail}
              />
              {data.sections
                .filter((s) => matches(s.title) || matches(sections[s.key] ?? ""))
                .map((s) => (
                  <SectionRow key={s.key} s={s} text={sections[s.key] ?? ""} open onToggle={() => {}} onChange={(v) => { setSections((x) => ({ ...x, [s.key]: v })); setSuccess(null); }} />
                ))}
              {![...cards.contacts, ...cards.places, ...cards.payment].some(cardMatches) &&
                !data.sections.some((s) => matches(s.title) || matches(sections[s.key] ?? "")) && (
                  <p className="text-sm text-muted-foreground">Nothing found for "{query}".</p>
                )}
            </div>
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
                <TabsTrigger value="contacts" className="gap-1.5"><Phone className="h-3.5 w-3.5" /> Contacts</TabsTrigger>
                <TabsTrigger value="places" className="gap-1.5"><MapPin className="h-3.5 w-3.5" /> Places</TabsTrigger>
                <TabsTrigger value="payment" className="gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Payment</TabsTrigger>
                <TabsTrigger value="text" className="gap-1.5"><MessageSquareText className="h-3.5 w-3.5" /> Bot text</TabsTrigger>
                <TabsTrigger value="qa" className="gap-1.5"><MessagesSquare className="h-3.5 w-3.5" /> Q&amp;A</TabsTrigger>
                {showPrices && <TabsTrigger value="prices" className="gap-1.5"><BadgePercent className="h-3.5 w-3.5" /> Prices</TabsTrigger>}
                <TabsTrigger value="history" className="gap-1.5"><History className="h-3.5 w-3.5" /> History</TabsTrigger>
              </TabsList>
              <TabsContent value="qa" className="mt-0">
                <BotFaqPage embedded />
              </TabsContent>
              {showPrices && (
                <TabsContent value="prices" className="mt-0">
                  <PricesPage embedded />
                </TabsContent>
              )}
              {(["contacts", "places", "payment"] as const).map((t) => (
                <TabsContent key={t} value={t} className="mt-0">
                  {t === "payment" && !data.isAdmin && (
                    <p className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Only an admin can change the payment details.</p>
                  )}
                  <CardGrid cards={cards[t]} details={details} isAdmin={data.isAdmin} onChange={setDetail} />
                </TabsContent>
              ))}
              <TabsContent value="text" className="mt-0 flex flex-col gap-2">
                <p className="mb-1 text-sm text-muted-foreground">What the bot answers from when it has no ready-made reply. Click a title to open it.</p>
                {data.sections.map((s) => (
                  <SectionRow
                    key={s.key}
                    s={s}
                    text={sections[s.key] ?? ""}
                    open={openSection === s.key}
                    onToggle={() => setOpenSection((k) => (k === s.key ? null : s.key))}
                    onChange={(v) => { setSections((x) => ({ ...x, [s.key]: v })); setSuccess(null); }}
                  />
                ))}
              </TabsContent>
              <TabsContent value="history" className="mt-0">
                <HistoryCard key={historyKey} onRestore={restore} />
              </TabsContent>
            </Tabs>
          )}
        </>
      )}

      {/* Q&A and Prices have their own Save. */}
      {data && (knowledgeTab || tab === "history" || changed || q) && (
        <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur">
          <Button type="button" disabled={saving || !changed} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {changed && !saving && (
            <span className="text-sm font-medium text-attention-foreground">
              {unsaved} unsaved change{unsaved === 1 ? "" : "s"}
            </span>
          )}
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

type PlacedField = Field & { d: AgentKnowledge["details"][number] };

function CardGrid({
  cards,
  details,
  isAdmin,
  onChange,
}: {
  cards: { title: string; fields: PlacedField[] }[];
  details: Record<string, string>;
  isAdmin: boolean;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      {cards.map((c) => (
        <Card key={c.title}>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">{c.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 pt-1 sm:grid-cols-2">
            {c.fields.map((f) => {
              const value = details[f.key] ?? "";
              const locked = !!f.d.adminOnly && !isAdmin;
              const edited = value.trim() !== "" && value.trim() !== f.d.default;
              return (
                <label key={f.key} className={`flex flex-col gap-1 text-sm ${f.wide ? "sm:col-span-2" : ""}`}>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    {f.label}
                    {f.d.adminOnly && <Lock className="h-3 w-3" />}
                    {edited && (
                      <span className="rounded-full bg-attention-soft px-1.5 text-[10px] font-semibold uppercase tracking-wide text-attention-foreground" title={`Standard: ${f.d.default}`}>
                        Changed
                      </span>
                    )}
                    {edited && !locked && (
                      <button
                        type="button"
                        className="ml-auto text-muted-foreground hover:text-foreground"
                        title={`Put back the standard: ${f.d.default}`}
                        aria-label={`Put back the standard ${f.label}`}
                        onClick={() => onChange(f.key, f.d.default)}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                  <Input value={value} disabled={locked} maxLength={200} placeholder={f.d.default} onChange={(e) => onChange(f.key, e.target.value)} />
                  {f.hint && <span className="text-xs text-muted-foreground">{f.hint}</span>}
                </label>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SectionRow({
  s,
  text,
  open,
  onToggle,
  onChange,
}: {
  s: AgentKnowledge["sections"][number];
  text: string;
  open: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  const edited = !!s.default && text.trim() !== s.default.trim();
  return (
    <Card>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-4 py-3 text-left" aria-expanded={open}>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="font-semibold text-foreground">{s.title}</span>
        {edited && (
          <span className="rounded-full bg-attention-soft px-1.5 text-[10px] font-semibold uppercase tracking-wide text-attention-foreground">Changed</span>
        )}
        {!open && <span className="ml-2 hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">{text.split("\n")[0]}</span>}
      </button>
      {open && (
        <CardContent className="flex flex-col gap-2 px-4 pb-4 pt-0">
          <Textarea
            value={text}
            rows={Math.min(16, Math.max(5, text.split("\n").length + 1))}
            maxLength={4000}
            className="text-sm"
            onChange={(e) => onChange(e.target.value)}
          />
          {edited && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 self-start text-xs"
              onClick={() => {
                if (window.confirm(`Put "${s.title}" back to the standard text?`)) onChange(s.default);
              }}
            >
              <RotateCcw className="h-3 w-3" /> Standard text
            </Button>
          )}
        </CardContent>
      )}
    </Card>
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
