import type { IntelligenceInput } from "./types";
import type { PropertyRelevanceSignal } from "./lead-qualification";

export type ListingRetentionPolicy =
  | "FULL_TEXT_PERMITTED"
  | "HASH_ONLY"
  | "DERIVED_ONLY"
  | "NOT_PERMITTED";

export interface ListingDescriptionObservation {
  sourceName: string;
  sourceRecordId: string;
  sourceUrl: string;
  capturedAt: string;
  description: string;
  retentionPolicy: ListingRetentionPolicy;
  contentDigest?: string;
}

export interface ListingDescriptionExtraction {
  status: "EXTRACTED" | "NO_SIGNALS" | "STALE_SOURCE" | "BLOCKED_BY_RETENTION";
  intelligence: IntelligenceInput[];
  relevanceSignals: PropertyRelevanceSignal[];
  contentDigest?: string;
}

const MAX_AGE_MS = 30 * 86_400_000;
const MAX_TEXT_LENGTH = 5_000;
const sha256 = /^[a-f0-9]{64}$/;

const listingRules = [
  { id: "roof-leak", pattern: /\b(?:roof leaks?|leaking roof)\b/i, category: "condition_roof", key: "REPORTED_POOR_CONDITION" as const, kind: "CONDITION" as const, question: "The listing mentions a roof leak—what is the current roof condition and repair history?" },
  { id: "roof-replacement", pattern: /\b(?:roof replacement|new roof (?:needed|required)|needs? a new roof)\b/i, category: "condition_roof", key: "REPORTED_POOR_CONDITION" as const, kind: "CONDITION" as const, question: "The listing mentions roof replacement—what is the age and current condition?" },
  { id: "foundation", pattern: /\b(?:foundation (?:crack|movement|settling|bowing)|structural (?:crack|movement))\b/i, category: "condition_foundation", key: "REPORTED_POOR_CONDITION" as const, kind: "CONDITION" as const, question: "The listing mentions a foundation or structural concern—has a qualified inspection evaluated it?" },
  { id: "water-intrusion", pattern: /\b(?:water damage|flood damage|water intrusion)\b/i, category: "condition_water", key: "REPORTED_POOR_CONDITION" as const, kind: "CONDITION" as const, question: "The listing mentions water damage—what was affected and has the source been repaired?" },
  { id: "hvac", pattern: /\b(?:hvac (?:not working|failed|needs? replacement)|furnace (?:not working|failed)|no heat|no air conditioning)\b/i, category: "condition_hvac", key: "REPORTED_POOR_CONDITION" as const, kind: "CONDITION" as const, question: "The listing mentions an HVAC issue—what equipment is present and what has been diagnosed?" },
  { id: "plumbing", pattern: /\b(?:plumbing leak|pipe (?:leak|burst)|burst pipe)\b/i, category: "condition_plumbing", key: "REPORTED_POOR_CONDITION" as const, kind: "CONDITION" as const, question: "The listing mentions a plumbing issue—what is the current status and repair history?" },
  { id: "electrical", pattern: /\b(?:rewire|knob[- ]and[- ]tube|outdated electrical|electrical panel (?:replacement|needs? replacement))\b/i, category: "condition_electrical", key: "REPORTED_POOR_CONDITION" as const, kind: "CONDITION" as const, question: "The listing mentions electrical work—what did a qualified electrician confirm?" },
  { id: "interior-finishes", pattern: /\b(?:dated (?:kitchen|bathroom|interior)|needs? updating|cosmetic repairs?)\b/i, category: "condition_interior", key: "REPORTED_POOR_CONDITION" as const, kind: "CONDITION" as const, question: "The listing describes dated or cosmetic areas—what work is actually needed?" },
  { id: "seller-motivation", pattern: /\b(?:motivated seller|must sell|seller relocating|owner relocating|estate sale|inherited property|bring all offers)\b/i, category: "listing_motivation_claim", key: "SELLER_MOTIVATION" as const, kind: "MOTIVATION" as const, question: "The listing uses motivation-related language—what is the seller's actual reason and timing?" },
  { id: "seller-urgency", pattern: /\b(?:must close by|close by .{1,30}|time[- ]sensitive|immediate sale|quick close)\b/i, category: "listing_urgency_claim", key: "SELLER_MOTIVATION" as const, kind: "MOTIVATION" as const, question: "The listing mentions a quick close—what is the actual deadline and what is driving it?" },
  { id: "upgrade-claim", pattern: /\b(?:new|updated|renovated|remodeled|replaced)\s+(?:roof|windows?|kitchen|bath(?:room)?|hvac|furnace|plumbing|electrical|flooring)\b/i, category: "listing_upgrade_claim", key: null, kind: "FEATURE" as const, question: "The listing describes an upgrade—when was it completed and what invoice, permit, or inspection supports it?" },
  { id: "feature-claim", pattern: /\b(?:finished basement|off[- ]street parking|garage|solar panels?|separate entrance|additional unit|in[- ]law suite)\b/i, category: "listing_feature_claim", key: null, kind: "FEATURE" as const, question: "The listing describes a property feature—confirm its condition, permitted use, and supporting records." },
  { id: "marketing-hypothesis", pattern: /\b(?:fixer[- ]upper|investor opportunity|investor special)\b/i, category: "listing_marketing_hypothesis", key: null, kind: "HYPOTHESIS" as const, question: "The listing uses investor-oriented marketing language—what current, independent evidence supports condition or seller motivation?" },
] as const;

