import assert from "node:assert/strict";
import test from "node:test";
import { applyProviderHealthFreshness, classifyProviderHealth, unconfiguredOperationalProviderHealth } from "./provider-health";

test("unconfigured provider reports no external request and exposes no credential values", () => {
  const status = classifyProviderHealth(false);
  assert.equal(status.status, "UNCONFIGURED");
  assert.equal(status.lastSuccessAt, null);
  assert.match(status.reason, /No external request was made/);
  assert.doesNotMatch(JSON.stringify(status), /api[_-]?key|secret|token/i);
});

test("provider job success, authorization failure, degradation, rate limits, and retry states remain distinct", () => {
  assert.equal(classifyProviderHealth(true, { state: "SUCCEEDED", completedAt: "2026-10-14T12:00:00Z" }).status, "CONNECTED");
  const denied = classifyProviderHealth(true, {
    state: "FAILED", message: "HTTP 401 invalid credential: do-not-log", lastSuccessAt: "2026-10-13T12:00:00Z",
  });
  assert.equal(denied.status, "DISCONNECTED");
  assert.equal(denied.lastSuccessAt, "2026-10-13T12:00:00Z");
  assert.doesNotMatch(denied.reason, /do-not-log/);
  assert.equal(classifyProviderHealth(true, { state: "FAILED", message: "HTTP 429 rate limit" }).status, "RATE_LIMITED");
  assert.equal(classifyProviderHealth(true, { state: "FAILED", message: "HTTP 503 upstream failure" }).status, "DEGRADED");
  assert.equal(classifyProviderHealth(true, { state: "RUNNING", message: "retry attempt 2" }).status, "DEGRADED");
  assert.equal(classifyProviderHealth(true, { state: "UNKNOWN" }).status, "UNKNOWN");
  assert.match(classifyProviderHealth(true, { state: "UNKNOWN" }).reason, /no connection health is claimed/);
  assert.equal(classifyProviderHealth(true).status, "DEGRADED");
});

test("old successful source checks become degraded instead of appearing currently connected", () => {
  const recent = classifyProviderHealth(true, { state: "SUCCEEDED", completedAt: "2026-10-14T10:00:00Z" });
  assert.equal(applyProviderHealthFreshness(recent, new Date("2026-10-14T20:00:00Z")).status, "CONNECTED");
  const stale = applyProviderHealthFreshness(recent, new Date("2026-10-14T23:00:00Z"));
  assert.equal(stale.status, "DEGRADED");
  assert.match(stale.reason, /older than 12 hours/);
});

test("manual funding and in-app notifications are not represented as connected external providers", () => {
  const providers = unconfiguredOperationalProviderHealth(new Date("2026-10-17T12:00:00.000Z"));
  const funding = providers.find(provider => provider.id === "funding-deposits");
  const notifications = providers.find(provider => provider.id === "external-notifications");
  assert.equal(funding?.category, "FUNDING_DEPOSIT");
  assert.equal(funding?.status, "UNCONFIGURED");
  assert.match(funding?.nextAction ?? "", /does not move funds/);
  assert.equal(notifications?.category, "EXTERNAL_NOTIFICATIONS");
  assert.equal(notifications?.status, "UNCONFIGURED");
  assert.match(notifications?.nextAction ?? "", /in-app alerts remain available/);
  assert.doesNotMatch(JSON.stringify(providers), /(api[_-]?key|secret|token|password)/i);
});
