import assert from "node:assert/strict";
import { test } from "node:test";
import { completedWorkerJobState } from "./worker-job-state";

test("property discovery with connector failures is persisted as partial, never successful", () => {
  assert.equal(
    completedWorkerJobState("DISCOVER_PROPERTIES", "Source-specific partial failures (1): vacancy/REFRESH: unavailable."),
    "PARTIAL",
  );
  assert.equal(completedWorkerJobState("DISCOVER_PROPERTIES", "All registered source operations completed."), "SUCCEEDED");
  assert.equal(completedWorkerJobState("MATCH_BUYERS", "Source-specific partial failures (1): fixture."), "SUCCEEDED");
});
