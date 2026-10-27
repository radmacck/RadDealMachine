import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBuyer } from "./buyer-store";
import { createDealFinderSubmission, recordDealFinderSubmissionAction } from "./deal-finder-submissions";

const owner = { id: `exercise-owner-${randomUUID()}`, role: "OWNER" };
const operator = { id: `exercise-operator-${randomUUID()}`, role: "OPERATOR" };
const finder = await createBuyer({
  name: "SYNTHETIC deal finder", email: "", phone: "", source: "Synthetic exercise only",
  status: "ACTIVE", destinationKind: "DEAL_FINDER", criteria: null,
}, owner);
const input = {
  idempotencyKey: `exercise-${randomUUID()}`, finderId: finder.id,
  propertyAddress: "100 Synthetic Test Ave", city: "Testville", state: "PA", postalCode: "19103",
  opportunity: "Synthetic opportunity for regression test; no real property or seller data.",
  evidenceUrl: "https://example.invalid/synthetic", evidenceReference: "fixture-1", authorizedToShare: true,
};
const first = await createDealFinderSubmission(input, operator, new Date("2026-10-27T12:00:00Z"));
const replay = await createDealFinderSubmission(input, operator, new Date("2026-10-27T12:01:00Z"));
assert.equal(replay.id, first.id, "Exact retry returns the same attributed record.");
assert.equal(first.status, "SUBMITTED");
assert.equal(first.feeStatus, "NOT_AGREED", "A profile quote is not an agreed/pending fee.");
await assert.rejects(recordDealFinderSubmissionAction(first.id, {
  version: first.version, action: "MARK_RECEIVED", note: "No agreement exists yet.", evidenceUrl: input.evidenceUrl,
}, owner), /Only an agreed pending fee/);
await assert.rejects(createDealFinderSubmission({ ...input, opportunity: "Different opportunity but reused key." }, operator), /different opportunity evidence/);
await assert.rejects(createDealFinderSubmission({ ...input, idempotencyKey: `exercise-${randomUUID()}`, authorizedToShare: false }, operator), /Invalid literal value/);
const buyer = await createBuyer({
  name: "SYNTHETIC acquisition buyer", email: "", phone: "", source: "Synthetic exercise only",
  status: "ACTIVE", destinationKind: "BUYER", criteria: null,
}, owner);
await assert.rejects(createDealFinderSubmission({ ...input, idempotencyKey: `exercise-${randomUUID()}`, finderId: buyer.id }, operator),
  /deal-finder\/guru record/);
await assert.rejects(recordDealFinderSubmissionAction(first.id, {
  version: first.version, action: "ACCEPT", note: "Operator cannot accept.", evidenceUrl: input.evidenceUrl,
}, operator), /Only an Owner/);
const accepted = await recordDealFinderSubmissionAction(first.id, {
  version: first.version, action: "ACCEPT", note: "Owner accepted the synthetic opportunity.", evidenceUrl: input.evidenceUrl,
}, owner);
assert.equal(accepted.status, "ACCEPTED");
const handedOff = await recordDealFinderSubmissionAction(first.id, {
  version: accepted.version, action: "HANDOFF", note: "Owner handed off synthetic opportunity.", evidenceUrl: input.evidenceUrl,
  wholesaler: "Synthetic wholesaler",
}, owner);
assert.equal(handedOff.status, "HANDED_OFF");
assert.equal(handedOff.feeStatus, "NOT_AGREED");
const terms = await recordDealFinderSubmissionAction(first.id, {
  version: handedOff.version, action: "AGREE_FEE", note: "Synthetic exact fee terms reviewed.", evidenceUrl: input.evidenceUrl,
  exactFeeTerms: "Synthetic fee only if the described transaction closes.", feeAmount: 500, currency: "USD",
}, owner);
assert.equal(terms.feeStatus, "PENDING", "Agreed terms remain pending, not received.");
await assert.rejects(recordDealFinderSubmissionAction(first.id, {
  version: terms.version, action: "MARK_RECEIVED", note: "Operator cannot confirm receipt.", evidenceUrl: input.evidenceUrl,
}, operator), /Only an Owner/);
await assert.rejects(recordDealFinderSubmissionAction(first.id, {
  version: terms.version - 1, action: "MARK_RECEIVED", note: "Stale version cannot record receipt.", evidenceUrl: input.evidenceUrl,
}, owner), /changed; reload/);
const received = await recordDealFinderSubmissionAction(first.id, {
  version: terms.version, action: "MARK_RECEIVED", note: "Synthetic receipt evidence reviewed.", evidenceUrl: input.evidenceUrl,
}, owner);
assert.equal(received.feeStatus, "RECEIVED");
await assert.rejects(recordDealFinderSubmissionAction(first.id, {
  version: received.version, action: "HANDOFF", note: "Cannot hand off twice.", evidenceUrl: input.evidenceUrl,
  wholesaler: "Another wholesaler",
}, owner), /Accept the opportunity/);
console.log("Deal-finder submission/handoff/fee exercise PASSED (isolated synthetic data; no outreach, real property, or compensation).");
