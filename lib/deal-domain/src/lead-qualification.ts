export const PROPERTY_SIGNAL_KEYS = [
  "ENTITY_OWNER",
  "LONG_TERM_HOLD",
  "REPORTED_POOR_CONDITION",
  "SELLER_MOTIVATION",
  "TAX_DELINQUENCY",
  "FORECLOSURE",
  "PROBATE",
  "ABSENTEE_OWNER",
  "STALE_LISTING",
  "REPEATED_PRICE_REDUCTION",
  "BELOW_MARKET",
  "VACANCY",
  "EQUITY_OPPORTUNITY",
  "MARKET_FIT",
] as const;

export type PropertySignalKey = typeof PROPERTY_SIGNAL_KEYS[number];
export type PropertySignalGroup =
  | "OWNERSHIP_CONTEXT"
  | "CONDITION"
  | "MOTIVATION"
  | "DISTRESS"
  | "LISTING_PRESSURE"
  | "VACANCY"
  | "FINANCIAL_OPPORTUNITY"
  | "MARKET_FIT";
export type EvidenceClassification = "VERIFIED" | "OBSERVED" | "INDICATED" | "AI_HYPOTHESIS";
export type PropertyDiscoveryStatus =
  | "DISCOVERED_PROPERTY"
  | "RELEVANT_CANDIDATE"
  | "QUALIFIED_LEAD"
  | "CALL_READY"
  | "DISQUALIFIED";

export const PROPERTY_SIGNAL_GROUP_BY_KEY: Record<PropertySignalKey, PropertySignalGroup> = {
  ENTITY_OWNER: "OWNERSHIP_CONTEXT",
  LONG_TERM_HOLD: "OWNERSHIP_CONTEXT",
  REPORTED_POOR_CONDITION: "CONDITION",
  SELLER_MOTIVATION: "MOTIVATION",
  TAX_DELINQUENCY: "DISTRESS",
  FORECLOSURE: "DISTRESS",
  PROBATE: "DISTRESS",
  ABSENTEE_OWNER: "OWNERSHIP_CONTEXT",
  STALE_LISTING: "LISTING_PRESSURE",
  REPEATED_PRICE_REDUCTION: "LISTING_PRESSURE",
  BELOW_MARKET: "FINANCIAL_OPPORTUNITY",
  VACANCY: "VACANCY",
  EQUITY_OPPORTUNITY: "FINANCIAL_OPPORTUNITY",
  MARKET_FIT: "MARKET_FIT",
};

export interface PropertyRelevanceSignal {
  id: string;
  key: PropertySignalKey;
  group: PropertySignalGroup;
  classification: EvidenceClassification;
  sourceType: "PUBLIC_RECORD" | "PERMITTED_LISTING" | "SELLER" | "INSPECTION" | "PUBLIC_PAGE" | "ANALYST" | "MODEL";
  statement: string;
  source: string;
  sourceUrl: string | null;
  evidenceRef: string | null;
  capturedAt: string;
  confidence: number;
}

export interface PropertySignalRule {
  key: PropertySignalKey;
  points: number;
  enabled: boolean;
}

export interface PropertyQualificationCriteria {
  marketKey: string;
  version: number;
  candidateThreshold: number;
  qualifiedLeadThreshold: number;
  minimumIndependentSignalGroups: number;
  requiredLeadGroupAnyOf: PropertySignalGroup[];
  longHoldYears: number;
  signalRules: PropertySignalRule[];
}

export interface QualificationEvaluation {
  score: number;
  confidence: number;
  status: "DISCOVERED_PROPERTY" | "RELEVANT_CANDIDATE";
  reason: string;
  missingInformation: string[];
  nextAction: string;
  canPromote: boolean;
  promotionBlockers: string[];
  scoredSignals: Array<PropertyRelevanceSignal & { points: number }>;
}

const classificationFactor: Record<EvidenceClassification, number> = {
  VERIFIED: 1,
  OBSERVED: 0.8,
  INDICATED: 0.55,
  AI_HYPOTHESIS: 0,
};

const defaultPoints: Record<PropertySignalKey, number> = {
  ENTITY_OWNER: 8,
  LONG_TERM_HOLD: 8,
  REPORTED_POOR_CONDITION: 12,
  SELLER_MOTIVATION: 35,
  TAX_DELINQUENCY: 35,
  FORECLOSURE: 40,
  PROBATE: 32,
  ABSENTEE_OWNER: 10,
  STALE_LISTING: 16,
  REPEATED_PRICE_REDUCTION: 20,
  BELOW_MARKET: 18,
  VACANCY: 24,
  EQUITY_OPPORTUNITY: 24,
  MARKET_FIT: 8,
};

export const DEFAULT_PROPERTY_QUALIFICATION_CRITERIA: PropertyQualificationCriteria = {
  marketKey: "PHILADELPHIA_PA",
  version: 1,
  candidateThreshold: 6,
  qualifiedLeadThreshold: 35,
  minimumIndependentSignalGroups: 2,
  requiredLeadGroupAnyOf: ["MOTIVATION", "DISTRESS", "LISTING_PRESSURE", "VACANCY"],
  longHoldYears: 10,
  signalRules: PROPERTY_SIGNAL_KEYS.map((key) => ({
    key,
    points: defaultPoints[key],
    enabled: true,
  })),
};

