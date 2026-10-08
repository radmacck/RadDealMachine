import { ArrowRight, Headphones, ShieldAlert } from 'lucide-react';
import { Link } from 'wouter';
import type { AcquisitionQueueItem } from '@workspace/api-client-react';

export function AcquisitionQueueCard({ item, compact = false }: {
  item: AcquisitionQueueItem;
  compact?: boolean;
}) {
  const callable = item.decision === 'CALL_NEXT';
  const selectedPhonePath = item.contactReadiness.selectedPhonePath;
  const rankingReasons = selectedPhonePath?.rankingReasons ?? [];
  const missingInformation = item.lead.propertyQualification?.missingInformation ?? [];
  const visibleSignals = [...item.propertySignals]
    .sort((a, b) => b.scoreContribution - a.scoreContribution || a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id))
    .slice(0, compact ? 2 : 4);
  return (
    <article className="ledger p-4" data-testid={`acquisition-queue-${item.lead.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Rank {item.rank} · {item.evidenceScore}/100 evidence-backed relevance</p>
          <h3 className="text-lg font-semibold">{item.lead.address}</h3>
          <p className="text-xs text-muted-foreground">{item.lead.city}, {item.lead.state} {item.lead.zip} · seller identity/signing authority not established by property ownership alone</p>
        </div>
        <span className={`tag ${callable ? 'tone-signal' : 'tone-warn'}`}>
          {callable ? <Headphones className="mr-1 inline h-3 w-3" /> : <ShieldAlert className="mr-1 inline h-3 w-3" />}
          {callable ? 'CALL NEXT' : 'Blocked'}
        </span>
      </div>
      <p className="mt-3 text-sm" data-testid="text-acquisition-ranking">{item.rankingReason}</p>
      {item.blocker && <div className="mt-3 border-l-2 border-destructive pl-3" data-testid="text-acquisition-blocker">
        <p className="text-sm font-semibold">{item.blocker}</p>
        <p className="mt-1 text-sm text-muted-foreground"><b>Next action:</b> {item.nextAction}</p>
      </div>}
      {missingInformation.length > 0 && <div className="mt-2 text-xs">
        <b>Still missing:</b> {missingInformation.slice(0, compact ? 2 : 5).join(' · ')}
      </div>}
      {callable && selectedPhonePath && (
        <div className="mt-3 rounded-sm border border-signal/40 bg-signal/5 p-3 text-sm" data-testid="panel-acquisition-contact">
          <b>Permitted ranked phone route:</b> {selectedPhonePath.routeValue}
          <span className="block text-xs text-muted-foreground">
            {selectedPhonePath.sourceName} · {selectedPhonePath.classification} · {selectedPhonePath.freshnessStatus} · {selectedPhonePath.permissionStatus} · {(selectedPhonePath.recipientRole ?? 'UNKNOWN').replaceAll('_', ' ')}
          </span>
          {rankingReasons.length > 0 && <span className="mt-1 block text-xs">{rankingReasons.join(' · ')}</span>}
          <span className="mt-1 block text-xs">Recipient identity remains {(selectedPhonePath.identityStatus ?? 'UNVERIFIED').toLowerCase()}; confirm who answered and their role. No call has been placed.</span>
        </div>
      )}
      {!!visibleSignals.length && <div className="mt-3">
        <p className="eyebrow mb-1">Persisted relevance evidence</p>
        <ul className="space-y-1 text-xs">
          {visibleSignals.map(signal => <li key={signal.id}>
            <b>{signal.classification.replaceAll('_', ' ')} · {signal.key.replaceAll('_', ' ')}</b> — {signal.statement} <span className="text-muted-foreground">({signal.scoreContribution} points · {signal.source})</span>
          </li>)}
        </ul>
        {item.propertySignals.some(signal => signal.classification === 'AI_HYPOTHESIS') && (
          <p className="mt-2 text-xs text-muted-foreground">AI hypotheses remain hypotheses and contribute zero queue-ranking points.</p>
        )}
      </div>}
      {!compact && item.callBrief && <div className="mt-3 border-t border-border pt-3 text-xs">
        <b>Where we are:</b> {item.lead.stage.replaceAll('_', ' ')} · <b>Known:</b> {item.lead.propertyType.replaceAll('_', ' ')}, {item.lead.sqft.toLocaleString()} sq ft, {item.lead.beds} beds / {item.lead.baths} baths.
        <div className="mt-1"><b>Seller/owner evidence:</b> {item.callBrief.intelligence.length
          ? item.callBrief.intelligence.slice(0, 3).map(entry => `${entry.classification.replaceAll('_', ' ')}: ${entry.statement}`).join(' · ')
          : 'No supplemental seller evidence; ask rather than assume.'}</div>
        <div className="mt-1"><b>Questions:</b> {item.callBrief.questions.slice(0, 5).join(' · ')}</div>
        <div className="mt-1"><b>Economics:</b> {item.callBrief.analysis ? `ARV ${item.callBrief.analysis.arv.expected.toLocaleString()}, repairs ${
          item.callBrief.analysis.repairEstimate.total
            ? `${item.callBrief.analysis.repairEstimate.total.low.toLocaleString()}–${item.callBrief.analysis.repairEstimate.total.high.toLocaleString()}`
            : 'not calculated'
        }, MAO ${item.callBrief.analysis.mao.toLocaleString()} (calculation, not authority).` : 'No current underwriting.'}</div>
      </div>}
      <Link className="mt-3 inline-flex items-center gap-1 text-sm font-semibold underline" href={`/calls?lead=${encodeURIComponent(item.lead.id)}`}
        aria-label={`${callable ? 'Open call brief' : 'Review blocked acquisition'} for ${item.lead.address}`}>
        {callable ? 'Open call brief' : 'Review next step'} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </article>
  );
}
