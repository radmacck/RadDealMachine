import assert from "node:assert/strict";
import test from "node:test";
import { unavailableSigningProvider } from "./transaction-signing-provider";

test("disconnected signing provider reports unavailable and cannot create an envelope or signature", async () => {
  assert.deepEqual(unavailableSigningProvider.status, {
    status: "NOT_CONNECTED",
    provider: null,
    reason: "No signing provider connection is attached to this workspace.",
  });
  await assert.rejects(unavailableSigningProvider.createEnvelope({
    documentId: "document", leadId: "lead", templateKey: "PURCHASE_AGREEMENT",
    templateVersion: 1, contentHash: "a".repeat(64), economicsSnapshotHash: "b".repeat(64),
    requiredSignerRoles: ["SELLER", "ACQUISITION"],
  }), /connect a signing provider/);
  await assert.rejects(unavailableSigningProvider.verifySignatureEvidence("envelope-id"),
    /no connected signing provider/);
});
