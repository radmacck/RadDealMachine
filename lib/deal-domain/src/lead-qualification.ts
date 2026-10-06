import { buyerQualification } from "./buyer-qualification";
import type { Buyer } from "./buyers";

export const PROPERTY_SIGNAL_KEYS = [
  "ENTITY_OWNER",
  "LONG_TERM_HOLD",
  "REPORTED_POOR_CONDITION",
  "OPEN_CODE_VIOLATION",
  "UNSAFE_BUILDING_RECORD",
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
  OPEN_CODE_VIOLATION: "CONDITION",
  UNSAFE_BUILDING_RECORD: "DISTRESS",
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
  OPEN_CODE_VIOLATION: 18,
  UNSAFE_BUILDING_RECORD: 40,
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
  for (const [key, points] of Object.entries(defaultPoints) as Array<[PropertySignalKey, number]>) {
    if (!rules.has(key)) rules.set(key, { key, points, enabled: true });
  }
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

export type BuyerDemandSubject = {
  state: string;
  county: string;
  city: string;
  zip: string;
  propertyType: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
};

export type BuyerDemandEvidence = {
  buyerId: string;
  buyerVersion: number;
  criteriaEvidenceAt: string;
  buyingEvidenceAt: string;
  identityVerifiedAt: string;
  validUntil: string;
  reviewerConfidence: number;
  reason: string;
};

export type BuyerDemandFit = {
  status: "ALIGNED_ON_KNOWN_FIELDS" | "NO_VERIFIED_DEMAND";
  alignedBuyerCount: number;
  currentQualifiedBuyerCount: number;
  unqualifiedBuyerCount: number;
  excludedForKnownCriteriaMismatch: number;
  priorityBonus: number;
  reason: string;
  missingInformation: string[];
  evidence: BuyerDemandEvidence[];
  inputKey: string;
};

/**
 * Early demand coverage is only a ranking signal. It is not a full deal match,
 * does not satisfy seller qualification, and cannot authorize distribution.
 */
export function evaluateCurrentBuyerDemand(
  subject: BuyerDemandSubject,
  buyers: Buyer[],
  now: Date,
): BuyerDemandFit {
  const normalized = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+county$/, "");
  const qualified = buyers.filter(buyer => buyerQualification(buyer, now).approvalStatus === "APPROVED");
  const evidence: BuyerDemandEvidence[] = [];
  let excludedForKnownCriteriaMismatch = 0;

  for (const buyer of qualified) {
    const criteria = buyer.criteria;
    if (!criteria) {
      excludedForKnownCriteriaMismatch++;
      continue;
    }
    const mismatches: string[] = [];
    if (!criteria.states.some(value => normalized(value) === normalized(subject.state))) {
      mismatches.push("state");
    }
    const hasMarketRestriction = criteria.cities.length > 0 || criteria.zipCodes.length > 0;
    if (hasMarketRestriction
      && !criteria.cities.some(value => normalized(value) === normalized(subject.city))
      && !criteria.zipCodes.some(value => value.trim() === subject.zip.trim().slice(0, 5))) {
      mismatches.push("city/ZIP");
    }
    if (criteria.counties?.length && !criteria.counties.some(value => normalized(value) === normalized(subject.county))) {
      mismatches.push("county");
    }
    if ((criteria.excludedCounties ?? []).some(value => normalized(value) === normalized(subject.county))) {
      mismatches.push("excluded county");
    }
    if ((criteria.excludedCities ?? []).some(value => normalized(value) === normalized(subject.city))) {
      mismatches.push("excluded city");
    }
    if ((criteria.excludedZipCodes ?? []).some(value => value.trim() === subject.zip.trim().slice(0, 5))) {
      mismatches.push("excluded ZIP");
    }
    if (!criteria.propertyTypes.some(value => value === subject.propertyType)) {
      mismatches.push("property type");
    }
    if (subject.sqft != null && (subject.sqft < criteria.minSqft || subject.sqft > criteria.maxSqft)) {
      mismatches.push("square footage");
    }
    if (subject.beds != null && (subject.beds < criteria.minBeds ||
      (criteria.maxBeds != null && subject.beds > criteria.maxBeds))) {
      mismatches.push("bedrooms");
    }
    if (subject.baths != null && (subject.baths < (criteria.minBaths ?? 0) ||
      (criteria.maxBaths != null && subject.baths > criteria.maxBaths))) {
      mismatches.push("bathrooms");
    }
    if (mismatches.length) {
      excludedForKnownCriteriaMismatch++;
      continue;
    }
    evidence.push({
      buyerId: buyer.id,
      buyerVersion: buyer.version,
      criteriaEvidenceAt: buyer.buyingEvidenceAt!,
      buyingEvidenceAt: buyer.buyingEvidenceAt!,
      identityVerifiedAt: buyer.verifiedAt!,
      validUntil: buyer.validUntil!,
      reviewerConfidence: buyer.confidence ?? 0,
      reason: "Owner-approved current buyer; verified criteria cover the known property market, type, and any recorded size/bed/bath fields. This is not a deal-level match.",
    });
  }

  const alignedBuyerCount = evidence.length;
  const missingInformation = [
    ...(subject.sqft == null ? ["Square footage is not reported by this property record."] : []),
    ...(subject.beds == null ? ["Bedroom count is not reported by this property record."] : []),
    ...(subject.baths == null ? ["Bathroom count is not reported by this property record."] : []),
    "Unit count is not established by this source.",
    "Asking/acquisition price, ARV, repairs, spread, and closing deadline are not available until underwriting and contract review.",
    "Buyer demand coverage does not replace deal-level funding, capacity, deadline, or document checks.",
  ];
  const reason = alignedBuyerCount
    ? `${alignedBuyerCount} owner-approved, current buyer profile(s) fit the known market and property attributes; price, condition, units, ARV, and deal-level capacity remain untested.`
    : "No owner-approved, current buyer profile fits the known market and property attributes. This does not disqualify an otherwise strong seller opportunity.";
  const inputKey = JSON.stringify({
    currentQualifiedBuyerCount: qualified.length,
    unqualifiedBuyerCount: buyers.length - qualified.length,
    excludedForKnownCriteriaMismatch,
    evidence,
  });
  return {
    status: alignedBuyerCount ? "ALIGNED_ON_KNOWN_FIELDS" : "NO_VERIFIED_DEMAND",
    alignedBuyerCount,
    currentQualifiedBuyerCount: qualified.length,
    unqualifiedBuyerCount: buyers.length - qualified.length,
    excludedForKnownCriteriaMismatch,
    priorityBonus: Math.min(15, alignedBuyerCount * 5),
    reason,
    missingInformation,
    evidence,
    inputKey,
  };
}
