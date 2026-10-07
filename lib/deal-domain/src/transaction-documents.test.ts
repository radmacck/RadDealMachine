import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTransactionDocumentTransition as decide } from "./transaction-documents";

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
