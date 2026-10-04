import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ErrorNotice } from '@/components/state-views';
import type { LeadDetail, PropertyEvidencePacket } from '@workspace/api-client-react';

const STEPS = [
  'Download or copy the template. Lead and underwriting are copied from the current record; entries is empty.',
  'Add one object per documented source to entries, each with a unique key plus classification, category, statement, source, sourceType, confidence, capturedAt.',
  'Reference entries from underwriting using their key, or an existing intelligence id from this deal.',
  'Required categories: subject_property, subject_condition, seller_contact, comp_sale:<comp id>, comp_condition:<comp id>, repair_scope:<lower-case repair category>.',
  'Subject: OBSERVED PUBLIC_RECORD with sourceUrl. Contact: INDICATED SELLER, or OBSERVED/VERIFIED non-model. All others: VERIFIED_FACTS public record or inspection, sourceUrl, verificationNote.',
  'Capture age limits: 30 days for subject, contact, condition and repair; 180 days for comps; never future dated.',
];

function template(d: LeadDetail): PropertyEvidencePacket {
  const { id: _i, stage: _s, version: _v, followUpAt: _f, createdAt: _c, updatedAt: _u, nextAction, ...rest } = d.lead;
  const uw = d.underwriting;
  return {
    version: d.lead.version,
    lead: { ...rest, ...(nextAction ? { nextAction } : {}) },
    entries: [],
    underwriting: { ...(uw ?? { comps: [], repairs: [], repairsComplete: false, conditionConfirmed: false }), version: d.lead.version },
  };
}

export function EvidenceIntake({ detail, disabled, pending, error, onSubmit }: {
  detail: LeadDetail; disabled: boolean; pending: boolean; error: unknown; onSubmit: (d: PropertyEvidencePacket, done: () => void) => void;
}) {
  const [text, setText] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const tpl = () => JSON.stringify(template(detail), null, 2);
  const download = () => {
    const url = URL.createObjectURL(new Blob([tpl()], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `evidence-packet-${detail.lead.id}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(tpl()); setLocal(null); } catch { setLocal('Clipboard unavailable; use download.'); } };
  const submit = () => {
    let p: unknown;
    try { p = JSON.parse(text); } catch (e) { return setLocal(`Invalid JSON: ${(e as Error).message}`); }
    const o = p as Partial<PropertyEvidencePacket> | null;
    if (!o || typeof o !== 'object' || typeof o.version !== 'number' || !o.lead || !Array.isArray(o.entries) || !o.underwriting) return setLocal('Packet needs version, lead, entries (array) and underwriting.');
    const keys = o.entries.map((e) => e?.key);
    if (keys.some((k) => typeof k !== 'string' || !k)) return setLocal('Every entry needs a key.');
    if (new Set(keys).size !== keys.length) return setLocal('Entry keys must be unique.');
    setLocal(null);
    onSubmit(o as PropertyEvidencePacket, () => setText(''));
  };
  const a = detail.analysis;
  return (
    <section className="ledger mt-4 space-y-3 p-4" data-testid="panel-evidence-intake">
      <p className="eyebrow">Evidence packet intake (JSON)</p>
      <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
      <p className="text-xs text-muted-foreground">Submission is atomic: all of it is accepted or none. Acceptance does not mean the evidence is reviewed or sufficient.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={download} data-testid="button-packet-download">Download blank template</Button>
        <Button size="sm" variant="outline" onClick={copy} data-testid="button-packet-copy">Copy blank template</Button>
      </div>
      <Textarea rows={12} className="font-mono text-xs" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} placeholder="Paste the completed packet JSON" data-testid="input-packet-json" />
      {local && <p className="text-sm text-destructive" data-testid="text-packet-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      <Button onClick={submit} disabled={disabled || pending || !text.trim()} data-testid="button-packet-submit">{pending ? 'Submitting packet...' : 'Submit evidence packet'}</Button>
      {disabled && <p className="text-xs text-muted-foreground">Only owners and analysts can submit packets.</p>}
      <div className="border-t border-border pt-2 text-sm" data-testid="packet-result">
        <p className="eyebrow mb-1">Current record</p>
        <p>{detail.intelligence.length} evidence statement{detail.intelligence.length === 1 ? '' : 's'} on file.</p>
        {a ? <><p>Analysis: {a.classification}</p>{a.blockers.length > 0 && <ul className="list-disc pl-5">{a.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}</> : <p className="text-muted-foreground">No analysis yet.</p>}
      </div>
    </section>
  );
}
