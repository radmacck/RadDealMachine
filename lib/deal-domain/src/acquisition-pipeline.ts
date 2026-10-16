export const ACQUISITION_PIPELINE_STAGES = [
  "DISCOVERED", "NORMALIZED", "QUALIFIED_FOR_RESEARCH", "CONTACT_ROUTE_RESEARCHED",
  "CALL_READY", "CONTACTED", "SELLER_QUALIFIED", "UNDERWRITING_READY", "OFFER_READY",
  "CLOSED", "LOST", "NURTURE",
] as const;
export type AcquisitionPipelineStage = typeof ACQUISITION_PIPELINE_STAGES[number];

export type AcquisitionStageEvidence = {
  discovered: boolean;
  normalized: boolean;
  qualifiedForResearch: boolean;
  contactRouteResearched: boolean;
  callReady: boolean;
  humanCallOutcome: "CONNECTED" | "NO_ANSWER" | "VOICEMAIL" | "BUSY" | "NOT_INTERESTED" | null;
  nurtureFollowUpValid: boolean;
  sellerQualified: boolean;
  underwritingReady: boolean;
  offerReady: boolean;
  terminal: "CLOSED" | "LOST" | "NURTURE" | null;
};

export function deriveAcquisitionPipelineStage(evidence: AcquisitionStageEvidence): AcquisitionPipelineStage {
  if (evidence.terminal) return evidence.terminal;
  if (evidence.offerReady) return "OFFER_READY";
  if (evidence.underwritingReady) return "UNDERWRITING_READY";
  if (evidence.sellerQualified) return "SELLER_QUALIFIED";
  if (evidence.humanCallOutcome) {
    if (evidence.humanCallOutcome === "NOT_INTERESTED") return "LOST";
    if (["NO_ANSWER", "VOICEMAIL", "BUSY"].includes(evidence.humanCallOutcome)) {
      return evidence.nurtureFollowUpValid ? "NURTURE" : "CONTACTED";
    }
    return "CONTACTED";
  }
  if (evidence.callReady) return "CALL_READY";
  if (evidence.contactRouteResearched) return "CONTACT_ROUTE_RESEARCHED";
  if (evidence.qualifiedForResearch) return "QUALIFIED_FOR_RESEARCH";
  if (evidence.normalized) return "NORMALIZED";
  return "DISCOVERED";
}

export const ACQUISITION_STAGE_ENTRY_EVIDENCE: Record<AcquisitionPipelineStage, string> = {
  DISCOVERED: "Persisted raw property observation with source provenance.",
  NORMALIZED: "Stable property identity and normalized address/market fields are present.",
  QUALIFIED_FOR_RESEARCH: "Human-reviewed relevance qualification is persisted.",
  CONTACT_ROUTE_RESEARCHED: "A contact-research case records sources, observation time, identity, permission, freshness and gaps; a route may still be blocked.",
  CALL_READY: "The property contactability gate and current underwriting/call-readiness checks pass.",
  CONTACTED: "A human-entered call outcome is persisted; no attempt alone implies seller contact.",
  SELLER_QUALIFIED: "A human-entered CONNECTED outcome includes at least two seller-answer fields; answers remain seller-reported, not verified.",
  UNDERWRITING_READY: "A current deterministic underwriting snapshot is less than seven days old and has no blockers.",
  OFFER_READY: "The current offer-ready stage has a fresh blocker-free underwriting snapshot; this is not proof an offer was communicated.",
  CLOSED: "An owner-recorded, evidenced closing outcome is persisted.",
  LOST: "A human-recorded decline, pass, or documented terminal loss is persisted.",
  NURTURE: "A human-entered no-answer outcome has a persisted future follow-up date.",
};

export const ACQUISITION_STAGE_EXIT_EVIDENCE: Record<AcquisitionPipelineStage, string> = {
  DISCOVERED: "Stable property identity and normalized address/market fields are persisted.",
  NORMALIZED: "A human reviewer records relevance qualification or an explicit loss disposition.",
  QUALIFIED_FOR_RESEARCH: "A contact-research case with source, timestamp, identity, permission and unresolved gaps is persisted.",
  CONTACT_ROUTE_RESEARCHED: "The contactability gate and current underwriting permit CALL_READY, or a human records a pass.",
  CALL_READY: "A human-entered call outcome is persisted, or new evidence blocks readiness.",
  CONTACTED: "A connected seller response with qualifying answers, an explicit nurture follow-up, or a human-recorded loss is persisted.",
  SELLER_QUALIFIED: "Fresh deterministic underwriting is saved, or contradictory evidence sends the record back for review.",
  UNDERWRITING_READY: "A current evidence-backed offer draft becomes ready, or changed evidence invalidates the snapshot.",
  OFFER_READY: "The deal is evidenced closed/lost, or material changes make underwriting/offer evidence stale.",
  CLOSED: "Terminal; correction requires a separately audited outcome-reconciliation action.",
  LOST: "Terminal; reopening requires an explicit human-reviewed restoration with reason.",
  NURTURE: "A new human-entered call outcome or explicit human disposition changes the next stage.",
};

export function deriveAcquisitionPipelineCounts(stages: readonly AcquisitionPipelineStage[]) {
  return ACQUISITION_PIPELINE_STAGES.map(stage => ({ stage, count: stages.filter(value => value === stage).length }));
}
