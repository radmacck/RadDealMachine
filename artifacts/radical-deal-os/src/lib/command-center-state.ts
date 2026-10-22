import type { Buyer } from "@workspace/api-client-react";

export type DiscoverySourceObservationLite = {
  sourceId: string;
  sourceName: string;
  sourceUrl?: string;
  lastObservedAt: string;
};

const exercisedPhiladelphiaSources = new Set([
  "phila-opa", "phila-li-violations", "phila-li-unsafe", "phila-vacancy-indicators",
  "phila-li-building-permits", "phila-li-demolitions", "phila-sheriff-deed-records",
]);

export function isQuerySnapshotCurrent(isFetching: boolean, isError: boolean) {
  return !isFetching && !isError;
}

export function discoveryOrigin(observations: DiscoverySourceObservationLite[]) {
  const ids = observations.map((item) => item.sourceId.toLowerCase());
  if (ids.some((id) => /synthetic|fixture|test/.test(id))) return "SYNTHETIC_EXERCISE";
  if (ids.length > 0 && ids.every((id) => exercisedPhiladelphiaSources.has(id))) return "LIVE_PUBLIC_SOURCE";
  return ids.length ? "SOURCE_NOT_VERIFIED" : "NO_SOURCE_PROVENANCE";
}

export function discoveryContactState(status: string, paths: Array<{
  channel: string;
  routeValue?: string | null;
  classification: string;
  permissionStatus: string;
  permissionEvidenceStatus?: string | null;
  freshnessStatus: string;
}>) {
  const usablePhone = paths.some((path) => path.channel === "PHONE"
    && !!path.routeValue?.trim()
    && path.classification === "VERIFIED"
    && path.permissionStatus === "PERMITTED"
    && path.permissionEvidenceStatus === "SUPPORTS_ALLOWED"
    && path.freshnessStatus === "CURRENT");
  if (status === "CALL_READY" && usablePhone) return "CALL_READY";
  if (paths.some((path) => path.channel === "PHONE" || path.channel === "EMAIL" || path.channel === "WEB")) {
    return "DIRECT_ROUTE_NEEDS_REVIEW";
  }
  if (paths.some((path) => path.channel === "POSTAL")) return "POSTAL_ONLY";
  return "NO_DIRECT_ROUTE";
}

export type DiscoveryPreviewRecord = {
  status: string;
  score: number;
  confidence: number;
  lastObservedAt: string;
  property: { address: string; recordedOwner: string | null };
  reason: string;
  rankingReasons: string[];
  nextAction: string;
  sourceObservations: Array<{ sourceName: string }>;
};

export function filterAndSortDiscoveryPreview<T extends DiscoveryPreviewRecord>(
  records: T[], status: string, query: string, sort: "RELEVANCE" | "FRESHEST" | "ADDRESS",
) {
  const needle = query.trim().toLocaleLowerCase();
  return records.filter((item) => (status === "ALL" || item.status === status)
    && (!needle || [
      item.property.address, item.property.recordedOwner, item.reason, item.nextAction,
      ...item.rankingReasons, ...item.sourceObservations.map((observation) => observation.sourceName),
    ].some((value) => String(value ?? "").toLocaleLowerCase().includes(needle))))
    .sort((a, b) => sort === "ADDRESS"
      ? a.property.address.localeCompare(b.property.address)
      : sort === "FRESHEST"
        ? b.lastObservedAt.localeCompare(a.lastObservedAt) || b.score - a.score
        : b.score - a.score || b.confidence - a.confidence || a.property.address.localeCompare(b.property.address));
}

export function acquisitionQueueActionHref(item: {
  decision: string;
  blockerCode: string | null;
  lead: { id: string };
}) {
  if (item.decision === "CALL_NEXT") return `/calls?lead=${encodeURIComponent(item.lead.id)}`;
  if (item.blockerCode?.startsWith("CONTACT_")) return `/deals/${encodeURIComponent(item.lead.id)}?work=contact`;
  if (item.blockerCode === "UNDERWRITING_MISSING" || item.blockerCode === "UNDERWRITING_STALE") {
    return `/deals/${encodeURIComponent(item.lead.id)}?work=uw`;
  }
  return `/deals/${encodeURIComponent(item.lead.id)}?work=intel`;
}

export function buyerIntakeHref() {
  return "/buyers?tab=prospects&new=prospect";
}

export function sellerContactReviewHref(leadId: string) {
  return `/deals/${encodeURIComponent(leadId)}?work=contact`;
}

