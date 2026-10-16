export type AcquisitionQueueViability = "STRONG" | "NEGOTIABLE" | "WEAK" | "BLOCKED" | "UNKNOWN";
export type AcquisitionQueueRecord = {
  id: string;
  status: string;
  score: number;
  priorityScore?: number;
  confidence: number;
  lastObservedAt: string;
  property: {
    address: string;
    contactPaths: Array<{
      channel: string;
      routeValue?: string | null;
      classification: string;
      permissionStatus: string;
      permissionEvidenceStatus?: string | null;
      freshnessStatus: string;
    }>;
  };
  sourceObservations: Array<{ sourceName: string; lastObservedAt: string; classification?: string | null }>;
  promotionBlockers: string[];
  missingInformation: string[];
  nextAction: string;
  leadId: string | null;
};

export type AcquisitionQueuePriority<T extends AcquisitionQueueRecord> = T & {
  acquisitionPriority: {
    rank: number;
    qualification: number;
    contactability: number;
    recency: number;
    viability: AcquisitionQueueViability;
    actionability: number;
    explanation: string;
    tasks: string[];
  };
};

function currentDirectRoute<T extends AcquisitionQueueRecord>(item: T) {
  return item.property.contactPaths.some(path => ["PHONE", "EMAIL", "WEB"].includes(path.channel)
    && !!path.routeValue?.trim()
    && path.classification === "VERIFIED"
    && path.permissionStatus === "PERMITTED"
    && path.permissionEvidenceStatus === "SUPPORTS_ALLOWED"
    && path.freshnessStatus === "CURRENT");
}

function routeCandidate<T extends AcquisitionQueueRecord>(item: T) {
  return item.property.contactPaths.some(path => ["PHONE", "EMAIL", "WEB"].includes(path.channel));
}

function qualificationTier(status: string) {
  if (status === "CALL_READY") return 3;
  if (status === "QUALIFIED_LEAD") return 2;
  if (status === "RELEVANT_CANDIDATE") return 1;
  return 0;
}

function viabilityTier(value: AcquisitionQueueViability) {
  return value === "STRONG" ? 4 : value === "NEGOTIABLE" ? 3 : value === "WEAK" ? 2 : value === "BLOCKED" ? 1 : 0;
}

/**
 * Rank only persisted discovery records. This is a work-order heuristic, not
 * seller motivation evidence, underwriting authority, profitability, or promotion.
 */
export function rankPropertyAcquisitionQueue<T extends AcquisitionQueueRecord>(
  records: readonly T[],
  now = new Date(),
  getViability: (record: T) => AcquisitionQueueViability = () => "UNKNOWN",
): AcquisitionQueuePriority<T>[] {
  const ranked = records.map(record => {
    const sourceTimes = record.sourceObservations
      .map(source => Date.parse(source.lastObservedAt))
      .filter(timestamp => Number.isFinite(timestamp) && timestamp <= now.getTime());
    const latest = sourceTimes.length ? Math.max(...sourceTimes) : Date.parse(record.lastObservedAt);
    const ageDays = Number.isFinite(latest) ? Math.max(0, (now.getTime() - latest) / 86_400_000) : Number.POSITIVE_INFINITY;
    const recency = ageDays <= 30 ? 2 : Number.isFinite(ageDays) ? 1 : 0;
    const contactability = currentDirectRoute(record) ? 2 : routeCandidate(record) ? 1 : 0;
    const qualification = qualificationTier(record.status);
    const viability = getViability(record);
    const sourceEvidenceGap = !record.sourceObservations.length ||
      record.sourceObservations.some(source => !source.classification || source.classification === "AI_HYPOTHESIS");
    const tasks = [
      ...(!record.sourceObservations.length
        ? ["Review/refresh source evidence; no source observation is linked."]
        : sourceEvidenceGap
          ? ["Review source classification and provenance; an unclassified or hypothetical observation is not verified evidence."]
        : ageDays > 30 ? ["Refresh stale source evidence and confirm its current status."] : []),
      ...(!currentDirectRoute(record)
        ? [routeCandidate(record)
          ? "Review direct contact route, recipient identity, permission, and freshness."
          : "Research and document a permitted direct seller contact route; postal data alone is not callable."]
        : []),
      ...record.promotionBlockers.slice(0, 3),
      ...record.missingInformation.slice(0, 3),
    ];
    if (viability === "UNKNOWN") tasks.push("Complete evidence-backed underwriting before estimating deal viability.");
    const actionability = record.nextAction.trim() ? 1 : 0;
    const explanation = [
      `Qualification ${record.status} (${qualification}/3); this rank does not change qualification.`,
      contactability === 2 ? "Current verified permitted direct route is present."
        : contactability === 1 ? "A direct route exists but still needs review."
          : "No usable direct seller route is present.",
      ageDays <= 30 ? `Latest source evidence is ${Math.floor(ageDays)} day(s) old.`
        : Number.isFinite(ageDays) ? `Latest source evidence is stale for ranking (${Math.floor(ageDays)} days).`
          : "No valid source-observation time is available.",
      viability === "UNKNOWN" ? "Deal viability is unknown; no current linked underwriting." : `Linked underwriting classification is ${viability}; this is not verified profitability.`,
      "Queue priority is not a claim of seller motivation or profit.",
      actionability ? `Next action: ${record.nextAction}` : "No actionable next step is recorded.",
    ].join(" ");
    return {
      ...record,
      acquisitionPriority: {
        rank: 0, qualification, contactability, recency, viability, actionability,
        explanation, tasks: [...new Set(tasks)],
      },
      _queueTie: {
        relevance: record.priorityScore ?? record.score,
        confidence: record.confidence,
      },
    };
  });
  ranked.sort((a, b) =>
    b.acquisitionPriority.qualification - a.acquisitionPriority.qualification ||
    b.acquisitionPriority.contactability - a.acquisitionPriority.contactability ||
    b.acquisitionPriority.recency - a.acquisitionPriority.recency ||
    viabilityTier(b.acquisitionPriority.viability) - viabilityTier(a.acquisitionPriority.viability) ||
    b.acquisitionPriority.actionability - a.acquisitionPriority.actionability ||
    b._queueTie.relevance - a._queueTie.relevance ||
    b._queueTie.confidence - a._queueTie.confidence ||
    a.property.address.localeCompare(b.property.address) ||
    a.id.localeCompare(b.id),
  );
  return ranked.map(({ _queueTie: _ignored, ...record }, index) => ({
    ...record,
    acquisitionPriority: { ...record.acquisitionPriority, rank: index + 1 },
  })) as AcquisitionQueuePriority<T>[];
}
