import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTransactionDocumentTransition as decide, legalTemplateBlocker } from "./transaction-documents";

test("legal template eligibility fails closed on provenance, jurisdiction, deal type, and effective status", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");
  const approved = {
    status: "APPROVED_LEGAL", jurisdiction: "US/PA/PHILADELPHIA",
    templateHash: "sha256:synthetic", approvalEvidenceRef: "synthetic:review",
    approvedBy: "synthetic-qualified-reviewer", approvedAt: "2026-10-01T00:00:00.000Z",
    effectiveAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-11-01T00:00:00.000Z",
    supportedDealTypes: ["WHOLESALE_ASSIGNMENT"],
  };
  assert.equal(legalTemplateBlocker(approved, "US/PA/PHILADELPHIA", "WHOLESALE_ASSIGNMENT", now), null);
  assert.match(legalTemplateBlocker(approved, "US/NJ/UNKNOWN", "WHOLESALE_ASSIGNMENT", now)!, /jurisdiction/);
  assert.match(legalTemplateBlocker({ ...approved, approvalEvidenceRef: null }, approved.jurisdiction, "WHOLESALE_ASSIGNMENT", now)!, /approval identity/);
  assert.match(legalTemplateBlocker({ ...approved, supportedDealTypes: ["DOUBLE_CLOSE"] }, approved.jurisdiction, "WHOLESALE_ASSIGNMENT", now)!, /does not support/);
  assert.match(legalTemplateBlocker({ ...approved, effectiveAt: "2026-10-11T00:00:00.000Z" }, approved.jurisdiction, "WHOLESALE_ASSIGNMENT", now)!, /not yet effective/);
  assert.match(legalTemplateBlocker({ ...approved, expiresAt: "2026-10-09T00:00:00.000Z" }, approved.jurisdiction, "WHOLESALE_ASSIGNMENT", now)!, /expired/);
});

test("review-copy generation can prepare only from a current snapshot and configured review template", () => {
  assert.deepEqual(decide("DRAFT", "PREPARED_FOR_REVIEW", {
    actorRole: "OPERATOR", currentSnapshot: true, templateStatus: "REVIEW_COPY_AVAILABLE",
  }), { allowed: true });
  assert.equal(decide("DRAFT", "PREPARED_FOR_REVIEW", {
    actorRole: "OPERATOR", currentSnapshot: false, templateStatus: "REVIEW_COPY_AVAILABLE",
  }).allowed, false);
});

test("review worksheets, missing storage, and unapproved terms cannot be approved or sent", () => {
  const worksheet = decide("PREPARED_FOR_REVIEW", "APPROVED_TO_SEND", {
    actorRole: "OWNER", templateStatus: "REVIEW_COPY_AVAILABLE", currentSnapshot: true,
    authorizedSnapshot: true, privateStorageReady: true,
  });
  assert.equal(worksheet.allowed, false);
  assert.match(worksheet.allowed ? "" : worksheet.reason, /not an approved legal template/);

  const missingStorage = decide("PREPARED_FOR_REVIEW", "APPROVED_TO_SEND", {
    actorRole: "OWNER", templateStatus: "APPROVED_LEGAL", currentSnapshot: true,
    authorizedSnapshot: true, privateStorageReady: false,
  });
  assert.equal(missingStorage.allowed, false);

  const noDelivery = decide("APPROVED_TO_SEND", "SENT", {
    actorRole: "OWNER", deliveryProviderConnected: false,
  });
  assert.equal(noDelivery.allowed, false);
  assert.match(noDelivery.allowed ? "" : noDelivery.reason, /no send is recorded/);
});

test("signing and execution require real provider evidence, not interest or an owner click", () => {
  assert.equal(decide("SENT", "SIGNING_IN_PROGRESS", {
    actorRole: "OWNER", signingProviderConnected: false,
  }).allowed, false);
  assert.equal(decide("SIGNING_IN_PROGRESS", "SIGNED", {
    actorRole: "OWNER", signingProviderConnected: true, providerVerifiedSignatureEvidence: false,
    allRequiredPartiesSigned: false,
  }).allowed, false);
  assert.equal(decide("SIGNED", "EXECUTED", {
    actorRole: "OWNER", executionEvidenceRef: "",
  }).allowed, false);
  assert.equal(decide("SIGNED", "EXECUTED", {
    actorRole: "OWNER", executionEvidenceRef: "https://evidence.example/signed-contract",
  }).allowed, true);
});

test("rejection, void, expiry, and replacement are explicit and cannot reopen a terminal artifact", () => {
  assert.equal(decide("PREPARED_FOR_REVIEW", "REJECTED", {
    actorRole: "OPERATOR", reason: "Seller name could not be validated.",
  }).allowed, true);
  assert.equal(decide("PREPARED_FOR_REVIEW", "VOID", {
    actorRole: "OPERATOR", reason: "Owner requested void.",
  }).allowed, false);
  assert.equal(decide("PREPARED_FOR_REVIEW", "EXPIRED", {
    actorRole: "SYSTEM_WORKER", expiresAt: "2020-01-01T00:00:00.000Z", now: new Date("2020-01-02T00:00:00.000Z"),
  }).allowed, true);
  assert.equal(decide("PREPARED_FOR_REVIEW", "REPLACED", {
    actorRole: "OWNER", replacementDocumentId: "new-document", reason: "New authorized terms.",
  }).allowed, true);
  assert.equal(decide("REPLACED", "PREPARED_FOR_REVIEW", {
    actorRole: "OWNER", currentSnapshot: true, templateStatus: "REVIEW_COPY_AVAILABLE",
  }).allowed, false);
});
