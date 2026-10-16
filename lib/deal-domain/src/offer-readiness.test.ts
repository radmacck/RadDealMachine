import test from "node:test";
import assert from "node:assert/strict";
import { buildOfferReadinessScorecard, type OfferReadinessInput, type OfferReadinessKey } from "./offer-readiness";

const keys: OfferReadinessKey[] = ["PROPERTY_IDENTITY","SELLER_AUTHORITY","CONTACTABILITY","COMPS_ARV","REPAIR_ASSUMPTIONS","TRANSACTION_COSTS","DETERMINISTIC_MAO","LEGAL_STRATEGY","CURRENT_APPROVAL"];
const fixture = (): OfferReadinessInput => Object.assign({
  hardStopKeys: ["PROPERTY_IDENTITY","SELLER_AUTHORITY","CONTACTABILITY","COMPS_ARV","REPAIR_ASSUMPTIONS","DETERMINISTIC_MAO","LEGAL_STRATEGY","CURRENT_APPROVAL"] as OfferReadinessKey[],
}, ...keys.map(key => ({[key]:{state:"READY" as const,evidence:["synthetic source"],missingEvidence:[],remedy:"none"}})));

test("readiness scoring is deterministic, weighted and never authorizes", () => {
  const input = fixture();
  const first = buildOfferReadinessScorecard(input);
  assert.deepEqual(buildOfferReadinessScorecard(input), first);
  assert.equal(first.score,100);
  assert.equal(first.status,"READY_FOR_HUMAN_REVIEW");
  assert.equal(first.authorizesOffer,false);
});

test("hard stops, missing evidence and stale evidence remain explicit and actionable", () => {
  const input = fixture();
  input.CONTACTABILITY = {state:"BLOCKED",evidence:[],missingEvidence:["Seller route expired on 2026-10-01."],remedy:"Reconfirm a permitted phone route and record current source evidence."};
  input.COMPS_ARV = {state:"BLOCKED",evidence:[],missingEvidence:["One required comparable is stale."],remedy:"Replace or reverify the stale comparable before refreshing ARV."};
  const result = buildOfferReadinessScorecard(input);
  assert.equal(result.status,"BLOCKED");
  assert.deepEqual(result.hardStops.map(item=>item.key),["CONTACTABILITY","COMPS_ARV"]);
  assert.match(result.hardStops[0]!.remedy,/Reconfirm/);
  assert.equal(result.hardStops[1]!.missingEvidence[0],"One required comparable is stale.");
  assert.equal(result.authorizesOffer,false);
});

test("economic amount changes cannot affect score because economics are not score inputs", () => {
  const input = fixture();
  const before = buildOfferReadinessScorecard(input);
  const economicEvidence = [1, 100000, 1_000_000].map(amount => {
    const scenario = structuredClone(input);
    scenario.DETERMINISTIC_MAO.evidence = [`MAO evidence: ${amount}`];
    return buildOfferReadinessScorecard(scenario).score;
  });
  assert.deepEqual(economicEvidence,[before.score,before.score,before.score]);
});
