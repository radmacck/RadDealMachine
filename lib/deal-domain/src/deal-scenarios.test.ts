import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDealScenarios } from "./deal-scenarios";
import type { Analysis } from "./types";

const analysis = (): Analysis => ({
  engineVersion:"test",calculatedAt:"2026-10-16T00:00:00.000Z",classification:"NEGOTIABLE",
  arv:{low:200000,expected:220000,high:240000,confidence:.8},
  repairs:{low:20000,expected:30000,high:50000,confidence:.7},
  repairEstimate:{status:"CALCULATED",calculatedAt:"2026-10-16T00:00:00.000Z",marketKey:"TEST",catalogVersion:1,lines:[],blockers:[],total:{low:20000,expected:30000,high:50000,confidence:.7}},
  preliminaryRepairEstimate:{status:"NOT_USED",calculatedAt:"2026-10-16T00:00:00.000Z",marketKey:"TEST",catalogVersion:1,hypotheses:[],lines:[],blockers:[],sourceWarnings:[],total:null},
  mao:0,openingLow:0,openingHigh:0,maximumApprovedAcquisitionPrice:null,spreadAtAsking:null,
  assumptions:{arvMultiplier:.7,sellingCostPct:.06,acquisitionCost:2500,holdingMonthly:1200,holdingMonths:3,assignmentTarget:15000,contingencyPct:.15,strongMargin:10000,openingLowPct:.8,openingHighPct:.9,maxCompAgeDays:180,maxDistanceMiles:1,maxSqftDifferencePct:.2,minComps:3,minConfidence:.65,approvalRequired:true,repairRateCatalogVersion:0,repairRates:[]},
  risks:[],blockers:[],compDecisions:[],formula:"test",
});

test("low/base/high scenarios deterministically propagate input ranges into MAO",()=>{
  const result=analyzeDealScenarios(analysis());
  assert.equal(result.calculationAvailable,true);
  assert.deepEqual(result.scenarios.map(s=>s.name),["LOW","BASE","HIGH"]);
  assert.ok(result.scenarios[0]!.mao < result.scenarios[1]!.mao);
  assert.ok(result.scenarios[1]!.mao < result.scenarios[2]!.mao);
  assert.equal(result.scenarios[1]!.mao,85200);
  assert.equal(result.scenarios[1]!.buyerMarginReserve,66000);
});

test("sensitivity bounds respond to uncertain inputs and zero-width envelope collapses configured costs",()=>{
  const result=analyzeDealScenarios(analysis(),0);
  const costs=result.sensitivities.find(row=>row.input==="Holding + closing costs")!;
  assert.equal(costs.lowMao,costs.baseMao);
  assert.equal(costs.highMao,costs.baseMao);
  const repair=result.sensitivities.find(row=>row.input==="Repairs")!;
  assert.ok(repair.lowMao < repair.baseMao && repair.baseMao < repair.highMao);
});

test("rounding, uncertainty limits, missing evidence and snapshot immutability are explicit",()=>{
  const saved=analysis();
  const original=structuredClone(saved);
  const result=analyzeDealScenarios(saved,33.333);
  assert.equal(result.scenarios[0]!.holdingAndClosingCosts,8133.31);
  assert.deepEqual(saved,original);
  assert.equal(analyzeDealScenarios(saved,100).uncertaintyPct,100);
  assert.throws(()=>analyzeDealScenarios(saved,101),/between 0 and 100/);
  assert.throws(()=>analyzeDealScenarios({...saved,arv:{...saved.arv,low:-1}}),/finite and nonnegative/);
  const missing={...saved,repairs:{low:0,expected:0,high:0,confidence:0},repairEstimate:{...saved.repairEstimate,status:"BLOCKED" as const}};
  const blocked=analyzeDealScenarios(missing);
  assert.equal(blocked.calculationAvailable,false);
  assert.ok(blocked.warnings.some(w=>/repair range is missing/i.test(w)));
});
