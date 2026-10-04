import { callReadyBlockers } from "./workflow";
import { type Analysis, type CallBrief, type Intelligence, type Lead, type Offer } from "./types";

export function buildCallBrief(lead: Lead, intelligence: Intelligence[], analysis: Analysis, authorizedOffer: Offer|null = null, now = new Date()): CallBrief {
  if (authorizedOffer && (!["AUTHORIZED","COMMUNICATED"].includes(authorizedOffer.effectiveStatus)
    || !authorizedOffer.expiresAt || !Number.isFinite(Date.parse(authorizedOffer.expiresAt))
    || Date.parse(authorizedOffer.expiresAt) <= now.getTime() || callReadyBlockers(lead,analysis,now).length)) authorizedOffer = null;
  const questions = [
    "What would make selling the property a good outcome for you?",
    "What repairs or issues should we know about?",
    "Who else needs to agree to the sale?",
    "What timing works best, and how flexible is your price?",
    ...intelligence.flatMap(e => e.question?.trim() ? [e.question.trim()] : []),
  ];
  return {
    lead, intelligence, analysis, authorizedOffer,
    objective: ["CONVERSATION","OFFER_READY","OFFER_SENT","NEGOTIATING"].includes(lead.stage) ? "Continue the seller conversation, confirm unresolved points and agree on the next step." : "Build rapport, understand the seller's needs and verify condition, authority, price and timing.",
    questions: [...new Set(questions)],
    actions: [...new Set([lead.nextAction, ...intelligence.flatMap(e => e.action?.trim() ? [e.action.trim()] : [])])],
    boundaries: authorizedOffer
      ? `Owner-approved proposal: $${authorizedOffer.amount.toLocaleString()}, earnest money $${authorizedOffer.earnestMoney.toLocaleString()}, ${authorizedOffer.closingDays}-day closing target. Approved acquisition ceiling $${authorizedOffer.maximumApprovedAcquisitionPrice?.toLocaleString()}; expires ${authorizedOffer.expiresAt}. Only these exact terms are authorized: ${authorizedOffer.contingencies}. Changes need a new approved draft. This is not an executed contract or title clearance. Communication is recorded manually, never automatically sent.`
      : `Research-only opening range $${analysis.openingLow.toLocaleString()}–$${analysis.openingHigh.toLocaleString()}; calculated conservative ceiling $${analysis.mao.toLocaleString()}. No price is authorized. Obtain current owner approval before communicating an offer. A calculation is not permission, title clearance or a contract.`,
  };
}
export function prioritizeCallQueue(items: CallBrief[], now: Date): CallBrief[] {
  const urgency = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  return items.filter(b =>
    ["CALL_READY","CONTACTED","CONVERSATION","OFFER_READY","OFFER_SENT","NEGOTIATING","CONTRACT_PENDING"].includes(b.lead.stage) &&
    !callReadyBlockers(b.lead, b.analysis, now).length &&
    (!b.lead.followUpAt || Date.parse(b.lead.followUpAt) <= now.getTime()),
  ).sort((a,b) => {
    const dueA = a.lead.followUpAt ? Date.parse(a.lead.followUpAt) : Infinity;
    const dueB = b.lead.followUpAt ? Date.parse(b.lead.followUpAt) : Infinity;
    return (dueA === dueB ? 0 : dueA - dueB) ||
      urgency[b.lead.urgency ?? "UNKNOWN"] - urgency[a.lead.urgency ?? "UNKNOWN"] ||
      (b.analysis.classification === "STRONG" ? 1 : 0) - (a.analysis.classification === "STRONG" ? 1 : 0) ||
      a.lead.createdAt.localeCompare(b.lead.createdAt) || a.lead.id.localeCompare(b.lead.id);
  });
}