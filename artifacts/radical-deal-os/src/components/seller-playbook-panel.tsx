import { useMemo, useState } from "react";
import {
  getGetSellerPlaybookQueryKey,
  useGetSellerPlaybook,
  useUpdateSellerPlaybookEntry,
  type SellerPlaybookEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, History, Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorNotice } from "@/components/state-views";
import { useAccess } from "@/hooks/use-access";

type EditableContent = Omit<SellerPlaybookEntry["content"], "kind" | "matchTerms">;
type Draft = EditableContent & { changeReason: string };

function lines(value: string) {
  return value.split("\n").map((part) => part.trim()).filter(Boolean);
}

function LinesEditor({ label, value, rows = 3, onChange }: {
  label: string;
  value: string[];
  rows?: number;
  onChange: (next: string[]) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold">{label}</span>
      <Textarea rows={rows} value={value.join("\n")} onChange={(event) => onChange(lines(event.target.value))} />
    </label>
  );
}

function editable(entry: SellerPlaybookEntry): EditableContent {
  const { content } = entry;
  return {
    title: content.title,
    hypothesis: content.hypothesis,
    discoveryQuestions: [...content.discoveryQuestions],
    empatheticResponse: content.empatheticResponse,
    negotiationOptions: [...content.negotiationOptions],
    followUpGuidance: [...content.followUpGuidance],
    risks: [...content.risks],
    escalationConditions: [...content.escalationConditions],
    confirmingEvidence: [...content.confirmingEvidence],
    refutingEvidence: [...content.refutingEvidence],
    doNotPromise: [...content.doNotPromise],
  };
}