const groupLabel = (group: PropertySignalGroup) => group.replaceAll("_", " ").toLowerCase();
const classificationLabel = (classification: EvidenceClassification) => classification.replaceAll("_", " ").toLowerCase();

export function evaluatePropertyRelevance(
  signals: PropertyRelevanceSignal[],
  criteria: PropertyQualificationCriteria,
): QualificationEvaluation {
  const rules = new Map(criteria.signalRules.map((rule) => [rule.key, rule]));
  const seenEvidence = new Set<string>();
  const scoredSignals = signals.map((signal) => {
    const rule = rules.get(signal.key);
    const evidenceKey = `${signal.key}|${signal.evidenceRef ?? signal.sourceUrl ?? signal.statement.trim().toLowerCase()}`;
    const duplicate = seenEvidence.has(evidenceKey);
    seenEvidence.add(evidenceKey);
    const contribution = !duplicate && rule?.enabled
      ? Math.round(rule.points * classificationFactor[signal.classification] * signal.confidence)
      : 0;
    return { ...signal, points: contribution };
  });
  const usable = scoredSignals.filter((signal) => signal.points > 0);
  const score = Math.min(100, usable.reduce((total, signal) => total + signal.points, 0));
  const confidence = usable.length
    ? Math.round((usable.reduce((total, signal) => total + signal.confidence * classificationFactor[signal.classification], 0) / usable.length) * 100) / 100
    : 0;
  const groupByEvidence = new Map<string, PropertySignalGroup>();
  for (const signal of usable) {
    const evidenceKey = signal.evidenceRef ?? signal.sourceUrl ?? `${signal.source}|${signal.statement.trim().toLowerCase()}`;
    if (!groupByEvidence.has(evidenceKey)) groupByEvidence.set(evidenceKey, signal.group);
  }
  const groups = new Set(groupByEvidence.values());
  const qualifiesAsCandidate = score >= criteria.candidateThreshold && usable.length > 0;
  const status = qualifiesAsCandidate ? "RELEVANT_CANDIDATE" : "DISCOVERED_PROPERTY";
  const strengthGroupPresent = criteria.requiredLeadGroupAnyOf.some((group) => groups.has(group));
  const promotionBlockers: string[] = [];
  if (score < criteria.qualifiedLeadThreshold) {
    promotionBlockers.push(`Relevance score ${score} is below the market threshold ${criteria.qualifiedLeadThreshold}.`);
  }
  if (groups.size < criteria.minimumIndependentSignalGroups) {
    promotionBlockers.push(`At least ${criteria.minimumIndependentSignalGroups} independent signal groups are required; ${groups.size} are supported.`);
  }
  if (!strengthGroupPresent) {
    promotionBlockers.push(`Add sourced motivation, distress, listing-pressure, or vacancy evidence before qualification.`);
  }
  const reason = usable.length
    ? `${status === "RELEVANT_CANDIDATE" ? "Candidate selected" : "Discovery retained"} from ${usable.length} scored signal${usable.length === 1 ? "" : "s"} across ${groups.size} independent group${groups.size === 1 ? "" : "s"} (${score}/100). ${usable.map((signal) => `${signal.statement} [${classificationLabel(signal.classification)}; ${signal.source}]`).join(" ")}`
    : "No sourced relevance signals are present. A public property record by itself is not a lead.";
  const missingInformation = [
    ...(signals.some((signal) => signal.classification === "AI_HYPOTHESIS")
      ? ["AI hypotheses are retained for review but add no qualification points; corroborate them with independent source-backed evidence."]
      : []),
    ...(!strengthGroupPresent ? ["No sourced seller-motivation, distress, listing-pressure, or vacancy signal is recorded."] : []),
    ...(!groups.has("CONDITION") ? ["Current property condition and repair scope are not established."] : []),
    ...(!groups.has("FINANCIAL_OPPORTUNITY") ? ["No market-supported equity/opportunity analysis is established; assessment is not ARV."] : []),
    "Actual seller identity, availability, contact permission, and signing authority remain unverified.",
    "Call readiness still requires the existing contact, underwriting, authority, and evidence gates.",
  ];
  const nextAction = status === "DISCOVERED_PROPERTY"
    ? "Review the source observations and add only evidence-backed relevance signals."
    : promotionBlockers.length
      ? "Resolve the listed evidence gaps; this candidate is not yet an active lead."
      : "Review the sourced relevance evidence and promote only if it represents a real acquisition opportunity.";
  return {
    score,
    confidence,
    status,
    reason,
    missingInformation: [...new Set(missingInformation)],
    nextAction,
    canPromote: status === "RELEVANT_CANDIDATE" && promotionBlockers.length === 0,
    promotionBlockers,
    scoredSignals,
  };
}