function validHttps(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

/**
 * Deterministically extracts questions and indicated signals from remarks
 * delivered by a source adapter whose terms permit this processing. Marketing
 * language remains a claim, never a verified property or seller fact.
 */
export function extractListingDescriptionIntelligence(
  observation: ListingDescriptionObservation,
  now: Date,
): ListingDescriptionExtraction {
  if (!observation.sourceName.trim() || !observation.sourceRecordId.trim() || !validHttps(observation.sourceUrl)) {
    throw new Error("Listing-description provenance requires a source name, record identity, and HTTPS source reference.");
  }
  const captured = Date.parse(observation.capturedAt);
  if (!Number.isFinite(captured) || captured > now.getTime() + 60_000) {
    throw new Error("Listing-description capture time is invalid or in the future.");
  }
  if (now.getTime() - captured >= MAX_AGE_MS) {
    return { status: "STALE_SOURCE", intelligence: [], relevanceSignals: [] };
  }
  if (observation.retentionPolicy === "NOT_PERMITTED") {
    return { status: "BLOCKED_BY_RETENTION", intelligence: [], relevanceSignals: [] };
  }
  if (observation.retentionPolicy === "FULL_TEXT_PERMITTED" && observation.description.length > MAX_TEXT_LENGTH) {
    throw new Error(`Listing remarks exceed the ${MAX_TEXT_LENGTH}-character evidence limit; no text was truncated or persisted.`);
  }
  if (observation.retentionPolicy === "HASH_ONLY" && !sha256.test(observation.contentDigest ?? "")) {
    throw new Error("HASH_ONLY listing retention requires a SHA-256 content digest.");
  }

  const provenance = {
    source: observation.sourceName,
    sourceType: "PERMITTED_LISTING" as const,
    sourceUrl: observation.sourceUrl,
    sourceRecordId: observation.sourceRecordId,
    capturedAt: observation.capturedAt,
    confidence: 0.55,
    retentionPolicy: observation.retentionPolicy,
    ...(observation.contentDigest ? { contentDigest: observation.contentDigest } : {}),
  };
  const intelligence: IntelligenceInput[] = [];
  const digest = observation.contentDigest;
  if (observation.retentionPolicy === "FULL_TEXT_PERMITTED") {
    intelligence.push({
      ...provenance,
      classification: "OBSERVED",
      category: "listing_description",
      statement: observation.description,
      confidence: 1,
    });
  } else if (observation.retentionPolicy === "HASH_ONLY") {
    intelligence.push({
      ...provenance,
      classification: "OBSERVED",
      category: "listing_description_digest",
      statement: `Listing description was processed under HASH_ONLY retention; raw text was not stored. SHA-256: ${digest}.`,
      confidence: 0.9,
    });
  }

  const sourceText = observation.description;
  const relevanceSignals: PropertyRelevanceSignal[] = [];
  const matchedConditionRules = listingRules.filter(rule => rule.kind === "CONDITION" && rule.pattern.test(sourceText));
  // A single marketing text cannot count as several independent condition
  // sources. Keep every extracted question, but contribute at most one
  // condition relevance signal from this source record.
  const selectedConditionRule = matchedConditionRules[0];
  const selectedRules = listingRules.filter(rule =>
    rule.kind === "CONDITION" ? rule === selectedConditionRule : rule.pattern.test(sourceText));

  for (const rule of selectedRules) {
    const textRetained = observation.retentionPolicy === "FULL_TEXT_PERMITTED";
    const isHypothesis = rule.kind === "HYPOTHESIS";
    const statement = isHypothesis
      ? `AI hypothesis only: the listing phrase rule "${rule.id}" may suggest an investor/condition angle; it is not a seller fact and contributes no qualification points.`
      : textRetained
      ? `Listing text states: “${sourceText.match(rule.pattern)?.[0] ?? ""}”. This is a listing claim, not an independently verified fact.`
      : `Permitted listing text triggered the ${rule.id} phrase rule. Original text was not retained under ${observation.retentionPolicy} policy; verify directly.`;
    const evidence: IntelligenceInput = {
      ...provenance,
      classification: isHypothesis ? "AI_HYPOTHESIS" : "INDICATED",
      category: rule.category,
      statement,
      confidence: isHypothesis ? 0.25 : 0.55,
      question: rule.question,
      action: "Confirm this listing statement directly and obtain current, independent evidence before using it in underwriting or seller decisions.",
    };
    intelligence.push(evidence);
    if (rule.key) relevanceSignals.push({
      id: `${observation.sourceRecordId}:${rule.id}`,
      key: rule.key,
      group: rule.kind,
      classification: "INDICATED",
      sourceType: "PERMITTED_LISTING",
      statement,
      source: observation.sourceName,
      sourceUrl: observation.sourceUrl,
      evidenceRef: `${observation.sourceRecordId}:${rule.id}`,
      capturedAt: observation.capturedAt,
      confidence: 0.55,
    });
  }

  return {
    status: selectedRules.length ? "EXTRACTED" : "NO_SIGNALS",
    intelligence,
    relevanceSignals,
    ...(digest ? { contentDigest: digest } : {}),
  };
}
