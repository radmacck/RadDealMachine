import { useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowRight, Building2, CalendarClock, CircleDollarSign, Compass, HandCoins,
  Headphones, House, Leaf, MapPin, Plus, RefreshCw, ShieldCheck, UsersRound,
  WalletCards, Zap,
} from 'lucide-react';
import { getGetCommandCenterQueryKey, useGetCommandCenter, type CommandAction } from '@workspace/api-client-react';
import { isQualified } from '@/components/buyer-status';
import { StageBadge } from '@/components/stage-badge';
import { useWorkspaceSearch } from '@/components/workspace-search';
import { commandCenterCallDisplay } from '@/lib/command-center-display';
import { AcquisitionQueueCard } from '@/components/acquisition-queue-card';
import { OutcomeLearningPanel } from '@/components/outcome-learning-panel';
import { ago, fmtDate, isOverdue, money } from '@/lib/format';

const LABEL: Record<CommandAction['category'], string> = {
  RESEARCH: 'Research', CALL: 'Call', FOLLOW_UP: 'Follow up', OFFER_APPROVAL: 'Owner approval', NEGOTIATION: 'Negotiate',
  CONTRACT: 'Contract', BUYER_MATCH: 'Buyer match', BUYER_VERIFICATION: 'Verify buyer', DEADLINE: 'Deadline', CLOSING: 'Closing', WORKER: 'Worker',
  DISCOVERY_REVIEW: 'Qualify property',
};
const TONE: Record<CommandAction['category'], string> = {
  RESEARCH: 'tone-muted', CALL: 'tone-signal', FOLLOW_UP: 'tone-warn', OFFER_APPROVAL: 'tone-ink', NEGOTIATION: 'tone-go',
  CONTRACT: 'tone-ink', BUYER_MATCH: 'tone-go', BUYER_VERIFICATION: 'tone-warn', DEADLINE: 'tone-stop', CLOSING: 'tone-signal', WORKER: 'tone-muted',
  DISCOVERY_REVIEW: 'tone-warn',
};
const AUTOMATION_STATE_LABEL: Record<string, string> = {
  ACTIVE: 'On schedule',
  ENABLED: 'Authorized · first run pending',
  RUNNING: 'Running',
  QUEUED: 'Queued',
  ACTION_REQUIRED: 'Needs attention',
  AWAITING_AUTHORIZATION: 'Source terms needed',
  ONE_TIME_ONLY: 'One-time only',
  OVERDUE: 'Overdue',
  WAITING_FOR_FIRST_RUN: 'No run recorded',
  EVENT_DRIVEN: 'Evidence-triggered',
  HUMAN_GATE: 'Human-authorized',
};
const AUTOMATION_STATE_TONE: Record<string, string> = {
  ACTION_REQUIRED: 'fd-pill-coral',
  AWAITING_AUTHORIZATION: 'fd-pill-coral',
  ONE_TIME_ONLY: 'fd-pill-coral',
  OVERDUE: 'fd-pill-coral',
  WAITING_FOR_FIRST_RUN: 'fd-pill-coral',
};

