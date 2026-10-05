import type { z } from "zod";
import type { GetCommandCenterResponse } from "@workspace/api-zod";
import type { DealWorkGuidance, LeadDetail, LeadDetailWithoutWorkGuidance } from "./types";
import { callReadyBlockers } from "./workflow";

export type CommandAction = z.infer<typeof GetCommandCenterResponse>["actions"][number];

const researchStages = new Set(["DISCOVERED","ENRICHING","ANALYZED","STRONG","NEGOTIABLE","PASS"]);
const sellerStages = new Set(["CALL_READY","CONTACTED","CONVERSATION","OFFER_READY","OFFER_SENT","NEGOTIATING"]);
const transactionStages = new Set(["CONTRACT_PENDING","UNDER_CONTRACT","BUYER_MATCHED","BUYER_INTERESTED","BUYER_COMMITTED","CLOSING"]);
const label = (value: string) => value.replaceAll("_"," ").toLowerCase();

/** One stage-specific guide composed from saved deal state and existing workflow records. */
export function buildDealWorkGuidance(
  detail: LeadDetailWithoutWorkGuidance,
  now: Date,
): DealWorkGuidance | null {
  const { lead, analysis, offers, intelligence, calls, allowedTransitions } = detail;
  if (["CLOSED","DEAD_DEAL"].includes(lead.stage)) return null;

  const nextAction = lead.nextAction.trim();
  const dueAt = lead.followUpAt ?? null;
  const dueTime = dueAt ? Date.parse(dueAt) : Number.NaN;
  const overdue = Number.isFinite(dueTime) && dueTime <= now.getTime();
  const make = (
    input: Omit<DealWorkGuidance, "dueAt" | "dueLabel"> & { dueAt?: string | null; dueLabel: string },
  ): DealWorkGuidance => ({ ...input, dueAt: input.dueAt ?? null });

  const draftOffer = offers.find((offer) => offer.effectiveStatus === "DRAFT");
  if (draftOffer) {
    return make({
      category:"OFFER_APPROVAL",priority:95,title:`Review the saved offer for ${lead.sellerName}`,
      href:`/deals/${lead.id}?work=offers`,cta:"Review offer terms",
      currentState:"An offer draft is saved and awaiting owner review.",
      responsibleRole:"OWNER",dueLabel:"No separate owner-review date is recorded.",
      knownFacts:[
        "A versioned offer draft exists.",
        "Saved underwriting and authority evidence remain separate from the offer itself.",
      ],
      missingFacts:draftOffer.blockers,
      why:"Exact commercial terms require current owner authority before they can be authorized or communicated.",
      systemCanDo:"The system can compare the saved terms with recorded authority and underwriting. It cannot authorize or send the offer.",
      humanMustDo:"Review the exact terms and evidence, then authorize or decline the draft.",
      requiredEvidence:draftOffer.blockers.length
        ? draftOffer.blockers
        : ["Current owner authority for the exact terms.","Current underwriting tied to the offer."],
      completionRecord:"Owner authorization or decline is versioned in offer history. Actual communication is recorded separately.",
      dueAt:null,
    });
  }

  const activeTransaction = transactionStages.has(lead.stage);
  const communicatedOffer = offers.some((offer) => offer.effectiveStatus === "COMMUNICATED");
  if (activeTransaction || (!researchStages.has(lead.stage) && communicatedOffer)) {
    const contractPending = lead.stage === "CONTRACT_PENDING" || communicatedOffer;
    const recordedEvidence = intelligence.slice(0,4).map((item) => {
      const statement = item.statement.length > 180 ? `${item.statement.slice(0,177)}…` : item.statement;
      return `${item.classification.replaceAll("_"," ").toLowerCase()} ${item.sourceType.replaceAll("_"," ").toLowerCase()} evidence — ${item.category}: ${statement}`;
    });
    return make({
      category:contractPending?"CONTRACT":lead.stage==="CLOSING"?"CLOSING":"BUYER_MATCH",
      priority:contractPending?88:82,
      title:nextAction || (contractPending ? "Review transaction documents and exact terms." : "Review the active transaction."),
      href:`/deals/${lead.id}?work=transaction`,cta:"Open transaction",
      currentState:activeTransaction ? `The deal is in ${label(lead.stage)}.` : "An owner-authorized offer was communicated; transaction preparation is next.",
      responsibleRole:"OWNER",
      dueLabel:"Contract deadline is shown in the Transaction panel.",
      knownFacts:[
        `Deal stage: ${label(lead.stage)}.`,
        communicatedOffer ? "An exact-term offer communication is recorded." : "Transaction details are managed separately from seller research.",
        ...recordedEvidence,
      ],
      missingFacts:[],
      why:"Buyer interest, commitment, external contract execution, and closing are separate recorded states.",
      systemCanDo:"The system can preserve approved terms and record entered evidence. It cannot sign documents, transfer title, release funds, or verify settlement on its own.",
      humanMustDo:nextAction || "Review the transaction record and confirm its next evidence-backed step.",
      requiredEvidence:["Use the Transaction panel to record the exact external document or milestone evidence required for the current state."],
      completionRecord:"Contract execution, buyer commitment, and closing milestones are saved as separate, attributed transaction events.",
      dueAt:null,
    });
  }

  if (researchStages.has(lead.stage)) {
    const blockers = callReadyBlockers(lead,analysis,now);
    const recordedEvidence = intelligence.slice(0,4).map((item) => {
      const statement = item.statement.length > 180 ? `${item.statement.slice(0,177)}…` : item.statement;
      return `${item.classification.replaceAll("_"," ").toLowerCase()} ${item.sourceType.replaceAll("_"," ").toLowerCase()} evidence — ${item.category}: ${statement}`;
    });
    const phoneMissing = blockers.some((item) => item.toLowerCase().includes("phone"));
    const canMarkCallReady = allowedTransitions.includes("CALL_READY") && blockers.length === 0;
    const work = phoneMissing ? "record" : !analysis ? "source" : canMarkCallReady ? "stage" : "uw";
    return make({
      category:"RESEARCH",priority:overdue?100:analysis?.classification==="PASS"?20:80,
      title:nextAction || "Record the next research step.",
      href:`/deals/${lead.id}?work=${work}`,
      cta:phoneMissing?"Add seller contact":"Open research",
      currentState:`The deal is in ${label(lead.stage)}.`,
      responsibleRole:"ANALYST",
      dueLabel:dueAt?"Scheduled follow-up":"No follow-up date recorded.",
      knownFacts:[
        ...(recordedEvidence.length ? recordedEvidence : ["No sourced property facts have been saved yet."]),
        analysis ? `Underwriting classification: ${analysis.classification}.` : "No current underwriting result is recorded.",
      ],
      missingFacts:blockers,
      why:"Call readiness depends on current, sourced evidence and a permitted seller contact route. Underwriting estimates never authorize a quoted price.",
      systemCanDo:"The system can retain sourced evidence, check readiness gates, and calculate scenarios. It cannot verify seller statements, contact the seller, or authorize a price.",
      humanMustDo:nextAction || (canMarkCallReady ? "Confirm call readiness and record the next seller action." : "Resolve the listed research gaps."),
      requiredEvidence:blockers.length
        ? blockers
        : ["Review current evidence and underwriting, then record the call-ready transition with its reason and next action."],
      completionRecord:"Evidence and underwriting saves are versioned; a lifecycle transition records the actor, reason, stage, and next action.",
      dueAt,
    });
  }

  if (sellerStages.has(lead.stage)) {
    const missingFacts: string[] = [];
    if (!lead.sellerPhone?.trim()) missingFacts.push("A seller phone number is not recorded.");
    if (["CONTACTED","CONVERSATION","NEGOTIATING"].includes(lead.stage) && !dueAt) {
      missingFacts.push("No future seller follow-up is recorded.");
    }
    const contactMissing = !lead.sellerPhone?.trim();
    const category = overdue ? "FOLLOW_UP" : lead.stage === "NEGOTIATING" ? "NEGOTIATION" : "CALL";
    return make({
      category,priority:overdue?100:category==="NEGOTIATION"?70:75,
      title:contactMissing?"Add a verified seller contact route":nextAction || "Record the seller's next step.",
      href:`/deals/${lead.id}?work=${contactMissing?"record":"call"}`,
      cta:contactMissing?"Open seller record":overdue?"Log follow-up":"Open seller call",
      currentState:`The deal is in ${label(lead.stage)}.`,
      responsibleRole:"OPERATOR",
      dueLabel:dueAt?"Seller follow-up":"Set a follow-up during the conversation.",
      knownFacts:[
        lead.sellerPhone?.trim()?"A seller phone route is recorded.":"No seller phone route is recorded.",
        `${calls.length} seller call record${calls.length===1?"":"s"} saved.`,
      ],
      missingFacts,
      why:"Seller outreach and follow-up must be recorded; a call does not change signed terms or authorize a new price.",
      systemCanDo:"The system can prepare the call brief and preserve offer boundaries. It cannot place the call or choose a seller term.",
      humanMustDo:contactMissing?"Add a verified, permitted contact route before outreach.":nextAction || "Record the actual conversation and the next follow-up.",
      requiredEvidence:contactMissing
        ? ["A verified, permitted seller contact route."]
        : ["Actual call outcome and notes.","The next action and a future follow-up date when the conversation remains open."],
      completionRecord:"The call record stores its outcome, notes, actor, time, next action, and follow-up date.",
      dueAt,
    });
  }
  return null;
}

