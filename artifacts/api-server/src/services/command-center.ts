import { GetCommandCenterResponse } from "@workspace/api-zod";
import { dealActions, strongestOpportunities, type DealWorkGuidance } from "@workspace/deal-domain";
import { listLeads, leadDetail, callQueue } from "./deal-store";
import { dealOperations } from "./matching-store";
import { allBuyerRecords, jobRecord } from "./operations-records";
import { db, jobsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { listPropertyDiscoveries } from "./property-discovery-store";

export async function commandCenter(role: string, now = new Date()) {
  const allPropertyDiscoveries = await listPropertyDiscoveries({
    marketKey: "PHILADELPHIA_PA",
    limit: 100,
  });
  const propertyDiscoveries = {
    ...allPropertyDiscoveries,
    records: allPropertyDiscoveries.records
      .filter((item) => ["RELEVANT_CANDIDATE", "QUALIFIED_LEAD"].includes(item.status))
      .slice(0, 5),
  };
  const leads = await listLeads();
  const deals = await Promise.all(leads.map(l => leadDetail(l.id,undefined,now)));
  const calls = await callQueue(now);
  const operations = await Promise.all(leads.map(l=>dealOperations(l.id,now)));
  const buyers = await allBuyerRecords(db,now);
  const jobs = (await db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt)).limit(30)).map(jobRecord);
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
      actions.push({
        id: `DISCOVERY_REVIEW:${candidate.id}`,
        category: "DISCOVERY_REVIEW",
        priority: 45 + Math.round(candidate.score / 5),
        title: `Review ${candidate.property.address}`,
        reason: `${candidate.score}/100 · ${Math.round(candidate.confidence * 100)}% evidence confidence. ${candidate.reason}`,
        cta: candidate.canPromote ? "Review promotion" : "Review evidence",
        leadId: null,
        href: `/sources?discovery=${candidate.id}`,
        dueAt: null,
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
    actions.push({id:`BUYER_VERIFICATION:${b.id}`,category:"BUYER_VERIFICATION",priority:b.approvalStatus==="REVERIFICATION_REQUIRED"?92:60,
      title:`${b.approvalStatus==="REVERIFICATION_REQUIRED"?"Reverify":"Qualify"} ${b.name}`,reason:(b.qualificationBlockers??[]).join("; ") || "Current buying and structured criteria require reviewed dated evidence; discovery is not approval.",
      cta:"Review buyer evidence",leadId:null,href:`/buyers/${b.id}`,dueAt:b.validUntil??null});
  }
  if (["OWNER","ANALYST"].includes(role)) {
    const representedDeals = new Set(actions.flatMap((action) => action.leadId ? [action.leadId] : []));
    for (const j of jobs.filter(j=>j.state==="FAILED")) {
      if (j.leadId && representedDeals.has(j.leadId)) continue;
      actions.push({id:`WORKER:${j.id}`,category:"WORKER",priority:70,title:`Review failed ${j.kind.toLowerCase().replace(/_/g," ")} job`,
        reason:j.message,cta:"Inspect worker activity",leadId:j.leadId,href:"/workers",dueAt:null});
    }
  }
  return GetCommandCenterResponse.parse({
    generatedAt:now.toISOString(),deals,calls,operations,buyers,jobs,
    actions:actions.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)),
    opportunities:strongestOpportunities(deals),
    propertyDiscoveries,
  });
}