import { Phone } from 'lucide-react';
import type { AcquisitionQueueItem, Call, CallBrief } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { ProvenanceSections } from '@/components/provenance-sections';
import { StageBadge } from '@/components/stage-badge';
import { ApprovedTerms } from '@/components/offers-panel';
import { ago, fmtDate, isOverdue, money } from '@/lib/format';

export function CallBriefCard({ brief, contactReadiness, priorCalls = [] }: {
  brief: CallBrief;
  contactReadiness: AcquisitionQueueItem['contactReadiness'];
  priorCalls?: Call[];
}) {
  const { lead, analysis: a } = brief;
  const verified = brief.intelligence.filter(item => item.classification === 'VERIFIED_FACTS').slice(0, 5);
  const hypotheses = brief.intelligence.filter(item => item.classification === 'AI_HYPOTHESIS').slice(0, 3);
  const route = contactReadiness.selectedPhonePath;
  return (
    <div className="space-y-4" data-testid={`brief-${lead.id}`}>
      <section className="ledger grid gap-3 p-3 md:grid-cols-3" data-testid="seller-call-packet">
        <div>
          <p className="eyebrow">Verified property facts</p>
          {verified.length ? <ul className="mt-1 space-y-1 text-xs">{verified.map(item => <li key={item.id}>
            {item.statement} <span className="text-muted-foreground">· {item.source}</span>
            {item.sourceUrl && <> · <a className="underline" href={item.sourceUrl} target="_blank" rel="noreferrer">source</a></>}
          </li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">No verified facts in the current brief.</p>}
          {hypotheses.length > 0 && <p className="mt-2 text-xs">AI hypotheses (not facts): {hypotheses.map(x => x.statement).join(' · ')}</p>}
        </div>
        <div>
          <p className="eyebrow">Contact evidence</p>
          {route ? <div className="mt-1 text-xs">
            <p>{route.channel} · {(route.recipientRole ?? 'UNKNOWN').replaceAll('_', ' ')} · {route.freshnessStatus} · permission {route.permissionStatus}</p>
            <p>{route.sourceName} / record {route.sourceRecordId} · confidence {Math.round(route.confidence * 100)}% · observed {fmtDate(route.capturedAt)}</p>
            <a className="underline" href={route.sourceUrl} target="_blank" rel="noreferrer">Review route source</a>
            <p className="text-muted-foreground">Identity/signing authority remain unverified unless separately reviewed.</p>
          </div> : <p className="mt-1 text-xs text-muted-foreground">No currently selected direct phone evidence.</p>}
        </div>
        <div>
          <p className="eyebrow">Prior human-entered calls</p>
          {priorCalls.length ? <ul className="mt-1 space-y-1 text-xs">{priorCalls.slice(0, 2).map(call => <li key={call.id}>
            <b>{call.outcome.replaceAll('_', ' ')}</b> · {fmtDate(call.occurredAt)} · entered by {call.actor} · call {call.id.slice(0, 8)}
            <span className="block">{call.notes}</span>
            {call.nextAction && <span className="block">Next: {call.nextAction}</span>}
          </li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">No prior call notes.</p>}
        </div>
      </section>
      <div className="ledger p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow mb-1">Calling</p>
            <h2 className="text-3xl font-semibold" data-testid="text-brief-seller">{lead.sellerName}</h2>
            <p className="text-sm text-muted-foreground">{lead.address}, {lead.city}, {lead.state} {lead.zip}</p>
          </div>
          <div className="text-right">
            {lead.sellerPhone ? (
              <a href={`tel:${lead.sellerPhone}`} className="inline-flex items-center gap-2 bg-signal px-4 py-2.5 font-mono text-lg font-semibold text-sidebar-primary-foreground transition-transform active:scale-95" data-testid="link-call-phone"><Phone className="h-4 w-4" />{lead.sellerPhone}</a>
            ) : <span className="tag tone-stop">No phone on file</span>}
            <div className="mt-2 flex justify-end gap-2"><StageBadge stage={lead.stage} /><Link href={`/leads/${lead.id}`} className="text-xs underline" data-testid="link-brief-lead">Full lead</Link></div>
          </div>
        </div>
        <p className="mt-3 border-l-2 border-signal pl-3 text-base" data-testid="text-brief-objective"><b>Objective:</b> {brief.objective}</p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div><p className="eyebrow">Opening range</p><p className="font-mono font-semibold">{money(a.openingLow)} to {money(a.openingHigh)}</p></div>
          <div><p className="eyebrow">Asking</p><p className="font-mono">{money(lead.askingPrice)}</p></div>
          <div><p className="eyebrow">Follow up</p><p className={`font-mono ${isOverdue(lead.followUpAt) ? 'font-semibold text-destructive' : ''}`}>{lead.followUpAt ? `${fmtDate(lead.followUpAt)} (${ago(lead.followUpAt)})` : 'none'}</p></div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground" data-testid="text-call-underwriting-assumptions">
          Deterministic estimate from {fmtDate(a.calculatedAt)} · ARV {money(a.arv.expected)} · repairs {money(a.repairEstimate.total?.low ?? a.repairs.low)}–{money(a.repairEstimate.total?.high ?? a.repairs.high)} · MAO {money(a.mao)}. These are underwriting assumptions, not seller statements or an authorized offer.
        </p>
        {a.risks.length > 0 && <p className="mt-1 text-xs"><b>Underwriting risks:</b> {a.risks.join(' · ')}</p>}
        <details className="mt-1 text-xs"><summary className="cursor-pointer">Calculation formula and assumptions</summary>
          <p className="mt-1">{a.formula}</p>
          <p>Holding: {a.assumptions.holdingMonths} months · contingency: {Math.round(a.assumptions.contingencyPct*100)}% · selling cost: {Math.round(a.assumptions.sellingCostPct*100)}%.</p>
        </details>
        <p className="mt-3 border border-dashed border-border bg-muted/50 p-2 text-xs" data-testid="text-brief-boundaries"><b>Boundaries:</b> {brief.boundaries}</p>
      </div>
      <div className="ledger p-3" data-testid="panel-brief-offer">
        <p className="eyebrow mb-1.5">Owner-approved offer</p>
        {brief.authorizedOffer && brief.authorizedOffer.effectiveStatus === 'AUTHORIZED' ? (
          <><ApprovedTerms offer={brief.authorizedOffer} /><p className="mt-2 text-xs">Do not exceed the ceiling. Record only what you actually communicate.</p></>
        ) : <p className="text-sm text-muted-foreground">No currently authorized offer. Do not state an offer amount on this call.</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="ledger p-3"><p className="eyebrow mb-1.5">Questions to ask</p>
          {brief.questions.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{brief.questions.map((q, i) => <li key={i}>{q}</li>)}</ul> : <p className="text-sm text-muted-foreground">None generated.</p>}</div>
        <div className="ledger p-3"><p className="eyebrow mb-1.5">Actions during or after</p>
          {brief.actions.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{brief.actions.map((q, i) => <li key={i}>{q}</li>)}</ul> : <p className="text-sm text-muted-foreground">None generated.</p>}</div>
      </div>
      <ProvenanceSections items={brief.intelligence} compact />
    </div>
  );
}
