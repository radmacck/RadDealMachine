import { AlertOctagon, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { Analysis, Comp, Intelligence, Range } from '@workspace/api-client-react';
import { analyzeDealScenarios } from '@workspace/deal-domain';
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

export function AnalysisPanel({ analysis, comps, intelligence = [], full = true }: { analysis: Analysis | null; comps?: Comp[]; intelligence?: Intelligence[]; full?: boolean }) {
  const [uncertaintyPct, setUncertaintyPct] = useState(20);
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
  const evidenceFor = (id?: string) => id ? intelligence.find((item) => item.id === id) : undefined;
  const evidenceClass = (classification?: string) =>
    classification === 'VERIFIED_FACTS' || classification === 'OBSERVED' ? 'OBSERVED'
      : classification === 'INDICATED' ? 'REPORTED'
        : classification === 'AI_HYPOTHESIS' ? 'INFERRED' : 'ESTIMATED';
  const eligibleComps = (comps ?? []).filter((comp) => a.compDecisions.find((decision) => decision.id === comp.id)?.included);
  const policy = a.assumptions;
  const scenarios = analyzeDealScenarios(a,uncertaintyPct);
  const totalCarryingClosingCosts = policy.acquisitionCost + policy.holdingMonthly * policy.holdingMonths;
  const buyerCeilingBeforeAssignment = a.arv.low * policy.arvMultiplier -
    a.arv.low * policy.sellingCostPct - a.repairs.high * (1 + policy.contingencyPct) - totalCarryingClosingCosts;
  const buyerMarginReserve = a.arv.low * (1 - policy.arvMultiplier);
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
      {full && <section className="mt-4 border border-border p-3" data-testid="underwriting-evidence-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">Evidence-backed calculation</p>
          <p className="text-xs text-muted-foreground">Calculated {fmtDate(a.calculatedAt)} · values are deterministic; offer authority is separate.</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Evidence classes: OBSERVED = source-verified record; REPORTED = unverified statement; INFERRED = rule-derived; ESTIMATED = formula/range or configured assumption.</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>
            <p className="eyebrow mb-1">ARV comps · OBSERVED/REPORTED</p>
            {eligibleComps.length ? <ul className="space-y-1 text-xs">
              {eligibleComps.map((comp) => {
                const sourceEvidence = evidenceFor(comp.saleEvidenceId);
                return <li key={comp.id} className="border-t border-border/60 pt-1">
                  <div className="flex flex-wrap justify-between gap-2"><span>{comp.address} · ${money(comp.salePrice)} · sold {comp.soldAt}</span><span>{comp.verified ? 'OBSERVED' : 'REPORTED'}</span></div>
                  <div className="text-muted-foreground">{sourceEvidence?.source ?? comp.source} · captured {sourceEvidence?.capturedAt ? fmtDate(sourceEvidence.capturedAt) : 'capture time not recorded'} · confidence {sourceEvidence ? pct(sourceEvidence.confidence) : 'not recorded'} · evidence {comp.saleEvidenceId ?? 'unlinked'}</div>
                </li>;
              })}
            </ul> : <p className="text-xs text-destructive">No eligible comps; ARV-dependent offer calculations are blocked.</p>}
            <p className="mt-2 text-xs text-muted-foreground">Selected comp set produces the displayed low / median / high ARV. Excluded comps and reasons are listed below.</p>
          </div>
          <div>
            <p className="eyebrow mb-1">Repair evidence · ESTIMATED from sourced scope</p>
            {a.repairEstimate.lines.length ? <ul className="space-y-1 text-xs">
              {a.repairEstimate.lines.map((line, index) => {
                const sourceEvidence = evidenceFor(line.evidenceId);
                return <li key={`${line.evidenceId}-${index}`} className="border-t border-border/60 pt-1">
                  <div className="flex flex-wrap justify-between gap-2"><span>{line.category} · {line.quantity} {line.unit}</span><span>{money(line.low)} / {money(line.expected)} / {money(line.high)}</span></div>
                  <div className="text-muted-foreground">{sourceEvidence?.source ?? line.source} · {evidenceClass(sourceEvidence?.classification)} · captured {sourceEvidence?.capturedAt ? fmtDate(sourceEvidence.capturedAt) : fmtDate(a.calculatedAt)} · confidence {sourceEvidence ? pct(sourceEvidence.confidence) : 'rate-card confidence shown above'} · evidence {line.evidenceId}</div>
                </li>;
              })}
            </ul> : <p className="text-xs text-muted-foreground">No sourced repair estimate lines are available.</p>}
          </div>
        </div>
        <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="underwriting-economics-breakdown">
          <div><p className="eyebrow">Carrying + closing costs</p><p className="font-mono">{money(totalCarryingClosingCosts)}</p><p className="text-xs text-muted-foreground">ESTIMATED · configured assumptions: acquisition {money(policy.acquisitionCost)} + holding {money(policy.holdingMonthly)} × {policy.holdingMonths} months · confidence not empirical · as of {fmtDate(a.calculatedAt)}</p></div>
          <div><p className="eyebrow">Buyer margin reserve</p><p className="font-mono">{money(buyerMarginReserve)}</p><p className="text-xs text-muted-foreground">INFERRED · source: configured buyer discount assumption · low ARV × (1 − {pct(policy.arvMultiplier)}) · confidence: policy-derived, not empirical · as of {fmtDate(a.calculatedAt)}</p></div>
          <div><p className="eyebrow">Buyer ceiling before assignment</p><p className="font-mono">{money(buyerCeilingBeforeAssignment)}</p><p className="text-xs text-muted-foreground">ESTIMATED · source: comp, repair, and workspace-cost inputs · confidence: ARV {pct(a.arv.confidence)} / repairs {pct(a.repairs.confidence)} · as of {fmtDate(a.calculatedAt)}</p></div>
          <div><p className="eyebrow">Assignment target · not realized fee</p><p className="font-mono">{money(policy.assignmentTarget)}</p><p className="text-xs text-muted-foreground">ESTIMATED · source: configured workspace assumption · confidence: policy-derived, not empirical · not buyer demand or a commitment · as of {fmtDate(a.calculatedAt)}</p></div>
          <div><p className="eyebrow">Calculated MAO</p><p className="font-mono">{estimateBlocked || a.blockers.length ? 'BLOCKED' : money(a.mao)}</p><p className="text-xs text-muted-foreground">INFERRED · source: deterministic buyer-ceiling formula less assignment target · confidence: ARV {pct(a.arv.confidence)} / repairs {pct(a.repairs.confidence)} · as of {fmtDate(a.calculatedAt)}; blocked by any current underwriting blocker.</p></div>
          <div><p className="eyebrow">Offer authority</p><p className="font-mono">Not authorized by underwriting</p><p className="text-xs text-muted-foreground">Only explicit, terms-specific owner approval can authorize an offer.</p></div>
        </div>
      </section>}
      {full && <section className="mt-4 border border-border p-3" data-testid="deal-scenario-analysis">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Deal economics · low / base / high scenarios</p>
            <p className="text-xs text-muted-foreground">Deterministic what-if math only. Nothing here changes underwriting, creates a snapshot, or authorizes an offer.</p>
          </div>
          <label className="text-xs">Cost and assignment sensitivity ±{uncertaintyPct}%
            <input aria-label="Scenario sensitivity percent" className="ml-2 w-28 accent-primary" type="range" min="0" max="100" step="5" value={uncertaintyPct} onChange={event=>setUncertaintyPct(Number(event.target.value))} />
          </label>
        </div>
        <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <p>ARV · SOURCED from eligible comp range: {money(a.arv.low)} / {money(a.arv.expected)} / {money(a.arv.high)}; {pct(a.arv.confidence)} confidence.</p>
          <p>Repairs · ESTIMATED from reviewed range: {money(a.repairs.low)} / {money(a.repairs.expected)} / {money(a.repairs.high)}; {pct(a.repairs.confidence)} confidence. Per-line sources retain OBSERVED/REPORTED status.</p>
          <p>Holding + closing · ESTIMATED configured base {money(policy.acquisitionCost + policy.holdingMonthly * policy.holdingMonths)}; scenario envelope is operator-selected, not observed.</p>
          <p>Buyer margin reserve · INFERRED from configured multiplier {pct(1-policy.arvMultiplier)}. Assignment fee · ESTIMATED configured target {money(policy.assignmentTarget)} with the same sensitivity envelope. Seller/agent-reported inputs stay REPORTED, never verified by this calculation.</p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">LOW uses low ARV, high repairs, high costs and high assignment fee; HIGH reverses those inputs. The sensitivity control changes only the illustrative cost/assignment envelope.</p>
        {!scenarios.calculationAvailable && <p className="mt-2 text-sm text-destructive">MAO scenarios are blocked; missing or incomplete inputs are not treated as zero-cost facts.</p>}
        {scenarios.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">{scenarios.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead><tr className="border-b"><th className="p-2">Scenario</th><th className="p-2">ARV</th><th className="p-2">Repairs</th><th className="p-2">Buyer margin</th><th className="p-2">Holding + closing</th><th className="p-2">Assignment fee</th><th className="p-2">MAO</th></tr></thead>
            <tbody>{scenarios.scenarios.map(item=><tr key={item.name} className="border-b border-border/60">
              <th className="p-2">{item.name}</th><td className="p-2 font-mono">{scenarios.arvAvailable?money(item.arv):"MISSING"}</td><td className="p-2 font-mono">{scenarios.repairsAvailable?money(item.repairs):"MISSING"}</td><td className="p-2 font-mono">{money(item.buyerMarginReserve)}</td><td className="p-2 font-mono">{money(item.holdingAndClosingCosts)}</td><td className="p-2 font-mono">{money(item.assignmentFee)}</td><td className="p-2 font-mono font-semibold">{scenarios.calculationAvailable?money(item.mao):"BLOCKED"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-sm font-semibold">One-input-at-a-time MAO sensitivity</p>
        <div className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
          {scenarios.sensitivities.map(item=><p key={item.input} className="border-t border-border/60 py-1"><b>{item.input}:</b> {scenarios.calculationAvailable?`${money(item.lowMao)} / ${money(item.baseMao)} / ${money(item.highMao)}`:"BLOCKED"} · {item.source}</p>)}
        </div>
      </section>}
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
      {(a.preliminaryRepairEstimate.hypotheses.length > 0 || a.preliminaryRepairEstimate.sourceWarnings.length > 0) && (
        <section className="mt-4 border border-amber-500/40 bg-amber-500/5 p-3" data-testid="preliminary-condition-estimate">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">Condition clues · AI HYPOTHESIS only</p>
            <p className="font-mono text-xs text-muted-foreground">
              {a.preliminaryRepairEstimate.marketKey} · rate catalog v{a.preliminaryRepairEstimate.catalogVersion}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Deterministic phrase rules read current, linked listing/public remarks. The scenarios are uncalibrated, not inspected scope, and never feed repair totals, MAO, an offer, or authorization.
          </p>
          {a.preliminaryRepairEstimate.status === 'CALCULATED' && a.preliminaryRepairEstimate.total && (
            <p className="mt-2 font-mono text-sm" data-testid="text-preliminary-repair-total">
              Indicative category-rate scenario: {money(a.preliminaryRepairEstimate.total.low)} / {money(a.preliminaryRepairEstimate.total.expected)} / {money(a.preliminaryRepairEstimate.total.high)}
            </p>
          )}
          {a.preliminaryRepairEstimate.status === 'BLOCKED' && (
            <p className="mt-2 text-sm text-destructive">
              No complete preliminary total: missing rate cards are not replaced with assumed costs. Inspection scope remains required for underwriting.
            </p>
          )}
          {a.preliminaryRepairEstimate.hypotheses.length > 0 && (
            <ul className="mt-2 space-y-2">
              {a.preliminaryRepairEstimate.hypotheses.map((item) => {
                const estimate = a.preliminaryRepairEstimate.lines.find((line) => line.hypothesisIds.includes(item.id));
                return (
                  <li key={item.id} className="border-t border-border/60 pt-2 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{item.category} · {item.severity} · AI HYPOTHESIS</span>
                      {estimate && <span className="font-mono text-xs">{money(estimate.low)} / {money(estimate.expected)} / {money(estimate.high)} · lump-sum rate scenario</span>}
                    </div>
                    <p className="mt-1">{item.statement}</p>
                    <p className="text-xs text-muted-foreground">
                      Source status {item.evidenceClassification} · source confidence {pct(item.sourceConfidence)} · rule score {pct(item.confidence)} (uncalibrated)
                    </p>
                    <p className="text-xs"><span className="font-semibold">Ask:</span> {item.question} <span className="font-semibold">Next:</span> {item.action}</p>
                    {item.sourceUrl ? <a className="text-xs underline underline-offset-2" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.source}</a> : <span className="text-xs">{item.source}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {a.preliminaryRepairEstimate.blockers.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-destructive">
              {a.preliminaryRepairEstimate.blockers.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          )}
          {a.preliminaryRepairEstimate.sourceWarnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
              {a.preliminaryRepairEstimate.sourceWarnings.map((item, index) => <li key={index}>{item}</li>)}
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
