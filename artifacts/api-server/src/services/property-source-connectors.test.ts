import assert from "node:assert/strict";
import test from "node:test";
import { runPropertyDiscoveryConnectors, type PropertySourceConnector } from "./property-source-connectors";

const source = (id: string) => ({
  id,
  name: `Synthetic ${id}`,
  coverage: "Synthetic test only",
  termsUrl: "https://example.invalid/terms",
  capabilities: ["synthetic source test"],
  limitations: ["not a real public source"],
});

test("property discovery retains a successful source batch when another connector returns HTTP 400", async () => {
  const successful: PropertySourceConnector = {
    id: "synthetic-source-success",
    sources: [source("synthetic-source-success")],
    discoverProperties: async () => ({ properties: [], unmatchedObservations: [] }),
  };
  const failing: PropertySourceConnector = {
    id: "synthetic-source-http-400",
    sources: [source("synthetic-source-http-400")],
    discoverProperties: async () => { throw new Error("Official provider returned HTTP 400: email seller@example.com; phone +1 (215) 555-0147; api_key=synthetic-secret."); },
  };

  const result = await runPropertyDiscoveryConnectors([successful, failing], new Date("2026-10-21T12:00:00.000Z"));
  assert.equal(result.batches.length, 1);
  assert.equal(result.batches[0]?.connectorId, "synthetic-source-success");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.connectorId, "synthetic-source-http-400");
  assert.match(result.failures[0]?.message ?? "", /HTTP 400/);
  assert.doesNotMatch(result.failures[0]?.message ?? "", /seller@example.com|555-0147|synthetic-secret/);
});
