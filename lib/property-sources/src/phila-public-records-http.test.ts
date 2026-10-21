import assert from "node:assert/strict";
import test from "node:test";
import { createCartoRowsClient } from "./phila-public-records";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Carto SQL client sends a bounded GET and parses successful rows", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const rows = [{ record_id: "test-1" }];
  const cartoRows = createCartoRowsClient({
    requestIntervalMs: 0,
    fetchImpl: async (input, init) => {
      requestedUrl = new URL(String(input));
      requestedInit = init;
      return jsonResponse({ rows });
    },
  });

  assert.deepEqual(await cartoRows("SELECT record_id FROM RTT_SUMMARY LIMIT 1", 1), rows);
  assert.equal(requestedUrl?.origin, "https://phl.carto.com");
  assert.equal(requestedUrl?.pathname, "/api/v2/sql");
  assert.equal(requestedUrl?.searchParams.get("q"), "SELECT record_id FROM RTT_SUMMARY LIMIT 1");
  assert.equal(requestedInit?.method, undefined, "The public endpoint uses a GET request.");
  assert.equal((requestedInit?.headers as Record<string, string>).Accept, "application/json");
  assert.equal(requestedInit?.redirect, "error");
});

test("Carto SQL client preserves a successful empty result", async () => {
  const cartoRows = createCartoRowsClient({
    requestIntervalMs: 0,
    fetchImpl: async () => jsonResponse({ rows: [] }),
  });
  assert.deepEqual(await cartoRows("SELECT record_id FROM RTT_SUMMARY LIMIT 1", 1), []);
});

test("Carto SQL client rejects malformed JSON and invalid row envelopes", async () => {
  const malformedJson = createCartoRowsClient({
    requestIntervalMs: 0,
    fetchImpl: async () => new Response("{not-json", { status: 200 }),
  });
  await assert.rejects(malformedJson("SELECT 1", 1));

  const malformedEnvelope = createCartoRowsClient({
    requestIntervalMs: 0,
    fetchImpl: async () => jsonResponse({ results: [] }),
  });
  await assert.rejects(malformedEnvelope("SELECT 1", 1));
});

test("Carto SQL client surfaces timeout failures", async () => {
  const cartoRows = createCartoRowsClient({
    requestIntervalMs: 0,
    timeoutMs: 5,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error("Expected an abort signal."));
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  await assert.rejects(cartoRows("SELECT 1", 1), /TimeoutError|timed out/i);
});

test("Carto SQL client reports bounded provider details for HTTP 400", async () => {
  const cartoRows = createCartoRowsClient({
    requestIntervalMs: 0,
    fetchImpl: async () => new Response("invalid column in query", { status: 400 }),
  });
  await assert.rejects(
    cartoRows("SELECT invalid_column FROM RTT_SUMMARY", 1),
    /HTTP 400: invalid column in query/,
  );
});
