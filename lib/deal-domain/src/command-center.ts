import type { z } from "zod";
import type { GetCommandCenterResponse } from "@workspace/api-zod";
import type { LeadDetail, CallBrief } from "./types";
import { callReadyBlockers } from "./workflow";

export type CommandAction = z.infer<typeof GetCommandCenterResponse>["actions"][number];

/** A composition of existing domain state, never a second source of deal truth. */
export function dealActions(deals: LeadDetail[], calls: CallBrief[], role: string, now: Date): CommandAction[] {
  const research = ["OWNER","ANALYST"].includes(role);
  const operate = ["OWNER","OPERATOR"].includes(role);
  const callIds = new Set(calls.map(c => c.lead.id));
  const actions: CommandAction[] = [];
  for (const detail of deals) {
    const {lead, analysis, offers} = detail;
    if (["CLOSED","DEAD_DEAL"].includes(lead.stage)) continue;
    const add = (category: CommandAction["category"], priority: number, title: string, reason: string, cta: string, work: string) =>
      actions.push({id:`${category}:${lead.id}`,category,priority,title,reason,leadId:lead.id,href:`/deals/${lead.id}?work=${work}`,cta,dueAt:lead.followUpAt});
    const due = !!lead.followUpAt && Date.parse(lead.followUpAt) <= now.getTime();
    if (operate && due && ["CONTRACT_PENDING","UNDER_CONTRACT","BUYER_MATCHED","BUYER_INTERESTED","BUYER_COMMITTED","CLOSING"].includes(lead.stage)) {
      add("FOLLOW_UP",100,`Coordinate closing with ${lead.sellerName}`,
        `${lead.nextAction} Record the conversation and next follow-up; preserve the signed agreement and existing price boundaries.`,
        "Log coordination","call");
    }
    if (operate && callIds.has(lead.id)) {
      add(due?"FOLLOW_UP":"CALL",due?100:75,`${due?"Follow up with":"Call"} ${lead.sellerName}`,
        `${lead.nextAction} ${analysis?.classification === "STRONG" ? "Conservative economics classify this as STRONG." : "Review the seller situation and current offer boundaries."}`,
        "Open call brief","call");
    }
    if (role === "OWNER" && offers.some(o => o.effectiveStatus === "DRAFT")) {
      add("OFFER_APPROVAL",95,`Review offer for ${lead.sellerName}`,
        "An immutable proposal is waiting for owner review. Authority evidence, current underwriting and exact terms must pass before authorization.",
        "Review proposal","offers");
    }
    if (operate && lead.stage === "NEGOTIATING" && !callIds.has(lead.id)) {
      add("NEGOTIATION",due?98:65,`Continue negotiation: ${lead.sellerName}`,
        `${lead.nextAction}${lead.followUpAt ? " Respect the scheduled follow-up; changing terms requires new approval." : ""}`,
        "Review negotiation","offers");
    }
    if (research && ["DISCOVERED","ENRICHING","ANALYZED","STRONG","NEGOTIABLE","PASS"].includes(lead.stage)) {
      const ready = !callReadyBlockers(lead,analysis,now).length;
      add("RESEARCH",ready?80:analysis?.classification==="PASS"?15:55,
        ready?`Prepare ${lead.sellerName} for Call Next`:`Resolve research: ${lead.address}`,
        ready?"Underwriting and contact gates passed. Confirm the next action and mark the deal call-ready.":
          (analysis?.blockers.length?analysis.blockers.join("; "):lead.nextAction),
        ready?"Make call-ready":"Open deal workspace",ready?"stage":"uw");
    }
  }
  return actions.sort((a,b) => b.priority-a.priority || a.id.localeCompare(b.id));
}

export function strongestOpportunities(deals: LeadDetail[]) {
  return deals.filter(d => !["DEAD_DEAL","CLOSED"].includes(d.lead.stage) && ["STRONG","NEGOTIABLE"].includes(d.analysis?.classification ?? ""))
    .sort((a,b) => (b.analysis?.classification==="STRONG"?1:0)-(a.analysis?.classification==="STRONG"?1:0) ||
      (b.analysis?.spreadAtAsking ?? -Infinity)-(a.analysis?.spreadAtAsking ?? -Infinity) || a.lead.id.localeCompare(b.lead.id));
}