import assert from "node:assert/strict";
import { test } from "node:test";
import { assessOperationalReadiness, type ReadinessCheck } from "./operational-readiness";

test("synthetic workflow success is not reported as real operational readiness", () => {
  const checks: ReadinessCheck[] = [
    { id: "source-exercise", category: "PERMITTED_SOURCE_CHECK", status: "PASS", detail: "Live permitted feed checked into an isolated schema." },
    { id: "workflow-tests", category: "TEST", status: "PASS", detail: "Tests passed." },
    { id: "live-source-observation", category: "LIVE_SYSTEM", status: "UNVERIFIED", detail: "No live permitted source observation was verified." },
  ];

  assert.deepEqual(assessOperationalReadiness(checks), {
    syntheticStatus: "PASS",
    permittedSourceStatus: "PASS",
    operationalStatus: "NOT_READY",
    failedCheckIds: [],
    unverifiedLiveCheckIds: ["live-source-observation"],
    earliestBlocker: "No live permitted source observation was verified.",
  });
});

test("a failed required check fails the gate even if all other checks pass", () => {
  const checks: ReadinessCheck[] = [
    { id: "source-exercise", category: "PERSISTED_SYNTHETIC_EXERCISE", status: "PASS", detail: "Synthetic only." },
    { id: "transaction-exercise", category: "PERSISTED_SYNTHETIC_EXERCISE", status: "FAIL", detail: "Transaction exercise failed." },
    { id: "live-owner", category: "LIVE_SYSTEM", status: "UNVERIFIED", detail: "No owner session." },
  ];

  const result = assessOperationalReadiness(checks);
  assert.equal(result.syntheticStatus, "FAIL");
  assert.equal(result.operationalStatus, "FAIL");
  assert.deepEqual(result.failedCheckIds, ["transaction-exercise"]);
  assert.equal(result.earliestBlocker, "Transaction exercise failed.");
});

test("a failed permitted-source probe is visible without being counted as a synthetic pass", () => {
  const result = assessOperationalReadiness([
    { id: "synthetic", category: "PERSISTED_SYNTHETIC_EXERCISE", status: "PASS", detail: "Synthetic path passed." },
    { id: "permitted-feed", category: "PERMITTED_SOURCE_CHECK", status: "FAIL", detail: "The permitted source probe failed." },
  ]);
  assert.equal(result.syntheticStatus, "PASS");
  assert.equal(result.permittedSourceStatus, "FAIL");
  assert.equal(result.operationalStatus, "FAIL");
  assert.deepEqual(result.failedCheckIds, ["permitted-feed"]);
});

test("only verified live checks can produce READY after all synthetic checks pass", () => {
  const checks: ReadinessCheck[] = [
    { id: "typecheck", category: "TYPECHECK", status: "PASS", detail: "Types pass." },
    { id: "live-owner", category: "LIVE_SYSTEM", status: "PASS", detail: "Owner session verified." },
  ];
  assert.equal(assessOperationalReadiness(checks).operationalStatus, "READY");
});