export default function Dashboard() {
  const q = useGetCommandCenter({ query: { queryKey: getGetCommandCenterQueryKey(), refetchInterval: 15000 } });
  const [showAllActions, setShowAllActions] = useState(false);
  const { open: searchOpen, query: searchQuery, setQuery: setSearchQuery } = useWorkspaceSearch();
  const d = q.data;
  const query = searchQuery.trim().toLowerCase();
  const matchesSearch = (...values: (string | number | null | undefined)[]) =>
    !query || values.some((value) => String(value ?? '').toLowerCase().includes(query));
  const actions = d ? [...d.actions].filter((item) => matchesSearch(item.title, item.reason, LABEL[item.category])).sort((a, b) => b.priority - a.priority) : [];
  const primaryAction = actions[0];
  const secondaryActions = showAllActions ? actions.slice(1) : actions.slice(1, 3);
  const contracts = d ? d.operations.filter((o) => o.contract) : [];
  const deadlines = contracts.filter((o) => o.contract!.status !== 'CLOSED' && o.contract!.status !== 'CANCELLED').sort((a, b) => a.contract!.closingAt.localeCompare(b.contract!.closingAt));
  const qualified = d ? d.buyers.filter((b) => isQualified(b) && (b.destinationKind ?? 'BUYER') === 'BUYER') : [];
  const leadAddressById = new Map<string, string>();
  if (d) {
    d.calls.forEach((item) => leadAddressById.set(item.lead.id, item.lead.address));
    d.deals.forEach((item) => leadAddressById.set(item.lead.id, item.lead.address));
    d.opportunities.forEach((item) => leadAddressById.set(item.lead.id, item.lead.address));
  }
  const calls = d ? d.calls.filter((item) => matchesSearch(item.lead.sellerName, item.lead.address, item.objective)) : [];
  const acquisitionItems = d ? d.acquisitionQueue.filter((item) => matchesSearch(item.lead.address, item.lead.sellerName, item.blocker, item.nextAction)) : [];
  const deals = d ? d.deals.filter((item) => matchesSearch(item.lead.address, item.lead.nextAction, item.lead.stage)) : [];
  const contractRows = contracts.filter((operation) => matchesSearch(
    leadAddressById.get(operation.leadId), operation.contract?.status, operation.contract?.purchasePrice, operation.nextAction,
  ));
  const deadlineRows = deadlines.filter((operation) => matchesSearch(
    leadAddressById.get(operation.leadId), operation.contract?.closingAt, operation.contract?.closingAt ? fmtDate(operation.contract.closingAt) : '',
  ));
  const buyerRows = d ? d.buyers.filter((buyer) => matchesSearch(
    buyer.name, buyer.criteria?.states.join(' '), buyer.criteria?.maxPurchasePrice, buyer.verificationStatus,
  )) : [];
  const jobRows = d ? d.jobs.filter((job) => matchesSearch(job.message, job.kind, job.state)) : [];
  const opportunityRows = d ? d.opportunities.filter((item) => matchesSearch(
    item.lead.address, item.lead.stage, item.analysis?.classification, item.analysis?.blockers.join(' '),
  )) : [];
  const candidateRows = d ? d.propertyDiscoveries.records.filter((item) =>
    ['RELEVANT_CANDIDATE', 'QUALIFIED_LEAD'].includes(item.status) && matchesSearch(
    item.property.address, item.property.recordedOwner, item.reason, item.rankingReasons.join(' '), item.nextAction,
  )) : [];
  const qualifiedRows = buyerRows.filter((buyer) => isQualified(buyer) && (buyer.destinationKind ?? 'BUYER') === 'BUYER');
  const callDisplay = commandCenterCallDisplay(primaryAction, calls);
  const primaryCall = callDisplay.primaryCall;
  const additionalCalls = callDisplay.additionalCalls;
  const nextCall = additionalCalls[0];
  const now = new Date();
  const activeOpportunityCount = d ? d.deals.filter((item) => !['CLOSED', 'DEAD_DEAL'].includes(item.lead.stage)).length : 0;
  const closingThisMonth = deadlines.filter((operation) => {
    const date = new Date(operation.contract!.closingAt);
    return !Number.isNaN(date.getTime()) && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;

  return (
    <>
      <header className="fd-page-head">
        <div>
          <div className="fd-eyebrow"><span className="fd-eyebrow-mark" />{now.toLocaleDateString('en-US', { weekday: 'long' })} field notes · {d ? `live / updated ${ago(d.generatedAt)}` : 'live'}</div>
          <h1 className="fd-title">Command center</h1>
          <p className="fd-subtitle">Seller acquisition, buyer demand, and the deal that connects them. Start with the next action; the system keeps the workstreams distinct.</p>
        </div>
        <div className="fd-head-buttons">
          <button className="fd-button" type="button" onClick={() => void q.refetch()} disabled={q.isFetching} aria-busy={q.isFetching}>
            <RefreshCw size={14} className={q.isFetching ? 'animate-spin' : ''} />{q.isFetching ? 'Refreshing' : 'Refresh desk'}
          </button>
          <Link className="fd-button" href="/leads" data-testid="link-add-lead"><Plus size={15} />Manual seller intake</Link>
        </div>
      </header>
      {searchOpen && (
        <div className="fd-search-wrap">
          <label htmlFor="fd-search" className="fd-search-label">Search your workspace</label>
          <input id="fd-search" className="fd-search-input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} autoFocus placeholder="Try an address, seller, or task…" />
        </div>
      )}
      {q.isError && <div className="fd-empty" role="alert">The workspace data could not be refreshed. Existing information may be out of date. <button className="fd-text-link" type="button" onClick={() => void q.refetch()}>Try again</button></div>}
      {q.isLoading && !d && <div className="fd-empty" role="status">Loading workspace activity…</div>}
      {d && (
        <>
          <section className="fd-metrics" aria-label="Operating state">
            <div className="fd-metric"><span className="fd-metric-icon"><Building2 size={17} /></span><span><div className="fd-metric-value">{activeOpportunityCount}</div><div className="fd-metric-label">Active seller leads</div></span></div>
            <div className="fd-metric"><span className="fd-metric-icon"><Compass size={17} /></span><span><div className="fd-metric-value">{d.propertyDiscoveries.counts.RELEVANT_CANDIDATE}</div><div className="fd-metric-label">Candidates to review</div></span></div>
            <div className="fd-metric"><span className="fd-metric-icon"><Headphones size={17} /></span><span><div className="fd-metric-value">{d.calls.length}</div><div className="fd-metric-label">Sellers cleared to call</div></span></div>
            <div className="fd-metric" data-testid="metric-current-buyers"><span className="fd-metric-icon"><UsersRound size={17} /></span><span><div className="fd-metric-value">{qualified.length}</div><div className="fd-metric-label">{qualified.length ? 'Current approved buyers' : 'No current approved buyers'}</div></span></div>
          </section>

          <section className="fd-actions-section" aria-label="Acquisition decision queue" data-testid="panel-acquisition-queue">
            <div className="fd-section-head">
              <div className="fd-section-title"><Headphones size={16} />Acquisition next action
                <small>{acquisitionItems.length ? `Showing top ${Math.min(acquisitionItems.length, 2)} of ${acquisitionItems.length}` : 'no qualified active seller opportunity'}</small>
              </div>
            </div>
            {acquisitionItems.length
              ? <div className="grid gap-3 lg:grid-cols-2">{acquisitionItems.slice(0, 2).map(item =>
                <AcquisitionQueueCard key={item.lead.id} item={item} compact />)}</div>
              : <div className="fd-empty" role="status">
                No qualified active seller lead is in the acquisition queue. Review relevant source candidates; discoveries are not leads until qualified.
                {d.propertyDiscoveries.counts.RELEVANT_CANDIDATE > 0 && <Link className="ml-2 underline" href="/sources">Review candidates</Link>}
              </div>}
          </section>

          <section className="fd-actions-section" data-testid="panel-actions">
            <div className="fd-section-head">
              <div className="fd-section-title"><Compass size={16} />Your next action <small>{actions.length ? `1 of ${actions.length}` : 'no open human action'}</small></div>
            </div>
            {actions.length === 0 ? (
              <div className="fd-start-empty" role="status">
                {query ? (
                  <>
                    <div><b>No open action matches this search.</b><p>Clear the search to return to the system-selected priority.</p></div>
                    <button className="fd-button" type="button" onClick={() => setSearchQuery('')}>Clear search</button>
                  </>
                ) : (
                  <>
                    <div>
                      <b>No human action is currently due.</b>
                      <p>Background checks continue only within recorded source permissions. See the automation panel for the latest persisted runs, authorization gates, queue, and failures.</p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="fd-start-stack">
                {primaryAction && (
                  <article className="fd-start-card" data-category={primaryAction.category} data-testid="primary-command-action">
                    <div className="fd-start-card-head">
                      <div>
                        <div className="fd-start-kicker">Highest-priority persisted action · system-selected first</div>
                        <span className={`fd-action-tag ${TONE[primaryAction.category]}`}>{LABEL[primaryAction.category]}</span>
                        <h2>{primaryAction.title}</h2>
                      </div>
                      {primaryAction.dueAt && (
                        <div className="fd-start-due"><span>Due</span><b>{fmtDate(primaryAction.dueAt)}</b><small>{ago(primaryAction.dueAt)}</small></div>
                      )}
                    </div>
                    {(() => {
                      const guidance = primaryAction.workGuidance;
                      const decision = primaryAction.leadId
                        ? d.decisions.find((item) => item.leadId === primaryAction.leadId)
                        : d.decisions.find((item) => item.subjectType === "DISCOVERY"
                          && primaryAction.id.startsWith(`DECISION:DISCOVERY:${item.subjectId}:`));
                      return (
                        <div className="fd-start-guidance">
                          <div className="fd-start-state">
                            <div><span className="fd-start-label">Where we are</span><p>{guidance?.currentState ?? 'This action has no workflow state attached; confirm the linked record before proceeding.'}</p></div>
                            <div><span className="fd-start-label">Responsible</span><p>{guidance?.responsibleRole ?? 'Review required'}</p></div>
                          </div>
                          <div className="fd-start-facts">
                            <div><span className="fd-start-label">What is known</span><p>{guidance?.knownFacts.length ? guidance.knownFacts.join(' · ') : guidance ? 'No supporting facts are attached.' : 'No supporting facts are attached to this action.'}</p></div>
                            <div className="fd-start-missing"><span className="fd-start-label">What is missing or blocked</span><p>{guidance?.missingFacts.length ? guidance.missingFacts.join(' · ') : guidance ? 'No additional blocker is reported.' : 'Step-by-step guidance is missing; verify the linked record before taking action.'}</p></div>
                          </div>
                          <div className="fd-start-steps">
                            <div><span className="fd-start-label">Why it matters</span><p>{guidance?.why ?? primaryAction.reason}</p></div>
                            <div><span className="fd-start-label">What can happen now</span><p>{guidance?.systemCanDo ?? 'The system has prioritized and linked this action; no further system operation is implied.'}</p></div>
                            <div><span className="fd-start-label">What you must do</span><p>{guidance?.humanMustDo ?? 'Open the linked workflow and confirm its persisted state before making a decision.'}</p></div>
                            <div><span className="fd-start-label">What happens next</span><p>{guidance?.completionRecord ?? 'The next state is not asserted until the linked workflow records its result.'}</p></div>
                          </div>
                          {guidance?.requiredEvidence.length ? (
                            <details className="fd-work-guidance-detail">
                              <summary>Evidence required to complete this action</summary>
                              <p>{guidance.requiredEvidence.join(' · ')}</p>
                            </details>
                          ) : null}
                          {decision && (
                            <details className="fd-work-guidance-detail" data-testid={`decision-trace-${decision.subjectId}`}>
                              <summary>Why / next · {decision.ruleVersion} · {decision.recommendedAction?.status ?? 'terminal'}</summary>
                              <p><b>Selected action:</b> {decision.recommendedAction?.reason ?? decision.outcomeRecord ?? 'No further action is eligible.'}</p>
                              <p><b>Human authorization:</b> {decision.humanAuthorizationRequired ? 'Required before the protected action.' : 'Not required for this research/review step.'}</p>
                              {decision.conflicts.length > 0 && <p><b>Conflicts:</b> {decision.conflicts.map((item) => `${item.epistemicStatus} · ${item.summary}`).join(' · ')}</p>}
                              {decision.staleEvidence.length > 0 && <p><b>Stale evidence:</b> {decision.staleEvidence.map((item) => item.summary).join(' · ')}</p>}
                              <p><b>Eligible work:</b> {decision.eligibleActions.map((item) => `${item.status} · ${item.title}`).join(' · ') || 'None'}</p>
                              {decision.blockedActions.length > 0 && <p><b>Blocked work:</b> {decision.blockedActions.map((item) => `${item.status} · ${item.title}: ${item.reason}`).join(' · ')}</p>}
                              <p><b>Evidence references:</b> {decision.evidenceRefs.join(' · ') || 'None recorded'}</p>
                            </details>
                          )}
                          {primaryCall && (
                            <section className="fd-primary-call-context" data-testid="primary-call-context">
                              <div className="fd-section-title"><Headphones size={14} />Selected seller call brief</div>
                              <div className="fd-start-facts">
                                <div><span className="fd-start-label">Seller and contact</span><p>{primaryCall.lead.sellerName} · {primaryCall.lead.address} · {primaryCall.lead.sellerPhone || 'No phone route recorded'}</p></div>
                                <div><span className="fd-start-label">Seller situation</span><p>{primaryCall.lead.sellingReason?.trim() || primaryCall.lead.sellerDescription?.trim() || 'Not recorded. Ask what outcome, timing, condition, and decision-makers matter to the seller.'}</p></div>
                              </div>
                              <div className="fd-metrics" aria-label="Current deal economics">
                                <div className="fd-metric"><span><div className="fd-metric-value">{money(primaryCall.analysis.arv.expected)}</div><div className="fd-metric-label">ARV · expected</div></span></div>
                                <div className="fd-metric"><span><div className="fd-metric-value">{primaryCall.analysis.repairEstimate.total ? `${money(primaryCall.analysis.repairEstimate.total.low)}–${money(primaryCall.analysis.repairEstimate.total.high)}` : 'Needs condition evidence'}</div><div className="fd-metric-label">Repairs · condition-backed</div></span></div>
                                <div className="fd-metric"><span><div className="fd-metric-value">{money(primaryCall.analysis.mao)}</div><div className="fd-metric-label">Calculated MAO · not authority</div></span></div>
                                <div className="fd-metric"><span><div className="fd-metric-value">{primaryCall.authorizedOffer ? money(primaryCall.authorizedOffer.amount) : 'Not authorized'}</div><div className="fd-metric-label">Exact seller offer authority</div></span></div>
                              </div>
                              <div className="fd-start-facts">
                                <div><span className="fd-start-label">Current evidence</span><p>{primaryCall.intelligence.length
                                  ? primaryCall.intelligence.slice(0, 3).map((item) => `${item.classification} · ${item.statement} (${item.source})`).join(' · ')
                                  : 'No supplemental intelligence is recorded; ask directly and do not assume seller motivation or property condition.'}</p></div>
                                <div className="fd-start-missing"><span className="fd-start-label">Questions to resolve</span><p>{primaryCall.questions.slice(0, 3).join(' · ') || 'No saved questions. Confirm seller goals, timing, condition, authority, and decision-makers.'}</p></div>
                              </div>
                              <details className="fd-work-guidance-detail">
                                <summary>Offer boundary and evidence limitations</summary>
                                <p>{primaryCall.boundaries}</p>
                                {primaryCall.analysis.blockers.length > 0 && <p>Underwriting blockers: {primaryCall.analysis.blockers.join(' · ')}</p>}
                                {primaryCall.analysis.repairEstimate.blockers.length > 0 && <p>Repair estimate blockers: {primaryCall.analysis.repairEstimate.blockers.join(' · ')}</p>}
                                {primaryCall.analysis.risks.length > 0 && <p>Risks: {primaryCall.analysis.risks.join(' · ')}</p>}
                              </details>
                            </section>
                          )}
                          <Link href={primaryAction.href} className="fd-start-cta" aria-label={`${primaryAction.cta}: ${primaryAction.title}`}>
                            {primaryAction.cta}<ArrowRight size={15} />
                          </Link>
                        </div>
                      );
                    })()}
                  </article>
                )}
                {secondaryActions.length > 0 && (
                  <div className="fd-next-up">
                    <div className="fd-section-head">
                      <div className="fd-section-title">Also queued <small>{actions.length - 1} more action(s) · ordered by priority</small></div>
                    </div>
                    <div className="fd-action-list">
                      {secondaryActions.map((action) => (
                        <article key={action.id} className="fd-action" data-category={action.category} data-testid={`action-${action.id}`}>
                          <span className="fd-action-stripe" />
                          <span className={`fd-action-tag ${TONE[action.category]}`}>{LABEL[action.category]}</span>
                          <div>
                            <div className="fd-action-title">{action.title}</div>
                            <div className="fd-action-reason">{action.reason}</div>
                          </div>
                          {action.dueAt && <span className="fd-due">{action.workGuidance?.dueLabel ?? 'Due'} · {ago(action.dueAt)}</span>}
                          <Link href={action.href} className="fd-action-link" aria-label={`${action.cta}: ${action.title}`}>
                            {action.cta}<ArrowRight size={13} />
                          </Link>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {actions.length > 3 && <div className="fd-action-more">
              <button className="fd-text-link" type="button" onClick={() => setShowAllActions((current) => !current)}>{showAllActions ? 'Show fewer actions' : `View all ${actions.length} actions`} <ArrowRight size={12} style={{ verticalAlign: 'middle', marginLeft: 3 }} /></button>
            </div>}
          </section>

          <section className="fd-panel" data-testid="panel-call-next" aria-labelledby="call-next-title">
            <div className="fd-section-head">
              <div className="fd-section-title"><Headphones size={15} /><span id="call-next-title">{primaryAction ? 'Other call-ready sellers' : 'CALL NEXT'}</span><small>{additionalCalls.length ? `${additionalCalls.length} queued` : 'no additional seller calls'}</small></div>
              <Link className="fd-text-link" href="/calls">Open call queue <ArrowRight size={12} style={{ verticalAlign: 'middle', marginLeft: 3 }} /></Link>
            </div>
            {!nextCall ? (
              <div className="fd-empty" role="status">
                {primaryCall
                  ? 'The selected seller call is the highest-priority action above; there are no other call-ready sellers ahead of it.'
                  : calls.length
                    ? 'The call-ready seller already belongs to the action above. Complete that action first; the call remains available in the queue.'
                    : 'No seller currently passes the call-readiness checks. Incomplete contact permission, identity, evidence, or underwriting stays out of the call queue; the selected action above shows what must happen next.'}
              </div>
            ) : (
              <div className="fd-start-stack">
                <article className="fd-start-card" data-testid={`call-next-${nextCall.lead.id}`}>
                  <div className="fd-start-card-head">
                    <div>
                      <div className="fd-start-kicker">{primaryAction ? 'Queued after the selected action above · ranked by due follow-up, urgency, and deal strength' : 'Highest-priority ready seller · ranked by due follow-up, urgency, and deal strength'}</div>
                      <span className="fd-action-tag tone-signal">{nextCall.lead.stage.replaceAll('_', ' ')}</span>
                      <h2>{nextCall.lead.sellerName} · {nextCall.lead.address}</h2>
                      <p className="fd-row-meta">{nextCall.lead.city}, {nextCall.lead.state} · {nextCall.lead.sellerPhone || 'No phone route recorded'}</p>
                    </div>
                    <Link href={`/calls?lead=${nextCall.lead.id}`} className="fd-start-cta" data-testid={`call-next-cta-${nextCall.lead.id}`}>
                      Open seller call brief<ArrowRight size={15} />
                    </Link>
                  </div>
                  <div className="fd-start-facts">
                    <div><span className="fd-start-label">Seller situation</span><p>{nextCall.lead.sellingReason?.trim() || nextCall.lead.sellerDescription?.trim() || 'Not recorded. Ask what outcome, timing, condition, and decision-makers matter to the seller.'}</p></div>
                    <div><span className="fd-start-label">Best next action</span><p>{nextCall.lead.nextAction}</p></div>
                  </div>
                </article>
              </div>
            )}
          </section>

          <section className="fd-panel" data-testid="panel-automation">
            <div className="fd-section-head">
              <div className="fd-section-title"><Zap size={15} />Background system <small>Observed {ago(d.automation.observedAt)}</small></div>
              <span className={`fd-pill ${d.automation.status === 'CURRENT' ? '' : 'fd-pill-coral'}`}>
                {d.automation.status === 'CURRENT' ? 'Checks current' : d.automation.status === 'DELAYED' ? 'Checks delayed' : d.automation.status === 'ACTION_REQUIRED' ? 'Worker attention needed' : 'Starting'}
              </span>
            </div>
            <p className="fd-row-copy">
              {d.automation.queuedJobs} queued · {d.automation.runningJobs} running · {d.automation.failedJobs} failed. This status comes from persisted worker jobs; it does not imply an external call, delivery, signature, or funds movement.
            </p>
            <div className="fd-list">
              {d.automation.lanes.map((lane) => (
                <div key={lane.key} className="fd-worker-row" data-testid={`automation-${lane.key}`}>
                  <span className={`fd-pill ${AUTOMATION_STATE_TONE[lane.state] ?? ''}`}>{AUTOMATION_STATE_LABEL[lane.state] ?? lane.state}</span>
                  <span className="fd-worker-label">
                    <b>{lane.label}</b>
                    <span className="fd-row-meta"> · {lane.cadence}{lane.lastRunAt ? ` · last ${ago(lane.lastRunAt)}` : ''}{lane.nextRunAt ? ` · next ${fmtDate(lane.nextRunAt)}` : ''}</span>
                    <details className="fd-work-guidance-detail">
                      <summary>Scope and latest result</summary>
                      <p>{lane.scope}</p>
                      <p>{lane.result}</p>
                    </details>
                  </span>
                  {lane.href && <Link href={lane.href} className="fd-text-link">{lane.state === 'ACTION_REQUIRED' || lane.state === 'OVERDUE' ? 'Review run' : lane.state === 'AWAITING_AUTHORIZATION' || lane.state === 'ONE_TIME_ONLY' ? 'Review source access' : 'Open'} <ArrowRight size={12} /></Link>}
                </div>
              ))}
            </div>
          </section>

          <OutcomeLearningPanel />

          <section className="fd-opps" data-testid="panel-qualified-candidates">
            <div className="fd-section-head">
              <div className="fd-section-title"><Compass size={15} />Highest-relevance properties <small>top {candidateRows.length} of {d.propertyDiscoveries.counts.RELEVANT_CANDIDATE + d.propertyDiscoveries.counts.QUALIFIED_LEAD}</small></div>
              <Link className="fd-text-link" href="/sources">Review qualification queue <ArrowRight size={12} style={{ verticalAlign: 'middle', marginLeft: 3 }} /></Link>
            </div>
            {candidateRows.length === 0 ? (
              <div className="fd-empty">{query ? 'No relevant opportunities match that search.' : `No relevant candidates or newly qualified leads are waiting. ${d.propertyDiscoveries.counts.DISCOVERED_PROPERTY} raw source discoveries remain separate from active leads.`}</div>
            ) : (
              <div className="fd-opp-grid">{candidateRows.slice(0, 3).map((item) => (
                <Link key={item.id} href={item.leadId ? `/leads/${item.leadId}` : `/sources?discovery=${item.id}`} className="fd-opp" data-testid={`link-candidate-${item.id}`}>
                  <div className="fd-row-top"><div className="fd-row-name">{item.property.address}</div><span className="fd-stage">{item.score}/100 seller relevance · buyer alignment +{item.demandFit.priorityBonus}</span></div>
                  <div className="fd-opp-info">{item.status.replaceAll('_', ' ')} · {item.signals.length} sourced signal(s) · {item.sourceObservationCount} observation(s)</div>
                  <div className="fd-row-copy"><b>Why ranked:</b> {item.rankingReasons.slice(1, 5).join(' ') || item.reason}</div>
                  <div className="fd-row-copy"><b>Buyer demand:</b> {item.demandFit.alignedBuyerCount
                    ? `${item.demandFit.alignedBuyerCount} currently approved buyer profile(s) align on known fields; this is not a deal match.`
                    : 'No currently approved buyer profile aligns to known fields. A strong seller opportunity can still qualify independently.'}</div>
                  <div className="fd-row-copy"><b>Best contact path:</b> {item.property.contactPaths[0]
                    ? item.property.contactPaths[0].channel === 'POSTAL'
                      ? `${[item.property.contactPaths[0].recipient, ...(item.property.contactPaths[0].addressLines ?? []), item.property.contactPaths[0].cityState, item.property.contactPaths[0].postalCode].filter(Boolean).join(' · ')} · postal route; permission ${item.property.contactPaths[0].permissionStatus.toLowerCase().replaceAll('_', ' ')}`
                      : `${item.property.contactPaths[0].channel}: ${item.property.contactPaths[0].routeValue ?? 'route not supplied'} · permission ${item.property.contactPaths[0].permissionStatus.toLowerCase().replaceAll('_', ' ')}`
                    : 'No owner mailing route in this record; this source has no phone or email.'}</div>
                  <div className="fd-row-copy"><b>Missing:</b> {item.promotionBlockers[0] ?? item.missingInformation[0] ?? 'No qualification blocker; human review remains required.'}</div>
                  <div className="fd-row-copy"><b>Next:</b> {item.nextAction}</div>
                </Link>
              ))}</div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Discovery volume is not deal quality. {d.propertyDiscoveries.counts.DISCOVERED_PROPERTY} raw properties are preserved outside the active lead queue.</p>
          </section>

          <details className="fd-secondary-work">
            <summary className="cursor-pointer rounded border px-4 py-3 text-sm font-semibold">Open seller, buyer, contract, and operations workstreams</summary>
          <div className="fd-grid">
            <section className="fd-panel" data-testid="panel-calls">
              <div className="fd-section-head"><div className="fd-section-title"><Headphones size={15} />Call-ready sellers <small>{query ? `${calls.length} / ${d.calls.length}` : d.calls.length}</small></div><Link className="fd-text-link" href="/calls">Call queue</Link></div>
              {calls.length === 0 ? <div className="fd-empty">{query ? 'No call-ready sellers match that search.' : 'No seller is cleared to call.'}</div> : (
                <div className="fd-list">{calls.slice(0, 2).map((call) => (
                  <article key={call.lead.id} className="fd-row">
                    <div className="fd-row-top"><div><div className="fd-row-name">{call.lead.sellerName}</div><div className="fd-row-meta">{call.lead.address}</div></div><Link href={`/calls?lead=${call.lead.id}`} className="fd-pill fd-pill-coral" data-testid={`link-call-${call.lead.id}`}>Call next</Link></div>
                    <div className="fd-row-copy">{call.objective}</div>
                    <div className="fd-row-foot"><ShieldCheck size={11} style={{ verticalAlign: 'middle', marginRight: 5 }} />{call.authorizedOffer ? `Owner-approved amount: ${money(call.authorizedOffer.amount)}` : `Research only. Opening range ${money(call.analysis.openingLow)}–${money(call.analysis.openingHigh)}, not authorized to quote.`}</div>
                  </article>
                ))}</div>
              )}
            </section>

            <section className="fd-panel" data-testid="panel-deals">
              <div className="fd-section-head"><div className="fd-section-title"><House size={15} />Live deals <small>{query ? `${deals.length} / ${d.deals.length}` : d.deals.length}</small></div><Link className="fd-text-link" href="/leads">Deal inventory</Link></div>
              {deals.length === 0 ? <div className="fd-empty">{query ? 'No live deals match that search.' : 'No deals past the first conversation.'}</div> : (
                <div className="fd-list">{deals.slice(0, 3).map((item) => (
                  <Link key={item.lead.id} href={`/deals/${item.lead.id}`} className="fd-deal-row" data-testid={`link-deal-${item.lead.id}`}>
                    <div><div className="fd-row-name">{item.lead.address}</div><div className="fd-row-meta">Next: {item.lead.nextAction || 'No next step recorded'}</div></div><span className="fd-stage">{item.lead.stage.replace(/_/g, ' ')}</span>
                  </Link>
                ))}</div>
              )}
            </section>

            <section className="fd-panel" data-testid="panel-contracts">
              <div className="fd-section-head"><div className="fd-section-title"><WalletCards size={15} />Contracts &amp; closing <small>{query ? `${contractRows.length} / ${contracts.length}` : contracts.length}</small></div></div>
              {contractRows.length === 0 ? <div className="fd-empty">{query ? 'No contracts match that search.' : 'No contract has been drafted.'}</div> : (
                <div className="fd-list">{contractRows.slice(0, 2).map((operation) => {
                  const contract = operation.contract!;
                  const status = contract.status === 'DRAFT' ? 'Draft, not executed' : contract.status.replace(/_/g, ' ');
                  return (
                    <Link key={contract.id} href={`/deals/${operation.leadId}?work=transaction`} className="fd-row" data-testid={`link-contract-${contract.id}`}>
                      <div className="fd-row-top"><div className="fd-row-name">{leadAddressById.get(operation.leadId) ?? 'Deal'}</div><span className={`fd-pill ${contract.status === 'DRAFT' ? 'fd-pill-coral' : 'fd-pill-dark'}`}>{status}</span></div>
                      <div className="fd-contract-meta"><span>{money(contract.purchasePrice)}</span><span>{contract.milestones.length} / 4 milestones</span><span>{operation.matches.filter((match) => match.status === 'COMMITTED').length} committed buyer(s)</span></div>
                      <div className="fd-row-copy">{operation.nextAction}</div>
                    </Link>
                  );
                })}</div>
              )}
            </section>

            <section className="fd-panel" data-testid="panel-deadlines">
              <div className="fd-section-head"><div className="fd-section-title"><CalendarClock size={15} />Closing deadlines <small>{query ? `${deadlineRows.length} / ${deadlines.length}` : deadlines.length}</small></div></div>
              {deadlineRows.length === 0 ? <div className="fd-empty">{query ? 'No closing dates match that search.' : 'No open contract has a closing date.'}</div> : (
                <div className="fd-list">{deadlineRows.slice(0, 2).map((operation) => {
                  const closingAt = operation.contract!.closingAt;
                  return (
                    <Link key={operation.leadId} href={`/deals/${operation.leadId}?work=transaction`} className="fd-deadline">
                      <span className="fd-deadline-date">{leadAddressById.get(operation.leadId) ?? 'Deal'}<br /><span className="fd-row-meta">{fmtDate(closingAt)}</span></span>
                      <span className={`fd-deadline-count ${isOverdue(closingAt) ? 'fd-pill-coral' : ''}`}>{ago(closingAt)}</span>
                    </Link>
                  );
                })}
                  {!query && deadlines.length === 1 && !isOverdue(deadlines[0].contract!.closingAt) && (
                    <div className="fd-empty fd-deadline-note">No other open closing dates are recorded.</div>
                  )}
                </div>
              )}
            </section>

            <section className="fd-panel" data-testid="panel-buyers">
              <div className="fd-section-head"><div className="fd-section-title"><UsersRound size={15} />Qualified buyers <small>{query ? `${qualifiedRows.length} of ${buyerRows.length}` : `${qualified.length} of ${d.buyers.length}`}</small></div><Link className="fd-text-link" href="/buyers" data-testid="link-buyers">All buyers</Link></div>
              {buyerRows.length === 0 ? <div className="fd-empty">{query ? 'No buyers match that search.' : 'No buyers recorded. Prospects require evidenced, current-buying qualification before they are treated as qualified.'}</div> : (
                <div className="fd-list">{buyerRows.slice(0, 3).map((buyer) => {
                  const qualifiedBuyer = isQualified(buyer) && (buyer.destinationKind ?? 'BUYER') === 'BUYER';
                  const buyerState = qualifiedBuyer ? 'Qualified' : buyer.verificationStatus === 'STALE' ? 'Stale' : buyer.status === 'PAUSED' ? 'Paused' : 'Unverified';
                  return (
                    <Link key={buyer.id} href={`/buyers/${buyer.id}`} className="fd-deal-row" data-testid={`link-buyer-${buyer.id}`}>
                      <div><div className="fd-row-name">{buyer.name}</div><div className="fd-row-meta">{buyer.criteria ? `${buyer.criteria.states.join(', ')} · up to ${money(buyer.criteria.maxPurchasePrice)}` : 'Criteria not yet collected'}</div></div>
                      <span className={`fd-pill ${qualifiedBuyer ? '' : 'fd-pill-coral'}`}>{buyerState}</span>
                    </Link>
                  );
                })}</div>
              )}
            </section>

            <section className="fd-panel" data-testid="panel-jobs">
              <div className="fd-section-head"><div className="fd-section-title"><Zap size={15} />Worker activity <small>{query ? `${jobRows.length} / ${d.jobs.length}` : d.jobs.length}</small></div><Link className="fd-text-link" href="/workers" data-testid="link-workers">Open workers</Link></div>
              {jobRows.length === 0 ? <div className="fd-empty">{query ? 'No worker activity matches that search.' : 'No jobs yet. Queued work and failures will appear here as workers run.'}</div> : (
                <div className="fd-list">{jobRows.slice(0, 3).map((job) => (
                  <div key={job.id} className="fd-worker-row">
                    <span className={`fd-pill ${job.state === 'FAILED' ? 'fd-pill-coral' : job.state === 'SUCCEEDED' ? '' : 'fd-pill-dark'}`}>{job.state}</span>
                    <span className="fd-worker-label">{job.message || job.kind.replace(/_/g, ' ').toLowerCase()}</span><span className="fd-date">{ago(job.updatedAt)}</span>
                  </div>
                ))}</div>
              )}
            </section>
          </div>

          <section className="fd-opps" data-testid="panel-opportunities">
            <div className="fd-section-head"><div className="fd-section-title"><CircleDollarSign size={15} />Opportunities to work up <small>{query ? `${opportunityRows.length} / ${d.opportunities.length}` : d.opportunities.length}</small></div><Link className="fd-text-link" href="/leads">See research queue</Link></div>
            {opportunityRows.length === 0 ? <div className="fd-empty">{query ? 'No opportunities match that search.' : 'No opportunities waiting for research.'}</div> : (
              <div className="fd-opp-grid">{opportunityRows.slice(0, 2).map((item) => (
                <Link key={item.lead.id} href={`/deals/${item.lead.id}?work=uw`} className="fd-opp" data-testid={`link-opp-${item.lead.id}`}>
                  <div className="fd-row-top"><div className="fd-row-name">{item.lead.address}</div><StageBadge stage={item.lead.stage} variant="field-desk" /></div>
                  <div className="fd-opp-info"><MapPin size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />{item.intelligence.length} evidence item{item.intelligence.length === 1 ? '' : 's'} · {item.analysis ? item.analysis.classification : 'not underwritten'}</div>
                  {item.analysis?.blockers[0] && <div className="fd-row-copy"><Leaf size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Needs review: {item.analysis.blockers[0]}</div>}
                </Link>
              ))}</div>
            )}
          </section>
          </details>
        </>
      )}
    </>
  );
}
