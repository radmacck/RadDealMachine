import test from "node:test";
import assert from "node:assert/strict";
import type { Intelligence, Lead, RepairObservation, RepairRateCard, UnderwritingInput } from "./types";
import { DEFAULT_ASSUMPTIONS, analyzeDeal } from "./underwriting";
import { estimateRepairScope } from "./repair-estimation";

const now = new Date("2026-10-06T12:00:00.000Z");
const lead: Lead = {
  id:"00000000-0000-4000-8000-000000000031",
  address:"SYNTHETIC SUBJECT 100 TEST LANE",city:"Philadelphia",state:"PA",county:"Philadelphia County",zip:"19100",
  propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,askingPrice:100000,
  sellerName:"SYNTHETIC TEST ONLY",sellerPhone:"000-000-0000",source:"Synthetic automated test",
  urgency:"MEDIUM",stage:"ANALYZED",version:1,nextAction:"Synthetic test only.",
  createdAt:now.toISOString(),updatedAt:now.toISOString(),followUpAt:null,
};
const observation: RepairObservation = {category:"Roof",severity:"MODERATE",quantity:100,unit:"SQFT",evidenceId:"inspection-roof"};
const evidence: Intelligence = {
  id:"inspection-roof",leadId:lead.id,createdBy:"synthetic-test",createdAt:now.toISOString(),
  classification:"VERIFIED_FACTS",category:"repair_scope:Roof",
  statement:"SYNTHETIC fixture: inspection measured a moderate roof repair area of 100 square feet.",
  source:"SYNTHETIC inspection fixture",sourceType:"INSPECTION",sourceUrl:"https://example.invalid/synthetic-inspection",
  confidence:0.9,capturedAt:"2026-10-05T12:00:00.000Z",verificationNote:"Synthetic test fixture; no real property evidence.",
};
const rate: RepairRateCard = {
  id:"synthetic-philly-roof-moderate-sqft-v1",version:1,marketKey:"PHILADELPHIA-PA",category:"Roof",
  severity:"MODERATE",unit:"SQFT",lowRate:4,expectedRate:6,highRate:8,confidence:0.85,
  source:"SYNTHETIC test-only cost card",sourceUrl:"https://example.invalid/synthetic-cost-card",
  capturedOn:"2026-09-01",validThrough:"2026-12-31",active:true,
};

test("condition observations calculate deterministic ranges from current market rates and reviewed inspection evidence",()=>{
  const assumptions = {...DEFAULT_ASSUMPTIONS,repairRateCatalogVersion:1,repairRates:[rate]};
  const estimate = estimateRepairScope(lead,[observation],assumptions,[evidence],now);
  assert.equal(estimate.status,"CALCULATED");
  assert.equal(estimate.marketKey,"PHILADELPHIA-PA");
  assert.deepEqual(estimate.total,{low:400,expected:600,high:800,confidence:0.85});
  assert.equal(estimate.lines[0]?.rateCardId,rate.id);
  assert.equal(estimate.lines[0]?.sourceUrl,rate.sourceUrl);
  const underwriting: UnderwritingInput = {
    version:1,comps:[290000,300000,310000].map((salePrice,index)=>({
      id:`synthetic-comp-${index}`,address:`SYNTHETIC COMP ${index} TEST ROAD`,salePrice,sqft:1000,
      soldAt:"2026-09-30",distanceMiles:0.5,propertyType:"SINGLE_FAMILY",condition:"RENOVATED",
      source:"SYNTHETIC test comp",verified:true,
    })),
    repairs:[],repairObservations:[observation],repairsComplete:true,conditionConfirmed:true,
  };
  const analysis = analyzeDeal(lead,underwriting,assumptions,now,[evidence]);
  assert.deepEqual(analysis.repairs,{low:400,expected:600,high:800,confidence:0.85});
  assert.equal(analysis.repairEstimate.status,"CALCULATED");
  assert.equal(analysis.blockers.length,0);
});

test("missing or expired market rates withhold repair totals and MAO instead of assuming zero",()=>{
  const missing = analyzeDeal(lead,{
    version:1,comps:[],repairs:[],repairObservations:[observation],repairsComplete:true,conditionConfirmed:true,
  },DEFAULT_ASSUMPTIONS,now,[evidence]);
  assert.equal(missing.repairEstimate.status,"BLOCKED");
  assert.equal(missing.repairEstimate.total,null);
  assert.deepEqual(missing.repairs,{low:0,expected:0,high:0,confidence:0});
  assert.equal(missing.mao,0);
  assert.equal(missing.spreadAtAsking,null);
  assert.match(missing.blockers.join(" "),/no active, source-backed PHILADELPHIA-PA rate/);

  const expired = {...rate,validThrough:"2026-10-05"};
  const expiredResult = estimateRepairScope(lead,[observation],{...DEFAULT_ASSUMPTIONS,repairRates:[expired]},[evidence],now);
  assert.equal(expiredResult.status,"BLOCKED");
});

test("zero-repair observation requires reviewed inspection evidence but no invented cost rate",()=>{
  const noRepair: RepairObservation = {...observation,severity:"NO_REPAIR",quantity:0};
  const estimate = estimateRepairScope(lead,[noRepair],DEFAULT_ASSUMPTIONS,[evidence],now);
  assert.equal(estimate.status,"CALCULATED");
  assert.deepEqual(estimate.total,{low:0,expected:0,high:0,confidence:0.9});
  const unreviewed = estimateRepairScope(lead,[noRepair],DEFAULT_ASSUMPTIONS,[{...evidence,classification:"OBSERVED"}],now);
  assert.equal(unreviewed.status,"BLOCKED");
  assert.equal(unreviewed.total,null);
});

test("stale, wrong-category, seller, and AI evidence cannot drive automatic repair estimates",()=>{
  const invalidEvidence = [
    {...evidence,capturedAt:"2026-08-01T12:00:00.000Z"},
    {...evidence,category:"subject_condition"},
    {...evidence,sourceType:"SELLER" as const},
    {...evidence,classification:"AI_HYPOTHESIS" as const,sourceType:"MODEL" as const},
    {...evidence,sourceUrl:undefined},
  ];
  for (const item of invalidEvidence) {
    const estimate = estimateRepairScope(lead,[observation],{...DEFAULT_ASSUMPTIONS,repairRates:[rate]},[item],now);
    assert.equal(estimate.status,"BLOCKED");
    assert.equal(estimate.total,null);
  }
});