export function buyerIntakeState(search: string) {
  const params = new URLSearchParams(search);
  return {
    tab: params.get("tab") === "prospects" ? "prospects" as const : "pool" as const,
    openProspect: params.get("new") === "prospect",
  };
}

export type ApiViewState =
  | "LOADING"
  | "READY"
  | "EMPTY"
  | "STALE"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "ERROR";

export function classifyApiViewState<T>(query: {
  isLoading: boolean;
  isError: boolean;
  data: T | undefined;
  error: unknown;
}, isEmpty: (data: T) => boolean = () => false): ApiViewState {
  const status = (query.error as { status?: unknown } | null)?.status;
  if (query.isError && status === 401) return "UNAUTHENTICATED";
  if (query.isError && status === 403) return "FORBIDDEN";
  if (query.isError) return query.data === undefined ? "ERROR" : "STALE";
  if (query.data === undefined || query.isLoading) return "LOADING";
  return isEmpty(query.data) ? "EMPTY" : "READY";
}

export function isEmptyCommandCenter(data: {
  actions: unknown[];
  calls: unknown[];
  acquisitionQueue: unknown[];
  deals: unknown[];
  operations: unknown[];
  buyers: unknown[];
  jobs: unknown[];
  propertyDiscoveries: { counts: Record<string, number> };
}) {
  return data.actions.length === 0
    && data.calls.length === 0
    && data.acquisitionQueue.length === 0
    && data.deals.length === 0
    && data.operations.length === 0
    && data.buyers.length === 0
    && data.jobs.length === 0
    && Object.values(data.propertyDiscoveries.counts).every((count) => count === 0);
}

const TERMINAL_SELLER_STAGES = new Set(["CLOSED", "DEAD_DEAL", "LOST", "NURTURE"]);

export function activeSellerLeadCount(stages: readonly string[]) {
  return stages.filter((stage) => !TERMINAL_SELLER_STAGES.has(stage)).length;
}

export function isSyntheticExerciseBuyer(buyer: Buyer) {
  const sourceEvidence = [
    buyer.name,
    buyer.source,
    buyer.verificationSource,
    buyer.identityEvidenceUrl,
    buyer.buyingEvidenceUrl,
    buyer.criteriaEvidenceUrl,
    JSON.stringify(buyer.discoveryEvidence ?? {}),
    JSON.stringify(buyer.verificationHistory ?? []),
  ].join(" ");
  return /\bsynthetic\b|\btest fixture\b|\bexercise fixture\b/i.test(sourceEvidence);
}

export function isCurrentApprovedBuyer(buyer: Buyer, now: Date) {
  const validUntil = Date.parse(buyer.validUntil ?? "");
  const buyingVerifiedAt = Date.parse(buyer.buyingVerifiedAt ?? "");
  return (buyer.destinationKind ?? "BUYER") === "BUYER"
    && buyer.status === "ACTIVE"
    && buyer.approvalStatus === "APPROVED"
    && buyer.verificationStatus === "VERIFIED"
    && buyer.currentBuyingStatus === "BUYING"
    && Number.isFinite(validUntil)
    && validUntil > now.getTime()
    && Number.isFinite(buyingVerifiedAt)
    && buyingVerifiedAt <= now.getTime()
    && (buyer.qualificationBlockers?.length ?? 0) === 0
    && !isSyntheticExerciseBuyer(buyer);
}

export function buyerDistributionSummary(buyers: Buyer[], now: Date) {
  const acquisitionBuyers = buyers.filter((buyer) => (buyer.destinationKind ?? "BUYER") === "BUYER");
  const syntheticExcluded = acquisitionBuyers.filter(isSyntheticExerciseBuyer).length;
  const liveRecords = acquisitionBuyers.filter((buyer) => !isSyntheticExerciseBuyer(buyer));
  const currentApproved = liveRecords.filter((buyer) => isCurrentApprovedBuyer(buyer, now));
  const staleExcluded = liveRecords.filter((buyer) =>
    buyer.verificationStatus === "STALE" || buyer.approvalStatus === "REVERIFICATION_REQUIRED");
  const unverifiedExcluded = liveRecords.filter((buyer) =>
    !isCurrentApprovedBuyer(buyer, now)
    && buyer.verificationStatus !== "STALE"
    && buyer.approvalStatus !== "REVERIFICATION_REQUIRED");
  return {
    approvedCurrentCount: currentApproved.length,
    staleExcludedCount: staleExcluded.length,
    unverifiedExcludedCount: unverifiedExcluded.length,
    syntheticExcludedCount: syntheticExcluded,
  };
}

