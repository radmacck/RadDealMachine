import { ExternalLink, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Intelligence, ProvenanceClass } from '@workspace/api-client-react';
import { fmtDate, pct } from '@/lib/format';

export const PROVENANCE: { key: ProvenanceClass; title: string; blurb: string; empty: string }[] = [
  { key: 'VERIFIED_FACTS', title: 'Verified facts', blurb: 'Public record or inspection, with a verification note.', empty: 'Nothing verified yet. Do not treat any number on this lead as confirmed.' },
  { key: 'OBSERVED', title: 'Observed', blurb: 'Seen directly in a listing, page, or by an analyst; not independently verified.', empty: 'No observations recorded.' },
  { key: 'INDICATED', title: 'Indicated', blurb: 'Claimed or implied, including everything the seller has said.', empty: 'No indicated statements recorded.' },
  { key: 'AI_HYPOTHESIS', title: 'AI hypotheses', blurb: 'Model guesses. Each one carries a question to ask and an action to take.', empty: 'No hypotheses recorded.' },
];

function Item({ it }: { it: Intelligence }) {
  return (
    <li className={`prov-bar prov-${it.classification} bg-card py-2.5 pl-3 pr-3`} data-testid={`intel-${it.id}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="tag prov-chip">{it.category}</span>
        <span className="eyebrow">{it.sourceType.replace(/_/g, ' ')} / conf {pct(it.confidence)}</span>
      </div>
      <p className="text-sm leading-snug">{it.statement}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {it.source}
        {it.sourceUrl && (
          <a href={it.sourceUrl} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 underline" data-testid={`link-source-${it.id}`}>
            link <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <span className="ml-2">captured {fmtDate(it.capturedAt, false)}</span>
      </p>
      {it.verificationNote && <p className="mt-1 text-xs"><b>Verification:</b> {it.verificationNote}</p>}
      {it.category.trim().toLowerCase() === 'seller_contact' && (
        <p className="mt-1 text-xs" data-testid={`contact-permission-${it.id}`}>
          <b>Contact permission:</b> {(it.contactPermissionStatus ?? 'NOT_REVIEWED').replaceAll('_', ' ').toLowerCase()}.
          {it.contactPermissionEvidenceUrl
            ? <> Permission evidence <a href={it.contactPermissionEvidenceUrl} target="_blank" rel="noreferrer" className="underline">link</a>.</>
            : ' No permission evidence link is recorded.'}
          {' '}Public availability alone does not establish permission.
        </p>
      )}
      {it.question && <p className="mt-1 text-xs"><b>Ask:</b> {it.question}</p>}
      {it.action && <p className="text-xs"><b>Do:</b> {it.action}</p>}
    </li>
  );
}

export function ProvenanceSections({
  items, onAdd, compact = false,
}: { items: Intelligence[]; onAdd?: (c: ProvenanceClass) => void; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-3' : 'grid gap-4 lg:grid-cols-2'} data-testid="provenance-sections">
      {PROVENANCE.map((p) => {
        const list = items.filter((i) => i.classification === p.key);
        return (
          <section key={p.key} className={`ledger prov-${p.key} p-3`} data-testid={`section-${p.key}`}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'hsl(var(--pc))' }} />
                  {p.title} <span className="font-mono text-xs text-muted-foreground">{list.length}</span>
                </h3>
                {!compact && <p className="text-xs text-muted-foreground">{p.blurb}</p>}
              </div>
              {onAdd && (
                <Button size="sm" variant="outline" onClick={() => onAdd(p.key)} data-testid={`button-add-${p.key}`}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add
                </Button>
              )}
            </div>
            {list.length === 0 ? (
              <p className="border border-dashed border-border px-3 py-3 text-xs text-muted-foreground" data-testid={`empty-${p.key}`}>{p.empty}</p>
            ) : (
              <ul className="space-y-2">{list.map((i) => <Item key={i.id} it={i} />)}</ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
