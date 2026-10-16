export type OfferReadinessKey =
  | "PROPERTY_IDENTITY" | "SELLER_AUTHORITY" | "CONTACTABILITY" | "COMPS_ARV"
  | "REPAIR_ASSUMPTIONS" | "TRANSACTION_COSTS" | "DETERMINISTIC_MAO"
  | "LEGAL_STRATEGY" | "CURRENT_APPROVAL";
export type ReadinessState = "READY" | "REVIEW" | "BLOCKED";
export type CriterionAssessment = {
  state: ReadinessState;
  evidence: string[];
  missingEvidence: string[];
  remedy: string;
};
export type OfferReadinessInput = Record<OfferReadinessKey, CriterionAssessment> &
  { hardStopKeys: OfferReadinessKey[] };
export type OfferReadinessCriterion = CriterionAssessment & {
  key: OfferReadinessKey;
  weight: number;
  points: number;
  hardStop: boolean;
};
const WEIGHTS: Record<OfferReadinessKey, number> = {
  PROPERTY_IDENTITY: 10, SELLER_AUTHORITY: 15, CONTACTABILITY: 10, COMPS_ARV: 15,
  REPAIR_ASSUMPTIONS: 10, TRANSACTION_COSTS: 10, DETERMINISTIC_MAO: 15,
  LEGAL_STRATEGY: 10, CURRENT_APPROVAL: 5,
};
export function buildOfferReadinessScorecard(input: OfferReadinessInput) {
  const criteria = (Object.keys(WEIGHTS) as OfferReadinessKey[]).map(key => {
    const assessment = input[key];
    const points = assessment.state === "READY" ? WEIGHTS[key]
      : assessment.state === "REVIEW" ? WEIGHTS[key] / 2 : 0;
    return { key, ...assessment, weight: WEIGHTS[key], points, hardStop: input.hardStopKeys.includes(key) && assessment.state !== "READY" };
  });
  const score = Math.round(criteria.reduce((sum, item) => sum + item.points, 0));
  const hardStops = criteria.filter(item => item.hardStop);
  return {
    score, maximumScore: 100, criteria, hardStops,
    status: hardStops.length ? "BLOCKED" as const : score === 100 ? "READY_FOR_HUMAN_REVIEW" as const : "REVIEW_REQUIRED" as const,
    authorizesOffer: false as const,
  };
}
