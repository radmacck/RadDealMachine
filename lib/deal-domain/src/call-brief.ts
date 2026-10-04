import { callReadyBlockers } from "./workflow";
import { type Analysis, type CallBrief, type Intelligence, type Lead } from "./types";

export function buildCallBrief(lead: Lead, intelligence: Intelligence[], analysis: Analysis): CallBrief {
  const questions = [
    "What would make selling the property a good outcome for you?",
    "What repairs or issues should we know about?",
    "Who else needs to agree to the sale?",
    "What timing works best, and how flexible is your price?",
    ...intelligence.flatMap(e => e.question?.trim() ? [e.question.trim()] : []),
  ];
  return {
    lead, intelligence, analysis,
    objective: lead.stage === "CONVERSATION" ? "Continue the seller conversation, confirm unresolved points and agree on the next step." : "Build rapport, understand the seller's needs and verify condition, authority, price and timing.",
    questions: [...new Set(questions)],
    actions: [...new Set([lead.nextAction, ...intelligence.flatMap(e => e.action?.trim() ? [e.action.trim()] : [])])],
    boundaries: `Research-only opening range $${analysis.openingLow.toLocaleString()}–$${analysis.openingHigh.toLocaleString()}; calculated conservative ceiling $${analysis.mao.toLocaleString()}. No price is authorized. Do not promise or release an offer; owner approval and offer-release workflow are not implemented yet.`,
  };
}
export function prioritizeCallQueue(items: CallBrief[], now: Date): CallBrief[] {
  const urgency = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  return items.filter(b =>
    ["CALL_READY","CONTACTED","CONVERSATION"].includes(b.lead.stage) &&
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