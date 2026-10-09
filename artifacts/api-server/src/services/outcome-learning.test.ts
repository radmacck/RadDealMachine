import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCalibrationSamples } from "./outcome-learning-store";

const synthetic = (index: number, delta: number) => ({
  observationId: `SYNTHETIC_TEST_FIXTURE:${index}`,
  delta,
  isSynthetic: true,
  verificationState: "OWNER_REVIEWED_REFERENCE",
  confidence: 0.9,
});

test("calibration excludes synthetic, seller-reported, and low-confidence values", () => {
  const result = summarizeCalibrationSamples([
    synthetic(1, 100),
    { ...synthetic(2, 100), verificationState: "SELLER_REPORTED_NOT_INDEPENDENTLY_VERIFIED" },
    { ...synthetic(3, 100), confidence: 0.79 },
  ]);
  assert.equal(result.sampleSize, 0);
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
});

test("synthetic performance fixtures cannot satisfy the five-real-sample gate", () => {
  const result = summarizeCalibrationSamples(Array.from({ length: 5 }, (_, index) => synthetic(index + 1, 500)));
  assert.equal(result.sampleSize, 0);
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.mean, null);
});