/** A single principal deal action, backed by the work guide or a current transaction record. */
export function dealActions(
  deals: LeadDetail[],
  role: string,
  _now: Date,
  transactionLeadIds: Set<string> = new Set(),
): CommandAction[] {
  const actions: CommandAction[] = [];
  for (const detail of deals) {
    const guide = detail.workGuidance;
    if (!guide || transactionLeadIds.has(detail.lead.id)) continue;
    if (role !== "OWNER" && role !== guide.responsibleRole) continue;
    actions.push({
      id:`${guide.category}:${detail.lead.id}`,
      category:guide.category,
      priority:guide.priority,
      title:guide.title,
      reason:guide.why,
      leadId:detail.lead.id,
      href:guide.href,
      cta:guide.cta,
      dueAt:guide.dueAt,
      workGuidance:guide,
    });
  }
  return actions.sort((a,b) => b.priority-a.priority || a.id.localeCompare(b.id));
}

export function strongestOpportunities(deals: LeadDetail[]) {
  return deals.filter(d => !["DEAD_DEAL","CLOSED"].includes(d.lead.stage) && ["STRONG","NEGOTIABLE"].includes(d.analysis?.classification ?? ""))
    .sort((a,b) => (b.analysis?.classification==="STRONG"?1:0)-(a.analysis?.classification==="STRONG"?1:0) ||
      (b.analysis?.spreadAtAsking ?? -Infinity)-(a.analysis?.spreadAtAsking ?? -Infinity) || a.lead.id.localeCompare(b.lead.id));
}