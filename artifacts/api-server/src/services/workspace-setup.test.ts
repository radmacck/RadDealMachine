import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "@workspace/deal-domain";
import {
  emptyWorkspaceSetup, providerSetupStatus, requireSetupOwner, validateWorkspaceSetup,
} from "./workspace-setup";

test("workspace setup validates coverage, provider choices, and notification preferences", () => {
  assert.deepEqual(validateWorkspaceSetup(emptyWorkspaceSetup), emptyWorkspaceSetup);
  assert.throws(() => validateWorkspaceSetup({ ...emptyWorkspaceSetup, zipCodes: ["1234"] }), /zipCodes/);
  assert.throws(() => validateWorkspaceSetup({ ...emptyWorkspaceSetup, states: ["Pennsylvania"] }), /states/);
  assert.throws(() => validateWorkspaceSetup({ ...emptyWorkspaceSetup, emailProvider: "UNSUPPORTED" }), /emailProvider/);
  assert.throws(() => validateWorkspaceSetup({ ...emptyWorkspaceSetup, contactResearchMethod: "PROVIDER" }), /contactResearchProvider/);
  assert.throws(() => validateWorkspaceSetup({ ...emptyWorkspaceSetup, closingMode: "TITLE_PARTNER" }), /closingPartnerName/);
  assert.throws(() => validateWorkspaceSetup({ ...emptyWorkspaceSetup, smsProvider: "SENDGRID" }), /smsProvider/);
  assert.throws(() => validateWorkspaceSetup({
    ...emptyWorkspaceSetup, notifications: { ...emptyWorkspaceSetup.notifications, staleEvidence: "yes" },
  }), /notifications.staleEvidence/);
});

test("secret-like fields are rejected and never accepted as persisted configuration", () => {
  assert.throws(
    () => validateWorkspaceSetup({ ...emptyWorkspaceSetup, apiKey: "never-store-this" }),
    (error) => error instanceof DomainError && /workspace Secrets/.test(error.message),
  );
  assert.throws(() => validateWorkspaceSetup({ ...emptyWorkspaceSetup, notification: { token: "secret" } }), /workspace Secrets/);
  assert.throws(() => validateWorkspaceSetup({ ...emptyWorkspaceSetup, closingPartnerName: "sk_live_abcdefghijklmnop" }), /credential/);
});

test("only the owner may save operational setup", () => {
  requireSetupOwner("OWNER");
  for (const role of ["ANALYST", "OPERATOR", "VIEWER", "PENDING"]) {
    assert.throws(() => requireSetupOwner(role), (error) => (error as { status: number }).status === 403);
  }
});

test("provider selection is not verification without credentials and a successful real check", () => {
  assert.equal(providerSetupStatus(false, false, false), "MISSING");
  assert.equal(providerSetupStatus(true, false, false), "MISSING");
  assert.equal(providerSetupStatus(true, true, false), "CONFIGURED");
  assert.equal(providerSetupStatus(true, true, true), "VERIFIED");
});
