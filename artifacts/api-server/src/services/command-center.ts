import { GetCommandCenterResponse } from "@workspace/api-zod";
import {
  dealActions,
  strongestOpportunities,
  type DealWorkGuidance,
  type IntelligenceLoopInput,
  type CommandAction,
} from "@workspace/deal-domain";
import { listLeads, leadDetail, callQueue } from "./deal-store";
import { dealOperations } from "./matching-store";
import { allBuyerRecords, jobRecord } from "./operations-records";
import { db, jobsTable } from "@workspace/db";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { listPropertyDiscoveries } from "./property-discovery-store";
import { acquisitionQueue } from "./acquisition-queue-store";
import { persistIntelligenceDecision } from "./intelligence-decision-store";

const SCHEDULER_ACTOR = "system:scheduler";
const FIVE_MINUTES = 5 * 60_000;
const SIX_HOURS = 6 * 60 * 60_000;

function nextScheduleBoundary(now: Date, cadenceMs: number) {
  return new Date((Math.floor(now.getTime() / cadenceMs) + 1) * cadenceMs).toISOString();
}

function scheduledLane(
  key: string,
  label: string,
  cadence: string,
  cadenceMs: number,
  row: typeof jobsTable.$inferSelect | undefined,
  now: Date,
  scope: string,
) {
  let state: "ACTIVE" | "RUNNING" | "QUEUED" | "ACTION_REQUIRED" | "OVERDUE" | "WAITING_FOR_FIRST_RUN" =
    "WAITING_FOR_FIRST_RUN";
  if (row?.state === "FAILED") state = "ACTION_REQUIRED";
  else if (row?.state === "RUNNING") state = "RUNNING";
  else if (row?.state === "QUEUED") state = "QUEUED";
  else if (row?.state === "SUCCEEDED") {
    state = now.getTime() - row.updatedAt.getTime() > cadenceMs + 60_000 ? "OVERDUE" : "ACTIVE";
  }
  return {
    key,
    label,
    state,
    cadence,
    lastRunAt: row && ["SUCCEEDED", "FAILED"].includes(row.state) ? row.updatedAt.toISOString() : null,
    nextRunAt: state === "ACTION_REQUIRED" || state === "OVERDUE"
      ? new Date(now.getTime() + 15_000).toISOString()
      : nextScheduleBoundary(now, cadenceMs),
    result: row?.message ?? "No scheduled execution has been recorded yet.",
    scope,
    href: state === "ACTION_REQUIRED" || state === "OVERDUE" ? "/workers" : null,
  };
}

function sourceDiscoveryLane(
  key: string,
  label: string,
  policyRow: typeof jobsTable.$inferSelect | undefined,
  schedulerRow: typeof jobsTable.$inferSelect | undefined,
  expectedPolicy: string,
  recurringConsentField: "recurringPropertyDiscovery" | "recurringDiscovery",
  now: Date,
) {
  const policy = policyRow?.payload ?? {};
  const termsCurrent = policy.termsReviewed === true && policy.sourcePolicyVersion === expectedPolicy;
  const recurringEnabled = termsCurrent && policy[recurringConsentField] === true;
  const runLane = scheduledLane(
    key,
    label,
    "Every 6 hours when authorized",
    SIX_HOURS,
    schedulerRow,
    now,
    "Source retrieval, deduplication, provenance capture and relevance qualification only. No seller or buyer is contacted.",
  );
  if (!termsCurrent) return {
    ...runLane,
    state: "AWAITING_AUTHORIZATION" as const,
    lastRunAt: policyRow?.state === "SUCCEEDED" ? policyRow.updatedAt.toISOString() : null,
    nextRunAt: null,
    result: policyRow?.message ?? "Recurring discovery is paused until current source terms are reviewed. The system does not infer or reuse expired consent.",
    scope: "Review the current source terms and enable recurring discovery before this source runs automatically.",
    href: "/sources",
  };
  if (!recurringEnabled) return {
    ...runLane,
    state: "ONE_TIME_ONLY" as const,
    lastRunAt: policyRow?.state === "SUCCEEDED" ? policyRow.updatedAt.toISOString() : null,
    nextRunAt: null,
    result: policyRow?.message ?? "Source terms were reviewed, but recurring discovery was not enabled. Only explicitly submitted one-time runs are authorized.",
    scope: "Enable recurring discovery in the source controls to schedule future runs.",
    href: "/sources",
  };
  if (!schedulerRow) return {
    ...runLane,
    state: "ENABLED" as const,
    lastRunAt: policyRow?.state === "SUCCEEDED" ? policyRow.updatedAt.toISOString() : null,
    result: "Current terms and recurring permission are recorded. The first scheduled source run is pending.",
    scope: "The worker will retrieve permitted records, retain raw observations, deduplicate, and qualify; it will not create a contact or offer.",
    href: null,
  };
  return {
    ...runLane,
    state: runLane.state === "ACTIVE" ? "ACTIVE" as const : runLane.state,
    result: schedulerRow.message,
    scope: "The worker retrieves permitted records, retains raw observations, deduplicates, and qualifies. It does not contact owners or buyers.",
  };
}

