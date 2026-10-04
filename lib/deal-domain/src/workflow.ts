import { DomainError, type Analysis, type Lead, type Stage, type TransitionInput } from "./types";

export const DEAL_PATH: Stage[] = [
  "DISCOVERED","ENRICHING","ANALYZED","STRONG","NEGOTIABLE","PASS","CALL_READY",
  "CONTACTED","CONVERSATION","OFFER_READY","OFFER_SENT","NEGOTIATING",
  "CONTRACT_PENDING","UNDER_CONTRACT","BUYER_MATCHED","BUYER_INTERESTED",
  "BUYER_COMMITTED","CLOSING","CLOSED","DEAD_DEAL",
];

// Downstream states exist as a domain contract, NOT as implemented transaction workflows.
const manualEdges: Partial<Record<Stage, Stage[]>> = {
  DISCOVERED: ["ENRICHING", "DEAD_DEAL"],
  ENRICHING: ["DEAD_DEAL"],
  ANALYZED: ["DEAD_DEAL"],
  STRONG: ["CALL_READY", "ENRICHING", "DEAD_DEAL"],
  NEGOTIABLE: ["CALL_READY", "ENRICHING", "DEAD_DEAL"],
  PASS: ["ENRICHING", "DEAD_DEAL"],
  CALL_READY: ["CONTACTED", "ENRICHING", "DEAD_DEAL"],
  CONTACTED: ["CONVERSATION", "ENRICHING", "DEAD_DEAL"],
  CONVERSATION: ["ENRICHING", "DEAD_DEAL"],
  OFFER_READY: ["ENRICHING", "DEAD_DEAL"],
  OFFER_SENT: ["NEGOTIATING","ENRICHING","DEAD_DEAL"],
  NEGOTIATING: ["ENRICHING","DEAD_DEAL"],
};

export function callReadyBlockers(lead: Lead, analysis: Analysis | null, now: Date): string[] {
  const errors: string[] = [];
  if (!analysis || !["STRONG","NEGOTIABLE"].includes(analysis.classification)) errors.push("Need complete STRONG or NEGOTIABLE analysis");
  if (!lead.sellerPhone?.trim()) errors.push("Seller phone is required");
  if (analysis) {
    const age = now.getTime() - Date.parse(analysis.calculatedAt);
    if (!Number.isFinite(age) || age < 0) errors.push("Analysis has an invalid or future calculation timestamp; refresh underwriting");
    else if (age >= 7 * 86_400_000) errors.push("Analysis is 7 days old or older; refresh underwriting");
  }
  if (analysis?.blockers.length) errors.push(...analysis.blockers);
  return errors;
}
export function allowedTransitions(lead: Lead, analysis: Analysis | null, now: Date): Stage[] {
  return (manualEdges[lead.stage] ?? []).filter(s => s !== "CALL_READY" || !callReadyBlockers(lead,analysis,now).length);
}
export function validateTransition(lead: Lead, analysis: Analysis | null, input: TransitionInput, now: Date): void {
  if (!input.reason.trim() || !input.nextAction.trim()) throw new DomainError("Every transition needs a reason and next action.");
  if (!allowedTransitions(lead, analysis, now).includes(input.to)) {
    const explanation = input.to === "CALL_READY" ? callReadyBlockers(lead,analysis,now).join("; ") : "";
    throw new DomainError(explanation || `Transition ${lead.stage} → ${input.to} is not available in the implemented seller slice.`);
  }
}