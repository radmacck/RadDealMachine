export type ReadinessCheckStatus = "PASS" | "FAIL" | "UNVERIFIED";

export type ReadinessCheck = {
  id: string;
  category: "TEST" | "PERSISTED_SYNTHETIC_EXERCISE" | "TYPECHECK" | "BUILD" | "PERMITTED_SOURCE_CHECK" | "LIVE_SYSTEM";
  status: ReadinessCheckStatus;
  detail: string;
};

export function assessOperationalReadiness(checks: ReadinessCheck[]) {
  const syntheticChecks = checks.filter((check) =>
    check.category !== "LIVE_SYSTEM" && check.category !== "PERMITTED_SOURCE_CHECK");
  const liveChecks = checks.filter((check) => check.category === "LIVE_SYSTEM");
  const sourceChecks = checks.filter((check) => check.category === "PERMITTED_SOURCE_CHECK");
  const failed = checks.filter((check) => check.status === "FAIL");
  const unverifiedLive = liveChecks.filter((check) => check.status !== "PASS");
  const syntheticStatus = syntheticChecks.every((check) => check.status === "PASS") ? "PASS" : "FAIL";

  return {
    syntheticStatus,
    permittedSourceStatus: sourceChecks.length === 0 || sourceChecks.every((check) => check.status === "PASS") ? "PASS" : "FAIL",
    operationalStatus: failed.length > 0 ? "FAIL" : unverifiedLive.length > 0 ? "NOT_READY" : "READY",
    failedCheckIds: failed.map(({ id }) => id),
    unverifiedLiveCheckIds: unverifiedLive.map(({ id }) => id),
    earliestBlocker: failed[0]?.detail
      ?? unverifiedLive[0]?.detail
      ?? null,
  } as const;
}