export async function commandCenter(role: string, now = new Date()) {
  const allPropertyDiscoveries = await listPropertyDiscoveries({
    marketKey: "PHILADELPHIA_PA",
    statuses: ["RELEVANT_CANDIDATE", "QUALIFIED_LEAD"],
    limit: 5,
  });
  const propertyDiscoveries = allPropertyDiscoveries;
  const leads = await listLeads();
  const [deals, calls, rankedAcquisitionQueue] = await Promise.all([
    Promise.all(leads.map(l => leadDetail(l.id,undefined,now))),
    callQueue(now),
    acquisitionQueue(role, now),
  ]);
  const operations = await Promise.all(leads.map(l=>dealOperations(l.id,now)));
  const acquisitionByLead = new Map(rankedAcquisitionQueue.items.map(item => [item.lead.id, item]));
  const operationByLead = new Map(operations.map(item => [item.leadId, item]));
  const leadDecisions = await Promise.all(deals.map(detail => {
    const operation = operationByLead.get(detail.lead.id);
    const decisionInput: IntelligenceLoopInput = {
      subjectType: "LEAD",
      subjectId: detail.lead.id,
      leadId: detail.lead.id,
      discoveryId: detail.lead.propertyQualification?.discoveryId ?? null,
      detail,
      acquisition: acquisitionByLead.get(detail.lead.id) ?? null,
      operations: operation ? {
        contract: operation.contract ? {
          id: operation.contract.id,
          status: operation.contract.status,
          committedBuyerId: operation.contract.committedBuyerId ?? null,
          closingAt: operation.contract.closingAt,
        } : null,
        matches: operation.matches.map(match => ({ buyerId: match.buyerId, eligible: match.eligible })),
        nextAction: operation.nextAction,
      } : null,
      now,
    };
    return persistIntelligenceDecision(decisionInput, "system:command-center", now);
  }));
  const candidateDecisions = await Promise.all(propertyDiscoveries.records
    .filter(candidate => candidate.status === "RELEVANT_CANDIDATE" && !candidate.leadId)
    .map(candidate => {
      const source = candidate as unknown as {
        updatedAt?: string; createdAt?: string;
        sourceObservations?: Array<{ lastObservedAt?: string }>;
      };
      const decisionInput: IntelligenceLoopInput = {
        subjectType: "DISCOVERY",
        subjectId: candidate.id,
        discoveryId: candidate.id,
        leadId: null,
        discovery: {
          id: candidate.id,
          status: candidate.status,
          leadId: candidate.leadId,
          address: candidate.property.address,
          reason: candidate.reason,
          nextAction: candidate.nextAction,
          observedAt: source.sourceObservations?.[0]?.lastObservedAt ?? source.updatedAt ?? source.createdAt ?? null,
          missingInformation: candidate.missingInformation,
          signalRefs: candidate.signals.map(signal => signal.evidenceRef ?? `signal:${signal.id}`),
        },
        now,
      };
      return persistIntelligenceDecision(decisionInput, "system:command-center", now);
    }));
  const decisions = [...leadDecisions, ...candidateDecisions].sort((a, b) =>
    (b.recommendedAction?.priority ?? 0) - (a.recommendedAction?.priority ?? 0)
    || a.subjectId.localeCompare(b.subjectId));
  const decisionByLead = new Map(leadDecisions.map(decision => [decision.leadId, decision]));
  const commandDeals = deals.map(detail => ({
    lead: detail.lead,
    workGuidance: detail.workGuidance,
    decision: decisionByLead.get(detail.lead.id)!,
  }));
  const [buyers, jobRows, schedulerRows, propertyPolicyRows, buyerPolicyRows, jobStateCounts] = await Promise.all([
    allBuyerRecords(db,now),
    db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt)).limit(30),
    db.select().from(jobsTable).where(eq(jobsTable.requestedBy,SCHEDULER_ACTOR)).orderBy(desc(jobsTable.createdAt)).limit(200),
    db.select().from(jobsTable).where(and(eq(jobsTable.kind,"DISCOVER_PROPERTIES"),ne(jobsTable.requestedBy,SCHEDULER_ACTOR))).orderBy(desc(jobsTable.createdAt)).limit(1),
    db.select().from(jobsTable).where(and(eq(jobsTable.kind,"BUYER_DISCOVERY"),ne(jobsTable.requestedBy,SCHEDULER_ACTOR))).orderBy(desc(jobsTable.createdAt)).limit(1),
    db.select({state:jobsTable.state,total:count()}).from(jobsTable).groupBy(jobsTable.state),
  ]);
  const jobs = jobRows.map(jobRecord);
  const latestScheduled = (kind: string) => schedulerRows.find((job) => job.kind === kind);
  const deadlinesLane = scheduledLane(
    "deadlines",
    "Follow-ups and transaction deadlines",
    "Every 5 minutes",
    FIVE_MINUTES,
    latestScheduled("REVIEW_DEADLINES"),
    now,
    "Detects due follow-ups, stale evidence, buyer reverification and contractual deadlines; it records work but never sends a message or changes signed terms.",
  );
  const buyerVerificationLane = scheduledLane(
    "buyer-verification",
    "Buyer freshness and verification review",
    "Every 5 minutes",
    FIVE_MINUTES,
    latestScheduled("REVIEW_BUYER_POOL"),
    now,
    "Flags stale or incomplete buyers and blocks matching eligibility until current evidence is reviewed.",
  );
  const matchingLane = scheduledLane(
    "buyer-matching",
    "Buyer matching for active transactions",
    "Every 5 minutes",
    FIVE_MINUTES,
    latestScheduled("MATCH_BUYERS"),
    now,
    "Rechecks current criteria, verification, funding and capacity for active transactions. Match or interest is never treated as commitment.",
  );
  const handoffLane = scheduledLane(
    "handoffs",
    "External handoff and response review",
    "Every 5 minutes",
    FIVE_MINUTES,
    latestScheduled("REVIEW_HANDOFFS"),
    now,
    "Reviews persisted handoff states and responses; a draft or queued handoff is not proof of external delivery.",
  );
  const propertyLane = sourceDiscoveryLane(
    "property-discovery",
    "Property discovery and qualification",
    propertyPolicyRows[0],
    latestScheduled("DISCOVER_PROPERTIES"),
    "phila-property-sources-v4",
    "recurringPropertyDiscovery",
    now,
  );
  const buyerDiscovery = sourceDiscoveryLane(
    "buyer-discovery",
    "Buyer prospect discovery",
    buyerPolicyRows[0],
    latestScheduled("BUYER_DISCOVERY"),
    "phila-buyer-sources-v2",
    "recurringDiscovery",
    now,
  );
  const underwritingLane = {
    key: "underwriting",
    label: "Evidence and deterministic underwriting",
    state: "EVENT_DRIVEN" as const,
    cadence: "When sourced evidence and reviewed inputs change",
    lastRunAt: null,
    nextRunAt: null,
    result: "Property relevance is recalculated from source observations. ARV, condition-based repairs and MAO use reviewed evidence and configured rules; missing or stale inputs block offer authority.",
    scope: "No condition, seller intent, comp or financial fact is invented. Human review remains required where evidence or authority is incomplete.",
    href: "/leads",
  };
  const authorityLane = {
    key: "human-authority",
    label: "Calls, offers, signatures and funds",
    state: "HUMAN_GATE" as const,
    cadence: "Human-authorized action only",
    lastRunAt: null,
    nextRunAt: null,
    result: "External communication, offer approval, execution, commitment and funds evidence are never inferred from a draft, match or prepared document.",
    scope: "The system prepares grounded next steps and records actual outcomes; an authorized person performs and confirms outside actions.",
    href: "/calls",
  };
  const lanes = [propertyLane,buyerDiscovery,underwritingLane,buyerVerificationLane,matchingLane,deadlinesLane,handoffLane,authorityLane];
  const queuedJobs = Number(jobStateCounts.find((item) => item.state === "QUEUED")?.total ?? 0);
  const runningJobs = Number(jobStateCounts.find((item) => item.state === "RUNNING")?.total ?? 0);
  const failedJobs = Number(jobStateCounts.find((item) => item.state === "FAILED")?.total ?? 0);
  const status = failedJobs > 0 || lanes.some((lane) => lane.state === "ACTION_REQUIRED")
    ? "ACTION_REQUIRED"
    : lanes.some((lane) => lane.state === "OVERDUE")
      ? "DELAYED"
      : lanes.some((lane) => lane.state === "ACTIVE" || lane.state === "RUNNING" || lane.state === "QUEUED" || lane.state === "ENABLED")
        ? "CURRENT"
        : "STARTING";
  const automation = {
    observedAt: now.toISOString(),
    status,
    queuedJobs,
    runningJobs,
    failedJobs,
    lanes,
  };
  const dealById = new Map(deals.map((deal) => [deal.lead.id, deal]));
  const transactionLeadIds = new Set(operations.filter((operation) => {
    const deal = dealById.get(operation.leadId);
    if (!deal || ["CLOSED","DEAD_DEAL"].includes(deal.lead.stage)) return false;
    const hasActiveContract = !!operation.contract && !["CLOSED","CANCELLED"].includes(operation.contract.status);
    const hasCommunicatedOffer = !operation.contract && deal.offers.some((offer) => offer.effectiveStatus === "COMMUNICATED");
    return hasActiveContract || hasCommunicatedOffer;
  }).map((operation) => operation.leadId));
  const actions = dealActions(deals,role,now,transactionLeadIds);
  if (["OWNER","OPERATOR","ANALYST"].includes(role)) {
    for (const candidate of propertyDiscoveries.records) {
      if (candidate.status !== "RELEVANT_CANDIDATE") continue;
      const priority = 45 + Math.round(candidate.score / 5);
      const title = `Review ${candidate.property.address}`;
      const cta = candidate.canPromote ? "Review promotion" : "Review evidence";
      const href = `/sources?discovery=${candidate.id}`;
      const missingFacts = [...new Set([...candidate.promotionBlockers, ...candidate.missingInformation])];
      const workGuidance: DealWorkGuidance = {
        category: "DISCOVERY_REVIEW", priority, title, href, cta,
        currentState: `Relevant candidate · ${candidate.score}/100 relevance · ${Math.round(candidate.confidence * 100)}% evidence confidence.`,
        responsibleRole: role === "OWNER" ? "OWNER" : role === "OPERATOR" ? "OPERATOR" : "ANALYST",
        dueAt: null,
        dueLabel: "No review deadline is recorded.",
        knownFacts: [
          `${candidate.sourceObservationCount} source observation(s) are attached.`,
          `${candidate.signals.length} provenance-backed signal(s) are recorded.`,
          candidate.reason,
        ],
        missingFacts: missingFacts.length ? missingFacts : ["No additional information gap is reported; human review is still required."],
        why: candidate.reason,
        systemCanDo: "Deduplicate source records, apply the configured market criteria, rank the evidence, and retain the raw discovery. It cannot infer seller motivation or create an active lead from a property record.",
        humanMustDo: candidate.canPromote
          ? "Review each signal and its provenance, then promote to the acquisition queue or record a pass reason."
          : candidate.nextAction,
        requiredEvidence: missingFacts.length ? missingFacts : ["Review the existing signal provenance and choose promotion or pass."],
        completionRecord: candidate.canPromote
          ? "A reviewer records the promotion or pass decision; promotion creates a distinct qualified lead linked to this preserved discovery."
          : "Add permitted source-backed evidence or record an explicit pass reason; the property remains a discovery until then.",
      };
      actions.push({
        id: `DISCOVERY_REVIEW:${candidate.id}`,
        category: "DISCOVERY_REVIEW",
        priority,
        title,
        reason: `${candidate.score}/100 · ${Math.round(candidate.confidence * 100)}% evidence confidence. ${candidate.reason}`,
        cta,
        leadId: null,
        href,
        dueAt: null,
        workGuidance,
      });
    }
  }
  const operate = ["OWNER","OPERATOR"].includes(role);
  for (const op of operations) {
    const d = dealById.get(op.leadId);
    if (!d) continue;
    if (["CLOSED","DEAD_DEAL"].includes(d.lead.stage)) continue;
    const c = op.contract;
    const hasCommunicatedOffer = !c && d.offers.some((offer) => offer.effectiveStatus === "COMMUNICATED");
    const activeContract = !!c && !["CLOSED","CANCELLED"].includes(c.status);
    if ((!activeContract && !hasCommunicatedOffer) || !operate) continue;

    const remaining = c ? Date.parse(c.closingAt)-now.getTime() : Number.POSITIVE_INFINITY;
    const urgent = remaining < 3*86_400_000;
    const category: typeof actions[number]["category"] = urgent ? "DEADLINE"
      : !c || c.status === "DRAFT" ? "CONTRACT" : c.committedBuyerId ? "CLOSING" : "BUYER_MATCH";
    const responsibleRole: DealWorkGuidance["responsibleRole"] = !c || c.status === "DRAFT" || !c.committedBuyerId
      ? "OWNER" : "OPERATOR";
    if (responsibleRole === "OWNER" && role !== "OWNER") continue;

    const priority = urgent ? remaining <= 0 ? 130 : 115 : !c || c.status === "DRAFT" ? 88 : c.committedBuyerId ? 90 : 82;
    const title = op.nextAction.trim() || (!c ? "Prepare transaction terms from the exact communicated offer." : "Review the active transaction.");
    const closingAt = c?.closingAt ?? null;
    const milestonesRecorded = c?.milestones.length ?? 0;
    const missingFacts = !c
      ? ["A transaction record has not yet been prepared from the communicated offer."]
      : c.status === "DRAFT"
        ? ["External contract signatures and execution evidence are not recorded."]
        : !c.committedBuyerId
          ? ["No acquisition-buyer commitment is recorded. Interest and portal acceptance are not commitment."]
          : milestonesRecorded < 4
            ? [`${4-milestonesRecorded} of 4 closing milestone records are still missing.`]
            : [];
    const why = c?.status === "DRAFT"
      ? "A saved transaction draft is not an executed agreement. Exact signed-document evidence must be recorded before buyer commitment."
      : c?.committedBuyerId
        ? "An executed agreement creates real closing obligations; each milestone and settlement must be recorded from evidence."
        : "Buyer interest or portal acceptance is not a commitment. Owner review must preserve the exact executed acquisition terms.";
    const requiredEvidence = !c
      ? ["Prepare terms from the exact owner-authorized and communicated offer."]
      : c.status === "DRAFT"
        ? ["Exact executed-document reference.","Actual seller and acquisition signature times."]
        : !c.committedBuyerId
          ? ["Current qualified acquisition-buyer evidence.","Owner-reviewed commitment against the executed terms."]
          : ["Evidence references and actual occurrence times for closing milestones.","Settlement evidence before recording a deal outcome."];
    const workGuidance: DealWorkGuidance = {
      ...(d.workGuidance ?? {
        category,priority,title,href:`/deals/${op.leadId}?work=transaction`,cta:"Open transaction",
        currentState:"Transaction work is active.",responsibleRole,dueAt:closingAt,dueLabel:"Contract closing deadline",
        knownFacts:[],missingFacts:[],why,systemCanDo:"The system retains entered transaction records but does not sign, transfer title, release funds, or verify settlement.",
        humanMustDo:title,requiredEvidence,completionRecord:"Transaction events are saved with their actor, time, and evidence reference.",
      }),
      category,priority,title,href:`/deals/${op.leadId}?work=transaction`,
      cta:category==="CONTRACT"?"Open contract":category==="CLOSING"?"Coordinate closing":category==="DEADLINE"?"Resolve deadline":"Review buyers",
      currentState:c?`Contract status: ${c.status}.`:"An exact-term offer was communicated; transaction preparation is next.",
      responsibleRole,dueAt:closingAt,dueLabel:closingAt?"Contractual closing deadline":"No contractual closing deadline is recorded.",
      knownFacts:[
        `Deal stage: ${d.lead.stage.replaceAll("_"," ").toLowerCase()}.`,
        c?`Contract status: ${c.status}.`:"No contract record is saved yet.",
        c?.committedBuyerId?"An acquisition buyer is recorded as committed.":"No acquisition buyer is recorded as committed.",
        c?`${milestonesRecorded} of 4 closing milestones are recorded.`:"No closing milestones are recorded.",
      ],
      missingFacts,why,
      systemCanDo:"The system can preserve approved terms and record entered evidence. It cannot e-sign, transfer title, release funds, or verify settlement on its own.",
      humanMustDo:title,requiredEvidence,
      completionRecord:c?.committedBuyerId
        ?"Contract, buyer commitment, closing milestones, and settlement outcome are saved as separate attributed events."
        :"Contract preparation/execution and buyer responses are recorded separately; no signature or commitment is inferred.",
    };
    actions.push({id:`${category}:${op.leadId}`,category,priority,title,reason:why,cta:workGuidance.cta,
      leadId:op.leadId,href:workGuidance.href,dueAt:workGuidance.dueAt,workGuidance});
  }
  if (["OWNER","ANALYST"].includes(role)) for (const b of buyers.filter(b=>b.approvalStatus!=="APPROVED"&&b.currentBuyingStatus!=="NOT_BUYING")) {
    const priority = b.approvalStatus==="REVERIFICATION_REQUIRED" ? 92 : 60;
    const title = `${b.approvalStatus==="REVERIFICATION_REQUIRED"?"Reverify":"Qualify"} ${b.name}`;
    const reason = (b.qualificationBlockers??[]).join("; ") || "Current buying and structured criteria require reviewed dated evidence; discovery is not approval.";
    const href = `/buyers/${b.id}`;
    const missingFacts = b.qualificationBlockers??[];
    const workGuidance: DealWorkGuidance = {
      category: "BUYER_VERIFICATION", priority, title, href, cta: "Review buyer evidence",
      currentState: `Approval ${b.approvalStatus}; current buying status ${b.currentBuyingStatus}.`,
      responsibleRole: role === "OWNER" ? "OWNER" : "ANALYST",
      dueAt: b.validUntil ?? null,
      dueLabel: b.validUntil ? "Buyer evidence valid through" : "No evidence expiry is recorded.",
      knownFacts: [`Buyer record: ${b.name}.`, `Approval status: ${b.approvalStatus}.`, `Current buying status: ${b.currentBuyingStatus}.`],
      missingFacts: missingFacts.length ? missingFacts : ["No structured blocker is reported; current dated evidence still requires review."],
      why: reason,
      systemCanDo: "Compare dated identity, buying and buy-box evidence with the recorded criteria, flag stale evidence, and block mismatched buyer matching.",
      humanMustDo: "Review the source-linked buyer evidence and record a current verification or an explicit not-buying disposition.",
      requiredEvidence: missingFacts.length ? missingFacts : ["Current, dated evidence that supports the recorded identity, buying status and criteria."],
      completionRecord: "The verification decision, evidence references, expiry and approval history are persisted; only an approved current buyer can enter matching.",
    };
    actions.push({id:`BUYER_VERIFICATION:${b.id}`,category:"BUYER_VERIFICATION",priority,title,reason,
      cta:"Review buyer evidence",leadId:null,href,dueAt:b.validUntil??null,workGuidance});
  }
  if (["OWNER","ANALYST"].includes(role)) {
    const representedDeals = new Set(actions.flatMap((action) => action.leadId ? [action.leadId] : []));
    for (const j of jobs.filter(j=>j.state==="FAILED")) {
      if (j.leadId && representedDeals.has(j.leadId)) continue;
      const priority = 70;
      const title = `Review failed ${j.kind.toLowerCase().replace(/_/g," ")} job`;
      const href = "/workers";
      const workGuidance: DealWorkGuidance = {
        category: "WORKER", priority, title, href, cta: "Inspect worker activity",
        currentState: `Failed after ${j.attempts} attempt(s).`,
        responsibleRole: role === "OWNER" ? "OWNER" : "ANALYST",
        dueAt: null,
        dueLabel: "No retry deadline is recorded.",
        knownFacts: [`Job type: ${j.kind}.`, `Attempts recorded: ${j.attempts}.`, `Last result: ${j.message}`],
        missingFacts: ["A successful result for this job is not recorded."],
        why: "A failed job did not complete its operation; do not treat its intended output as delivered.",
        systemCanDo: "Persist the failure and expose a retry action. It does not send messages or infer successful work.",
        humanMustDo: "Review the saved failure, resolve or understand the cited issue, then queue a fresh retry if it is safe.",
        requiredEvidence: ["The source, input or provider issue is resolved or the retry is intentionally justified."],
        completionRecord: "A retry is saved as a separate job with its own execution state, attempts and result.",
      };
      actions.push({id:`WORKER:${j.id}`,category:"WORKER",priority,title,
        reason:j.message,cta:"Inspect worker activity",leadId:j.leadId,href,dueAt:null,workGuidance});
    }
  }
  const categoryForDecision = (code: string): CommandAction["category"] => {
    if (code === "CALL_NEXT") return "CALL";
    if (code === "REVIEW_FOLLOW_UP") return "FOLLOW_UP";
    if (code === "AUTHORIZE_OFFER") return "OFFER_APPROVAL";
    if (code === "REVIEW_SELLER_RESPONSE") return "NEGOTIATION";
    if (code === "BUYER_DEMAND") return "BUYER_MATCH";
    if (code === "TRANSACTION_NEXT") return "CLOSING";
    if (code === "QUALIFY_DISCOVERY" || code === "REVIEW_CANDIDATE") return "DISCOVERY_REVIEW";
    return "RESEARCH";
  };
  const ctaForDecision = (category: CommandAction["category"]) => ({
    CALL: "Open seller call",
    FOLLOW_UP: "Open follow-up",
    OFFER_APPROVAL: "Review offer authority",
    NEGOTIATION: "Review seller response",
    BUYER_MATCH: "Review buyer demand",
    CONTRACT: "Open transaction",
    CLOSING: "Open transaction",
    DISCOVERY_REVIEW: "Review evidence",
    RESEARCH: "Resolve evidence gap",
    BUYER_VERIFICATION: "Review buyer",
    DEADLINE: "Resolve deadline",
    WORKER: "Inspect worker",
  })[category];
  const preservedActions = actions.filter(action => !action.leadId && !action.id.startsWith("DISCOVERY_REVIEW:"));
  const guidanceByLead = new Map<string, DealWorkGuidance>();
  const decisionActions: CommandAction[] = decisions.flatMap(decision => {
    const next = decision.recommendedAction;
    if (!next) return [];
    const category = categoryForDecision(next.code);
    const linkedLead = decision.leadId ? dealById.get(decision.leadId) : undefined;
    const existing = decision.leadId ? actions.find(action => action.leadId === decision.leadId) : undefined;
    const guidance: DealWorkGuidance = {
      category,
      priority: next.priority,
      title: next.title,
      href: next.href,
      cta: ctaForDecision(category),
      currentState: decision.currentState,
      responsibleRole: next.responsibleRole,
      dueAt: existing?.dueAt ?? null,
      dueLabel: existing?.workGuidance?.dueLabel ?? "No deadline is recorded for this action.",
      knownFacts: decision.known.map(item => `${item.epistemicStatus} · ${item.summary}`),
      missingFacts: decision.unknowns.length ? decision.unknowns
        : decision.conflicts.length ? decision.conflicts.map(item => item.summary)
          : ["No material evidence gap is reported by the current decision snapshot."],
      why: next.reason,
      systemCanDo: "The decision is derived from persisted evidence, current contact and underwriting gates, and deterministic rules. It does not call, message, authorize an offer, sign, or move funds.",
      humanMustDo: next.requiresHumanAuthorization
        ? `Human authorization is required. ${next.title}`
        : next.title,
      requiredEvidence: next.evidenceRefs,
      completionRecord: decision.outcomeRecord
        ?? "A subsequent evidence or action event will produce a new decision snapshot; superseded work is completed or expired with an audit record.",
    };
    if (decision.leadId) guidanceByLead.set(decision.leadId, guidance);
    if (role !== "OWNER" && role !== next.responsibleRole) return [];
    return [{
      id: `DECISION:${decision.subjectType}:${decision.subjectId}:${next.workItemId}`,
      category,
      priority: next.priority,
      title: next.title,
      reason: next.reason,
      leadId: decision.leadId,
      href: next.href,
      cta: ctaForDecision(category),
      dueAt: existing?.dueAt ?? null,
      workGuidance: guidance,
    }];
  });
  const commandActions = [...preservedActions, ...decisionActions]
    .sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  const displayDeals = commandDeals.map(deal => {
    const decision = decisionByLead.get(deal.lead.id);
    return {
      ...deal,
      workGuidance: decision
        ? decision.recommendedAction ? guidanceByLead.get(deal.lead.id) ?? null : null
        : deal.workGuidance,
    };
  });
  return GetCommandCenterResponse.parse({
    generatedAt:now.toISOString(),deals:displayDeals,decisions,calls,acquisitionQueue:rankedAcquisitionQueue.items.slice(0,5),operations,buyers,jobs,automation,
    actions:commandActions,
    opportunities:strongestOpportunities(deals),
    propertyDiscoveries,
  });
}