import assert from "node:assert/strict";
import { test } from "node:test";
import { canOfferWorkerRetry, requiresFreshSourceReview } from "./worker-retry";

test("partial property-source failures offer an explicit retry, but other partial work is not blindly retried", () => {
  assert.equal(canOfferWorkerRetry("PARTIAL", "DISCOVER_PROPERTIES"), true);
  assert.equal(canOfferWorkerRetry("PARTIAL", "MATCH_BUYERS"), false);
  assert.equal(canOfferWorkerRetry("FAILED", "HUMAN_HANDOFF"), false);
  assert.equal(canOfferWorkerRetry("RUNNING", "DISCOVER_PROPERTIES"), false);
});

test("public-source retries always require a fresh terms review, regardless of previous UI checkbox state", () => {
  assert.equal(requiresFreshSourceReview("DISCOVER_PROPERTIES"), true);
  assert.equal(requiresFreshSourceReview("BUYER_DISCOVERY"), true);
  assert.equal(requiresFreshSourceReview("MATCH_BUYERS"), false);
});
