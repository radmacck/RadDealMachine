import { AlertOctagon, ShieldAlert } from 'lucide-react';
import type { Analysis, Comp, Range } from '@workspace/api-client-react';
import { fmtDate, money, pct } from '@/lib/format';

const CLS_TONE: Record<string, string> = { STRONG: 'tone-go', NEGOTIABLE: 'tone-warn', PASS: 'tone-stop', INCOMPLETE: 'tone-muted' };

function RangeRow({ label, r }: { label: string; r: Range }) {
  return (
    <div className="grid grid-cols-[6rem_1fr_1fr_1fr_4rem] items-baseline gap-2 border-b border-border py-2 text-sm last:border-0">
      <span className="eyebrow">{label}</span>
      <span className="font-mono">{money(r.low)}</span>
      <span className="font-mono font-semibold">{money(r.expected)}</span>
      <span className="font-mono">{money(r.high)}</span>
      <span className="text-right font-mono text-xs text-muted-foreground">{pct(r.confidence)}</span>
    </div>
  );
}

function Big({ label, value, note, tid }: { label: string; value: string; note?: string; tid: string }) {
  return (
    <div className="border-l-2 border-signal pl-3">
      <p className="eyebrow">{label}</p>
      <p className="font-display text-2xl font-semibold" data-testid={tid}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export function AnalysisPanel({ analysis, comps, full = true }: { analysis: Analysis | null; comps?: Comp[]; full?: boolean }) {
  if (!analysis) {
    return (
      <div className="ledger p-4" data-testid="analysis-empty">
        <p className="eyebrow mb-1">Underwriting result</p>
        <p className="text-sm text-muted-foreground">No analysis yet. Save comps and repairs in the Underwriting tab; the server computes everything and shows it here.</p>
      </div>
    );
  }
  const a = analysis;
  const estimateBlocked = a.repairEstimate.status === 'BLOCKED';
  const label = (id: string) => comps?.find((c) => c.id === id)?.address ?? id;
  return (
    <div className="ledger rise p-4" data-testid="analysis-panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <p className="eyebrow">Underwriting result</p>
          <span className={`tag ${CLS_TONE[a.classification]}`} data-testid="badge-classification">{a.classification}</span>
        </div>
        <p className="font-mono text-xs text-muted-foreground">engine {a.engineVersion} / {fmtDate(a.calculatedAt)}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Big tid="text-mao" label="MAO" value={estimateBlocked ? 'BLOCKED' : money(a.mao)} note={estimateBlocked ? 'No complete sourced repair estimate; the system withholds MAO.' : 'Maximum allowable offer'} />
        <Big tid="text-opening" label="Opening range" value={`${money(a.openingLow)} to ${money(a.openingHigh)}`} note="Conversation guide only" />
        <Big tid="text-spread" label="Spread at asking" value={money(a.spreadAtAsking)} note={a.spreadAtAsking == null ? 'No asking price recorded' : 'Margin if bought at asking'} />
        <Big tid="text-approved" label="Research is not authorization" value={a.maximumApprovedAcquisitionPrice == null ? 'Not authorized' : money(a.maximumApprovedAcquisitionPrice)} note="Actual owner approval appears on a specific offer, never on this research snapshot" />
      </div>
      <div className="mt-4">
        <div className="grid grid-cols-[6rem_1fr_1fr_1fr_4rem] gap-2 border-b border-border pb-1">
          <span /><span className="eyebrow">Low</span><span className="eyebrow">Expected</span><span className="eyebrow">High</span><span className="eyebrow text-right">Conf</span>
        </div>
        <RangeRow label="ARV" r={a.arv} />
        <RangeRow label="Repairs" r={a.repairs} />
      </div>
      {a.repairEstimate.status !== 'NOT_USED' && (
        <section className="mt-4 border border-border p-3" data-testid="repair-estimate-result">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">Condition-based repair estimate · {a.repairEstimate.status}</p>
            <p className="font-mono text-xs text-muted-foreground">{a.repairEstimate.marketKey} · rate catalog v{a.repairEstimate.catalogVersion}</p>
          </div>
          {a.repairEstimate.status === 'CALCULATED' && a.repairEstimate.total && (
            <p className="mt-1 font-mono text-sm" data-testid="text-repair-estimate-total">
              {money(a.repairEstimate.total.low)} / {money(a.repairEstimate.total.expected)} / {money(a.repairEstimate.total.high)} · {pct(a.repairEstimate.total.confidence)} confidence
            </p>
          )}
          {a.repairEstimate.status === 'BLOCKED' && (
            <p className="mt-1 text-sm text-destructive">Partial costs are not used for MAO. Resolve every listed evidence or rate-card blocker first.</p>
          )}
          {a.repairEstimate.lines.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {a.repairEstimate.lines.map((line, index) => (
                <li key={`${line.evidenceId}-${index}`} className="flex flex-wrap justify-between gap-2 border-t border-border/60 pt-1">
                  <span>{line.category} · {line.severity.replace(/_/g, ' ')} · {line.quantity} {line.unit}</span>
                  <span className="font-mono">{money(line.low)} / {money(line.expected)} / {money(line.high)}</span>
                  <a className="underline underline-offset-2" href={line.sourceUrl} target="_blank" rel="noreferrer">{line.source}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {(a.blockers.length > 0 || a.risks.length > 0) && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {a.blockers.length > 0 && (
            <div className="border border-destructive/40 bg-destructive/5 p-3" data-testid="list-blockers">
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-destructive"><AlertOctagon className="h-4 w-4" /> Blockers</p>
              <ul className="list-disc pl-5 text-sm">{a.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
          )}
          {a.risks.length > 0 && (
            <div className="border border-border p-3" data-testid="list-risks">
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><ShieldAlert className="h-4 w-4" /> Risks</p>
              <ul className="list-disc pl-5 text-sm">{a.risks.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {full && (
        <>
          <details className="mt-4" data-testid="details-comps">
            <summary className="cursor-pointer text-sm font-semibold">Comp decisions ({a.compDecisions.length})</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {a.compDecisions.map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline gap-2 border-b border-border py-1">
                  <span className={`tag ${d.included ? 'tone-go' : 'tone-stop'}`}>{d.included ? 'Used' : 'Excluded'}</span>
                  <span>{label(d.id)}</span>
                  {d.reasons.length > 0 && <span className="text-xs text-muted-foreground">{d.reasons.join('; ')}</span>}
                </li>
              ))}
            </ul>
          </details>
          <details className="mt-3" data-testid="details-assumptions">
            <summary className="cursor-pointer text-sm font-semibold">Assumptions and formula used</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap bg-muted p-3 font-mono text-xs" data-testid="text-formula">{a.formula}</pre>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-3">
              {Object.entries(a.assumptions).filter(([,val]) => val === null || typeof val !== 'object').map(([k, val]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-border/60"><dt className="text-muted-foreground">{k}</dt><dd>{String(val)}</dd></div>
              ))}
              <div className="flex justify-between gap-2 border-b border-border/60"><dt className="text-muted-foreground">repair rate cards</dt><dd>{a.assumptions.repairRates.length}</dd></div>
            </dl>
          </details>
        </>
      )}
    </div>
  );
}
