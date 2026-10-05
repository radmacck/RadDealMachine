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
import { ago, fmtDate, isOverdue, money } from '@/lib/format';

const LABEL: Record<CommandAction['category'], string> = {
  RESEARCH: 'Research', CALL: 'Call', FOLLOW_UP: 'Follow up', OFFER_APPROVAL: 'Owner approval', NEGOTIATION: 'Negotiate',
  CONTRACT: 'Contract', BUYER_MATCH: 'Buyer match', BUYER_VERIFICATION: 'Verify buyer', DEADLINE: 'Deadline', CLOSING: 'Closing', WORKER: 'Worker',
};
const TONE: Record<CommandAction['category'], string> = {
  RESEARCH: 'tone-muted', CALL: 'tone-signal', FOLLOW_UP: 'tone-warn', OFFER_APPROVAL: 'tone-ink', NEGOTIATION: 'tone-go',
  CONTRACT: 'tone-ink', BUYER_MATCH: 'tone-go', BUYER_VERIFICATION: 'tone-warn', DEADLINE: 'tone-stop', CLOSING: 'tone-signal', WORKER: 'tone-muted',
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
  const visibleActions = showAllActions ? actions : actions.slice(0, 3);
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
  const qualifiedRows = buyerRows.filter((buyer) => isQualified(buyer) && (buyer.destinationKind ?? 'BUYER') === 'BUYER');
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
          <p className="fd-subtitle">A clear view of what moves your deals forward today.</p>
        </div>
        <div className="fd-head-buttons">
          <button className="fd-button" type="button" onClick={() => void q.refetch()} disabled={q.isFetching} aria-busy={q.isFetching}>
            <RefreshCw size={14} className={q.isFetching ? 'animate-spin' : ''} />{q.isFetching ? 'Refreshing' : 'Refresh desk'}
          </button>
          <Link className="fd-button fd-button-primary" href="/leads" data-testid="link-add-lead"><Plus size={15} />Add a lead</Link>
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
          <section className="fd-metrics" aria-label="Portfolio snapshot">
            <div className="fd-metric"><span className="fd-metric-icon"><Building2 size={17} /></span><span><div className="fd-metric-value">{activeOpportunityCount}</div><div className="fd-metric-label">Active opportunities</div></span></div>
            <div className="fd-metric"><span className="fd-metric-icon"><Headphones size={17} /></span><span><div className="fd-metric-value">{d.calls.length}</div><div className="fd-metric-label">Sellers ready to call</div></span></div>
            <div className="fd-metric"><span className="fd-metric-icon"><HandCoins size={17} /></span><span><div className="fd-metric-value">{d.deals.length}</div><div className="fd-metric-label">Deals in motion</div></span></div>
            <div className="fd-metric"><span className="fd-metric-icon"><CalendarClock size={17} /></span><span><div className="fd-metric-value">{closingThisMonth}</div><div className="fd-metric-label">Closing this month</div></span></div>
          </section>

          <section className="fd-actions-section" data-testid="panel-actions">
            <div className="fd-section-head">
              <div className="fd-section-title"><Compass size={16} />Do next <small>{actions.length}</small></div>
              <Link className="fd-text-link" href="/sources" data-testid="link-sources">Find properties from official records <ArrowRight size={12} style={{ verticalAlign: 'middle', marginLeft: 3 }} /></Link>
            </div>
            {actions.length === 0 ? (
              <div className="fd-empty">{query ? 'No tasks match that search. Try a different name or address.' : <>Nothing is waiting on you. New work appears here as leads are researched, approved, and followed up. <Link className="fd-text-link" href="/leads" data-testid="link-empty-inventory">Open deal inventory</Link></>}</div>
            ) : (
              <div className="fd-action-list">
                {visibleActions.map((action) => (
                  <article key={action.id} className="fd-action" data-category={action.category} data-testid={`action-${action.id}`}>
                    <span className="fd-action-stripe" />
                    <span className={`fd-action-tag ${TONE[action.category]}`}>{LABEL[action.category]}</span>
                    <div>
                      <div className="fd-action-title">{action.title}</div>
                      <div className="fd-action-reason">{action.reason}</div>
                      {action.workGuidance && (
                        <div className="fd-work-guidance" data-testid={`work-guidance-${action.id}`}>
                          <div className="fd-work-guidance-state">
                            <span><b>State</b> {action.workGuidance.currentState}</span>
                            <span><b>Responsible</b> {action.workGuidance.responsibleRole}</span>
                            <span><b>{action.workGuidance.dueLabel}</b>{action.workGuidance.dueAt ? ` · ${fmtDate(action.workGuidance.dueAt)}` : ''}</span>
                          </div>
                          {action.workGuidance.knownFacts.length > 0 && <p><b>Known:</b> {action.workGuidance.knownFacts.join(' · ')}</p>}
                          {action.workGuidance.missingFacts.length > 0 && <p className="fd-work-guidance-missing"><b>Missing / blocked:</b> {action.workGuidance.missingFacts.join(' · ')}</p>}
                          <details className="fd-work-guidance-detail">
                            <summary>What the system can do, what you must do, and how it is recorded</summary>
                            <p><b>Why this matters:</b> {action.workGuidance.why}</p>
                            <p><b>System:</b> {action.workGuidance.systemCanDo}</p>
                            <p><b>You:</b> {action.workGuidance.humanMustDo}</p>
                            <p><b>Evidence to record:</b> {action.workGuidance.requiredEvidence.join(' · ')}</p>
                            <p><b>Completion record:</b> {action.workGuidance.completionRecord}</p>
                          </details>
                        </div>
                      )}
                    </div>
                    {action.dueAt && <span className="fd-due">{action.workGuidance?.dueLabel ?? 'Due'} · {ago(action.dueAt)}</span>}
                    <Link href={action.href} className="fd-action-link" aria-label={`${action.cta}: ${action.title}`}>
                      {action.cta}<ArrowRight size={13} />
                    </Link>
                  </article>
                ))}
              </div>
            )}
            {actions.length > 3 && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 7 }}>
              <button className="fd-text-link" type="button" onClick={() => setShowAllActions((current) => !current)}>{showAllActions ? 'Show the essentials' : 'View all tasks'} <ArrowRight size={12} style={{ verticalAlign: 'middle', marginLeft: 3 }} /></button>
            </div>}
          </section>

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
        </>
      )}
    </>
  );
}
