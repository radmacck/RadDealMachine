import assert from "node:assert/strict";
import { test } from "node:test";
import { versionedStageTransition } from "./canonical-deal-state";

test("canonical transition event retains prior/result versions and evidence context", () => {
  const event = versionedStageTransition({
    leadId: "lead-1",
    priorVersion: 7,
    priorStage: "ANALYZED",
    nextStage: "CALL_READY",
    actor: "owner-1",
    occurredAt: new Date("2026-10-14T12:00:00.000Z"),
    reason: "Current route and underwriting evidence reviewed.",
    nextAction: "Call seller.",
    analysisSnapshotId: "analysis-1",
  });
  assert.deepEqual(event, {
    eventType: "CANONICAL_STAGE_TRANSITION",
    leadId: "lead-1",
    priorVersion: 7,
    resultingVersion: 8,
    priorStage: "ANALYZED",
    resultingStage: "CALL_READY",
    actor: "owner-1",
    occurredAt: "2026-10-14T12:00:00.000Z",
    reason: "Current route and underwriting evidence reviewed.",
    nextAction: "Call seller.",
    evidenceRefs: ["analysis-1"],
  });
});

test("transition without an analysis snapshot does not invent evidence references", () => {
  const event = versionedStageTransition({
    leadId: "lead-1", priorVersion: 1, priorStage: "DISCOVERED", nextStage: "ENRICHING",
    actor: "operator-1", occurredAt: new Date("2026-10-14T12:00:00.000Z"),
    reason: "Research requested.", nextAction: "Review sources.",
  });
  assert.deepEqual(event.evidenceRefs, []);
  assert.equal(event.resultingVersion, 2);
});

test("multiple canonical transitions within one operation form a contiguous version chain", () => {
  const versionClock = { currentVersion: 12 };
  const first = versionedStageTransition({
    leadId: "lead-1", priorVersion: 12, versionClock, priorStage: "CONTACTED", nextStage: "CONVERSATION",
    actor: "owner-1", occurredAt: new Date("2026-10-17T12:00:00.000Z"),
    reason: "Seller answered.", nextAction: "Continue qualification.",
  });
  const second = versionedStageTransition({
    leadId: "lead-1", priorVersion: 12, versionClock, priorStage: "CONVERSATION", nextStage: "NEGOTIATING",
    actor: "owner-1", occurredAt: new Date("2026-10-17T12:00:00.000Z"),
    reason: "Terms discussed.", nextAction: "Review exact terms.",
  });
  assert.deepEqual(
    [first.priorVersion, first.resultingVersion, second.priorVersion, second.resultingVersion, versionClock.currentVersion],
    [12, 13, 13, 14, 14],
  );
});
