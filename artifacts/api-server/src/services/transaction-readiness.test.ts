import assert from "node:assert/strict";
import test from "node:test";
import { classifyClosingDeadline } from "./transaction-readiness";

const instant = new Date("2026-10-09T12:00:00.000Z");

test("deadline classification uses only the persisted closing instant and a fixed seven-day threshold", () => {
  assert.equal(classifyClosingDeadline(null, instant), "INVALID");
  assert.equal(classifyClosingDeadline("not-a-date", instant), "INVALID");
  assert.equal(classifyClosingDeadline(new Date(instant.getTime() - 1), instant), "OVERDUE");
  assert.equal(classifyClosingDeadline(instant, instant), "UPCOMING");
  assert.equal(classifyClosingDeadline(new Date(instant.getTime() + 7 * 86_400_000), instant), "UPCOMING");
  assert.equal(classifyClosingDeadline(new Date(instant.getTime() + 7 * 86_400_000 + 1), instant), "ON_TRACK");
});

test("invalid, upcoming, and overdue deadlines never imply an extension or milestone completion", () => {
  assert.equal(classifyClosingDeadline(undefined, instant), "INVALID");
  assert.equal(classifyClosingDeadline("2026-10-10T12:00:00.000Z", instant), "UPCOMING");
  assert.equal(classifyClosingDeadline("2026-10-08T12:00:00.000Z", instant), "OVERDUE");
});
