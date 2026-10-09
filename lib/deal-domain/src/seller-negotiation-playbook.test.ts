import test from "node:test";
import assert from "node:assert/strict";
import {
  SELLER_NEGOTIATION_PLAYBOOK_SEEDS,
  evaluateSellerPlaybookRelevance,
} from "./seller-negotiation-playbook";

test("playbook situations remain hypotheses and the library preserves the requested topic coverage", () => {
  const entries = SELLER_NEGOTIATION_PLAYBOOK_SEEDS;
  assert.ok(entries.length >= 12);
  assert.ok(entries.some((item) => item.slug === "relocation-or-deadline"));
  assert.ok(entries.some((item) => item.slug === "estate-or-inherited-property"));
  assert.ok(entries.some((item) => item.slug === "landlord-or-tenant-context"));
  assert.ok(entries.some((item) => item.slug === "tax-foreclosure-or-title-pressure"));
  assert.ok(entries.every((item) => item.content.hypothesis.length > 0));
  assert.ok(entries.every((item) => item.sourceProvenance.length >= 2));
  assert.ok(entries.every((item) => item.sourceProvenance.every((source) => source.scopeLimit.includes("Does not establish"))));
});

test("public/property and AI evidence cannot trigger a seller-motivation playbook match", () => {
  const relocation = SELLER_NEGOTIATION_PLAYBOOK_SEEDS.find((item) => item.slug === "relocation-or-deadline")!;
  const result = evaluateSellerPlaybookRelevance(relocation.content, [
    { id: "property-1", category: "vacancy", statement: "vacant moving soon", sourceType: "PUBLIC_RECORD", classification: "INDICATED" },
    { id: "hypothesis-1", category: "relocation", statement: "seller may be moving", sourceType: "MODEL", classification: "AI_HYPOTHESIS" },
  ]);
  assert.equal(result.status, "GENERAL_QUESTION");
  assert.deepEqual(result.evidenceRefs, []);
  assert.match(result.reason, /do not infer this situation/);
});

test("seller-reported topic only prioritizes a question and remains explicitly unverified", () => {
  const relocation = SELLER_NEGOTIATION_PLAYBOOK_SEEDS.find((item) => item.slug === "relocation-or-deadline")!;
  const result = evaluateSellerPlaybookRelevance(relocation.content, [
    { id: "seller-evidence-1", category: "seller_call_motivation", statement: "Seller reports relocating for work", sourceType: "SELLER", classification: "INDICATED" },
  ]);
  assert.equal(result.status, "SELLER_REPORTED_TOPIC_TO_CONFIRM");
  assert.deepEqual(result.evidenceRefs, ["seller-evidence-1"]);
  assert.match(result.reason, /not an independently verified fact/);
});

test("advisory options do not contain automatic price/term changes or contract clauses", () => {
  for (const item of SELLER_NEGOTIATION_PLAYBOOK_SEEDS) {
    const guidance = JSON.stringify(item.content.negotiationOptions);
    assert.doesNotMatch(guidance, /\$\s?\d/);
    assert.ok(item.content.doNotPromise.some((line) => /approval|promise|legal|contract/i.test(line)));
  }
});
