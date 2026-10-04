import test from "node:test";
import assert from "node:assert/strict";
import { preparedHypotheses } from "./research-worker";
const now = new Date();
const sample = {statement:"The seller may prefer flexibility in the closing schedule.",
  question:"What timing would work best for your situation?",action:"Ask the seller and record the answer as a seller indication.",
  confidence:0.4,evidenceIds:["synthetic-evidence"]};
test("model preparation can only produce bounded source-linked uncertain hypotheses",()=>{
  const entries = preparedHypotheses({hypotheses:[sample]},new Set(["synthetic-evidence"]),"Synthetic model test",now);
  assert.equal(entries[0]?.classification,"AI_HYPOTHESIS");
  assert.equal(entries[0]?.sourceType,"MODEL");
  assert.ok(entries[0]?.source.includes("synthetic-evidence"));
  assert.match(entries[0]!.statement,/^Possible:/);
});
test("hallucinated references, overconfidence and monetary instructions fail without promotion",()=>{
  assert.throws(()=>preparedHypotheses({hypotheses:[sample]},new Set(["other-evidence"]),"Test",now));
  assert.throws(()=>preparedHypotheses({hypotheses:[{...sample,confidence:1}]},new Set(sample.evidenceIds),"Test",now));
  assert.throws(()=>preparedHypotheses({hypotheses:[{...sample,action:"Offer $110,000 to this seller immediately."}]},new Set(sample.evidenceIds),"Test",now));
  assert.throws(()=>preparedHypotheses({hypotheses:[sample,sample,sample,sample]},new Set(sample.evidenceIds),"Test",now));
  assert.throws(()=>preparedHypotheses({hypotheses:[{...sample,action:"Offer 110000 to the seller immediately."}]},new Set(sample.evidenceIds),"Test",now));
});
test("street numbers are evidence context, not invented monetary instructions",()=>{
  const result = preparedHypotheses({hypotheses:[{...sample,
    question:"Before discussing price, confirm which property is at 1600 Pennsylvania Avenue."}]},new Set(sample.evidenceIds),"Test",now);
  assert.equal(result[0]?.classification,"AI_HYPOTHESIS");
});