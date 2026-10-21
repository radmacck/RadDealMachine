import assert from "node:assert/strict";
import test from "node:test";
import { isExactOfferDraftReplay, offerDraftReplayHash } from "./offer-draft-replay";

const input = {
  version: 12,
  amount: 110_000,
  earnestMoney: 1_000,
  closingDays: 30,
  contingencies: "Subject to diligence and title review.",
  assignmentIntent: false,
  reason: "Synthetic proposal for duplicate-replay regression.",
  idempotencyKey: "synthetic-offer-key-001",
};

test("initial-draft replay matching accepts exact same-actor input and rejects changed terms or actor", () => {
  const persisted = {
    createdBy: "analyst-a",
    payload: { idempotencyHash: offerDraftReplayHash(input) },
  };
  assert.equal(isExactOfferDraftReplay(persisted, input, "analyst-a"), true);
  assert.equal(isExactOfferDraftReplay(persisted, { ...input, amount: 111_000 }, "analyst-a"), false);
  assert.equal(isExactOfferDraftReplay(persisted, input, "analyst-b"), false);
});
