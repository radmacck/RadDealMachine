export type RankedPropertyDiscovery = {
  id: string;
  score: number;
  updatedAt: Date | string;
};

export type RankingEvidence = {
  id: string;
  key: string;
  classification: "VERIFIED" | "OBSERVED" | "INDICATED" | "AI_HYPOTHESIS";
  statement: string;
  source: string;
  confidence: number;
  points: number;
};

function timestamp(value: Date | string) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Persisted seller relevance leads; freshness and ID make all score ties stable. */
export function comparePropertyDiscoveriesByRank(
  left: RankedPropertyDiscovery,
  right: RankedPropertyDiscovery,
) {
  return right.score - left.score ||
    timestamp(right.updatedAt) - timestamp(left.updatedAt) ||
    left.id.localeCompare(right.id);
}

export function propertyDiscoveryRankingReasons(
  score: number,
  signals: readonly RankingEvidence[],
) {
  const scored = signals
    .filter(signal => signal.points > 0 && signal.classification !== "AI_HYPOTHESIS")
    .sort((left, right) => right.points - left.points || left.id.localeCompare(right.id));
  const reasons = scored.slice(0, 5).map(signal =>
    (`${signal.classification} ${signal.key.replaceAll("_", " ").toLowerCase()}: ${signal.statement} ` +
    `(+${signal.points}; confidence ${signal.confidence.toFixed(2)}; source ${signal.source}).`).slice(0, 1000),
  );
  if (scored.length > 5) reasons.push(`${scored.length - 5} additional scored signal(s) support the persisted relevance score.`);
  if (!scored.length) {
    reasons.push("No evidence-backed relevance signal contributes ranking points; this record remains in the discovery pool.");
  } else {
    reasons.unshift(`Persisted seller-relevance score: ${score}/100.`);
  }
  if (signals.some(signal => signal.classification === "AI_HYPOTHESIS")) {
    reasons.push("AI_HYPOTHESIS evidence is retained as a hypothesis and contributes zero ranking points; it is not a verified fact.");
  }
  reasons.push("Order: relevance score descending, latest record update descending, then stable discovery ID ascending.");
  return reasons;
}
