import test from "node:test";
import assert from "node:assert/strict";
import { classifyExportRecord } from "./founder-record-export";
import { sanitizeEvidenceExport, stableEvidenceJson } from "./evidence-packet";

test("private exports redact sensitive fields and repeats inside free-text provenance", () => {
  const sanitized = sanitizeEvidenceExport({
    record: {
      address: "123 Example Street",
      recordedOwner: "Sensitive Person",
      email: "owner@example.invalid",
      phone: "+1-555-0100",
      source: "Public record for 123 Example Street; contact owner@example.invalid",
      evidenceRef: "https://example.invalid/source?id=123",
    },
  }, false) as { record: Record<string, unknown> };

  assert.equal(sanitized.record.address, "[REDACTED]");
  assert.equal(sanitized.record.recordedOwner, "[REDACTED]");
  assert.equal(sanitized.record.email, "[REDACTED]");
  assert.equal(sanitized.record.phone, "[REDACTED]");
  assert.doesNotMatch(String(sanitized.record.source), /123 Example Street|owner@example\.invalid/);
  assert.equal(sanitized.record.evidenceRef, "https://example.invalid/source?id=123");
});

test("stored synthetic markers remain distinct from unmarked, unverified records", () => {
  assert.equal(classifyExportRecord({ synthetic: true }), "SYNTHETIC");
  assert.equal(classifyExportRecord({ fixture: true }), "SYNTHETIC");
  assert.equal(classifyExportRecord({ source: "Owner submitted" }), "UNMARKED");
});

test("canonical export hashing is stable across object key order", () => {
  assert.equal(
    stableEvidenceJson({ b: 2, a: { y: true, x: 1 } }),
    stableEvidenceJson({ a: { x: 1, y: true }, b: 2 }),
  );
});