export function SellerPlaybookPanel({ leadId }: { leadId: string }) {
  const { isOwner } = useAccess();
  const queryClient = useQueryClient();
  const query = useGetSellerPlaybook(leadId, {
    query: { queryKey: getGetSellerPlaybookQueryKey(leadId), enabled: !!leadId },
  });
  const update = useUpdateSellerPlaybookEntry();
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const entries = query.data?.entries ?? [];
  const orderedEntries = useMemo(() => {
    const matched = entries.filter((entry) => entry.relevance.status === "SELLER_REPORTED_TOPIC_TO_CONFIRM");
    const general = entries.filter((entry) => entry.relevance.status === "GENERAL_QUESTION");
    return [...matched, ...general];
  }, [entries]);

  function beginEdit(entry: SellerPlaybookEntry) {
    setEditingSlug(entry.slug);
    setDraft({ ...editable(entry), changeReason: "" });
  }

  function save(entry: SellerPlaybookEntry) {
    if (!draft) return;
    update.mutate({
      id: leadId,
      slug: entry.slug,
      data: {
        expectedVersion: entry.version,
        changeReason: draft.changeReason,
        content: {
          title: draft.title,
          hypothesis: draft.hypothesis,
          discoveryQuestions: draft.discoveryQuestions,
          empatheticResponse: draft.empatheticResponse,
          negotiationOptions: draft.negotiationOptions,
          followUpGuidance: draft.followUpGuidance,
          risks: draft.risks,
          escalationConditions: draft.escalationConditions,
          confirmingEvidence: draft.confirmingEvidence,
          refutingEvidence: draft.refutingEvidence,
          doNotPromise: draft.doNotPromise,
        },
      },
    }, {
      onSuccess: async () => {
        setEditingSlug(null);
        setDraft(null);
        await queryClient.invalidateQueries({ queryKey: getGetSellerPlaybookQueryKey(leadId) });
      },
    });
  }

  if (query.isLoading) {
    return <section className="ledger p-4" aria-busy="true" data-testid="seller-playbook-loading">
      <p className="eyebrow">Seller conversation guidance</p>
      <p className="mt-2 text-sm text-muted-foreground">Loading the persisted playbook for this lead…</p>
    </section>;
  }
  if (query.error) {
    return <section className="space-y-2" data-testid="seller-playbook-error">
      <ErrorNotice error={query.error} onRetry={() => void query.refetch()} title="Seller guidance could not be loaded" />
    </section>;
  }
  if (!query.data || entries.length === 0) {
    return <section className="ledger p-4" role="status" data-testid="seller-playbook-empty">
      <p className="eyebrow">Seller conversation guidance</p>
      <p className="mt-2 text-sm">No playbook entries are available. No scenario or motivation has been inferred.</p>
    </section>;
  }

  return (
    <section className="ledger space-y-4 p-4" data-testid="seller-playbook-panel">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 h-4 w-4 text-signal" />
        <div>
          <p className="eyebrow">Conversation playbook · {entries.length} versioned entries</p>
          <p className="mt-1 text-sm font-semibold">Possible context is a question, not a fact.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Property flags never establish seller motivation. A matched topic below comes only from seller-reported evidence and remains INDICATED until independently reviewed. Guidance cannot change offer terms.
          </p>
        </div>
      </div>
      {update.error && <ErrorNotice error={update.error} title="Playbook revision was not saved" />}
      <div className="space-y-2">
        {orderedEntries.map((entry, index) => {
          const isEditing = editingSlug === entry.slug && draft !== null;
          return (
            <details key={entry.slug} open={index < 4} className="border border-border bg-background/50 p-3" data-testid={`seller-playbook-${entry.slug}`}>
              <summary className="cursor-pointer font-semibold">
                {entry.content.title} <span className="ml-1 text-[11px] font-normal text-muted-foreground">· v{entry.version} · {entry.relevance.status === "SELLER_REPORTED_TOPIC_TO_CONFIRM" ? "seller-reported topic to confirm" : "general prompt"}</span>
              </summary>
              <article className="pt-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{entry.content.title}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {entry.content.kind === "SITUATION_HYPOTHESIS" ? "Possible situation · hypothesis only" : "General objection guidance"}
                    {" · "}v{entry.version}
                  </p>
                </div>
                {isOwner && !isEditing && <Button type="button" variant="outline" size="sm" onClick={() => beginEdit(entry)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />Edit guidance
                </Button>}
              </div>
              <p className="mt-2 border-l-2 border-signal/50 pl-2 text-sm">{entry.content.hypothesis}</p>
              <p className="mt-2 text-xs text-muted-foreground">{entry.relevance.reason}</p>
              {entry.relevance.evidenceRefs.length > 0 && (
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                  Seller evidence references: {entry.relevance.evidenceRefs.join(", ")}
                </p>
              )}
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="eyebrow mb-1">Ask to confirm or refute</p>
                  <ul className="list-disc space-y-1 pl-5 text-xs">{entry.content.discoveryQuestions.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div>
                  <p className="eyebrow mb-1">Empathy-first response</p>
                  <p className="text-xs">{entry.content.empatheticResponse}</p>
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold">Options, follow-up, risks, and evidence</summary>
                <div className="mt-2 grid gap-3 text-xs md:grid-cols-2">
                  <div><p className="eyebrow mb-1">Options to review</p><ul className="list-disc space-y-1 pl-5">{entry.content.negotiationOptions.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div><p className="eyebrow mb-1">Follow-up</p><ul className="list-disc space-y-1 pl-5">{entry.content.followUpGuidance.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div><p className="eyebrow mb-1">Risks and escalation</p><ul className="list-disc space-y-1 pl-5">{[...entry.content.risks, ...entry.content.escalationConditions].map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div><p className="eyebrow mb-1">Evidence to confirm or refute</p>
                    <p><b>Confirm:</b> {entry.content.confirmingEvidence.join(" ")}</p>
                    <p className="mt-1"><b>Refute:</b> {entry.content.refutingEvidence.join(" ")}</p>
                  </div>
                  <div className="md:col-span-2 rounded-sm border border-amber-600/30 bg-amber-600/5 p-2">
                    <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Do not promise</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5">{entry.content.doNotPromise.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                </div>
              </details>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer flex items-center gap-1"><History className="h-3.5 w-3.5" />Source and revision history</summary>
                <div className="mt-2 space-y-2">
                  <p>Sources support general listening/question methods only; they do not establish this seller's situation.</p>
                  {entry.sourceProvenance.map((source) => (
                    <p key={source.sourceId}>
                      <a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.title}</a>
                      <span className="ml-1 text-muted-foreground">· accessed {new Date(source.accessedAt).toLocaleDateString()}</span>
                      <span className="block text-muted-foreground">{source.scopeLimit}</span>
                    </p>
                  ))}
                  <ol className="space-y-1 border-t border-border pt-2">
                    {entry.revisions.map((revision) => <li key={revision.version}>v{revision.version} · {new Date(revision.recordedAt).toLocaleString()} · {revision.changeReason} · {revision.actor}</li>)}
                  </ol>
                </div>
              </details>
              {isEditing && draft && (
                <div className="mt-3 space-y-3 border-t border-border pt-3" data-testid={`seller-playbook-editor-${entry.slug}`}>
                  <p className="text-xs">Editing v{entry.version}. Source references and trigger terms remain locked to preserve provenance and stable matching.</p>
                  <label className="block space-y-1 text-xs font-semibold">Title
                    <Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                  </label>
                  <label className="block space-y-1 text-xs font-semibold">Hypothesis or guidance scope
                    <Textarea rows={3} value={draft.hypothesis} onChange={(event) => setDraft({ ...draft, hypothesis: event.target.value })} />
                  </label>
                  <label className="block space-y-1 text-xs font-semibold">Empathy-first response
                    <Textarea rows={2} value={draft.empatheticResponse} onChange={(event) => setDraft({ ...draft, empatheticResponse: event.target.value })} />
                  </label>
                  <LinesEditor label="Discovery questions (one per line)" value={draft.discoveryQuestions} onChange={(next) => setDraft({ ...draft, discoveryQuestions: next })} />
                  <LinesEditor label="Negotiation options (one per line)" value={draft.negotiationOptions} onChange={(next) => setDraft({ ...draft, negotiationOptions: next })} />
                  <LinesEditor label="Follow-up guidance (one per line)" value={draft.followUpGuidance} onChange={(next) => setDraft({ ...draft, followUpGuidance: next })} />
                  <LinesEditor label="Risks (one per line)" value={draft.risks} onChange={(next) => setDraft({ ...draft, risks: next })} />
                  <LinesEditor label="Escalation conditions (one per line)" value={draft.escalationConditions} onChange={(next) => setDraft({ ...draft, escalationConditions: next })} />
                  <LinesEditor label="Evidence that confirms (one per line)" value={draft.confirmingEvidence} onChange={(next) => setDraft({ ...draft, confirmingEvidence: next })} />
                  <LinesEditor label="Evidence that refutes (one per line)" value={draft.refutingEvidence} onChange={(next) => setDraft({ ...draft, refutingEvidence: next })} />
                  <LinesEditor label="Do not promise (one per line)" value={draft.doNotPromise} onChange={(next) => setDraft({ ...draft, doNotPromise: next })} />
                  <label className="block space-y-1 text-xs font-semibold">Reason for revision
                    <Input value={draft.changeReason} onChange={(event) => setDraft({ ...draft, changeReason: event.target.value })} placeholder="Why this guidance changed" />
                  </label>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={update.isPending || draft.changeReason.trim().length < 5 || !draft.title.trim() || !draft.hypothesis.trim()} onClick={() => save(entry)}>
                      <Save className="mr-1.5 h-3.5 w-3.5" />{update.isPending ? "Saving version…" : "Save new version"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={update.isPending} onClick={() => { setEditingSlug(null); setDraft(null); }}>
                      <X className="mr-1.5 h-3.5 w-3.5" />Cancel
                    </Button>
                  </div>
                </div>
              )}
              </article>
            </details>
          );
        })}
      </div>
      <p className="border-t border-border pt-2 text-xs text-muted-foreground">
        All {entries.length} entries are available above. Seller-reported matches sort first; no property-only signal selects or confirms a motivation.
      </p>
      {!isOwner && <p className="text-[11px] text-muted-foreground">Shared guidance is read-only for this role. Owner approval is required to publish a new version.</p>}
    </section>
  );
}
