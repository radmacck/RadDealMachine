export type RetryableWorkerState = "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";

export function canOfferWorkerRetry(state: RetryableWorkerState, kind: string): boolean {
  if (kind === "HUMAN_HANDOFF") return false;
  return state === "FAILED" || (state === "PARTIAL" && kind === "DISCOVER_PROPERTIES");
}

export function requiresFreshSourceReview(kind: string): boolean {
  return kind === "BUYER_DISCOVERY" || kind === "DISCOVER_PROPERTIES";
}
