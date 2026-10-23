import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeOperationalError } from "./operational-error-sanitizer";

test("operational failure summaries preserve useful status while redacting credentials, contact data, and URLs", () => {
  const summary = sanitizeOperationalError(new Error(
    "HTTP 429 Authorization: Bearer top-secret api_key=private-key email seller@example.com phone +1 (215) 555-0147 https://provider.invalid/path?token=hidden",
  ));
  assert.match(summary, /HTTP 429/);
  assert.match(summary, /Authorization=\[redacted\]/);
  assert.match(summary, /api_key=\[redacted\]/);
  assert.match(summary, /\[email redacted\]/);
  assert.match(summary, /\[phone redacted\]/);
  assert.match(summary, /\[URL redacted\]/);
  assert.doesNotMatch(summary, /top-secret|private-key|seller@example.com|555-0147|token=hidden/);
});

test("sanitizer bounds long provider errors and returns a safe fallback for empty input", () => {
  assert.equal(sanitizeOperationalError(new Error("x".repeat(500))).length, 300);
  assert.equal(sanitizeOperationalError(new Error(" \n ")), "Operation failed.");
});
