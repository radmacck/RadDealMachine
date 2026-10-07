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

test("current listing condition phrases create provenance-linked AI hypotheses and rate scenarios without changing MAO",()=>{
  const listing: Intelligence = {
    id:"listing-remarks-roof",leadId:lead.id,createdBy:"synthetic-test",createdAt:now.toISOString(),
    classification:"OBSERVED",category:"listing_remarks",
    statement:"SYNTHETIC listing remarks report a roof leak and a dated kitchen; inspection is still required.",
    source:"SYNTHETIC permitted listing fixture",sourceType:"PERMITTED_LISTING",
    sourceUrl:"https://example.invalid/synthetic-listing",confidence:0.8,
    capturedAt:"2026-10-05T12:00:00.000Z",
  };
  const duplicateListing: Intelligence = {
    ...listing,id:"listing-copy-roof",source:"SYNTHETIC second listing source",
    sourceUrl:"https://example.invalid/synthetic-listing-copy",
  };
  const lumpSumCards: RepairRateCard[] = [
    {...rate,id:"synthetic-roof-lump-v1",severity:"MODERATE",unit:"LUMP_SUM",lowRate:2500,expectedRate:3000,highRate:3500},
    {...rate,id:"synthetic-finishes-lump-v1",category:"Interior finishes",severity:"COSMETIC",unit:"LUMP_SUM",
      lowRate:1000,expectedRate:2000,highRate:3000},
  ];
  const assumptions = {...DEFAULT_ASSUMPTIONS,repairRateCatalogVersion:2,repairRates:[rate,...lumpSumCards]};
  const input: UnderwritingInput = {
    version:1,comps:[290000,300000,310000].map((salePrice,index)=>({
      id:`synthetic-condition-comp-${index}`,address:`SYNTHETIC COMP ${index} CONDITION ROAD`,
      salePrice,sqft:1000,soldAt:"2026-09-30",distanceMiles:0.5,
      propertyType:"SINGLE_FAMILY",condition:"RENOVATED",source:"SYNTHETIC test comp",verified:true,
    })),
    repairs:[],repairObservations:[observation],repairsComplete:true,conditionConfirmed:true,
  };
  const withoutRemarks = analyzeDeal(lead,input,assumptions,now,[evidence]);
  const withRemarks = analyzeDeal(lead,input,assumptions,now,[evidence,listing,duplicateListing]);
  const preliminary = withRemarks.preliminaryRepairEstimate;

  assert.equal(preliminary.status,"CALCULATED");
  assert.equal(preliminary.hypotheses.length,4,"Both sourced remarks and both supported phrases remain traceable.");
  assert.ok(preliminary.hypotheses.every(item=>item.epistemicStatus==="AI_HYPOTHESIS"));
  assert.ok(preliminary.hypotheses.every(item=>item.confidenceMethod==="EXPLICIT_PHRASE_RULE_UNCALIBRATED"));
  assert.equal(preliminary.lines.length,2,"Repeated reports of the same roof work do not double-count a category.");
  assert.equal(preliminary.lines.find(line=>line.category==="Roof")?.hypothesisIds.length,2);
  assert.deepEqual(preliminary.total,{low:3500,expected:5000,high:6500,confidence:0.4});
  assert.deepEqual(withRemarks.repairs,withoutRemarks.repairs,"Listing phrases do not replace inspected repair scope.");
  assert.equal(withRemarks.mao,withoutRemarks.mao,"AI hypotheses and preliminary rate scenarios never feed MAO.");
  assert.equal(preliminary.hypotheses.find(item=>item.category==="Roof")?.evidenceId,listing.id);
});

test("negated, stale, unlinked, and model condition remarks are excluded with explicit provenance warnings",()=>{
  const makeListing = (overrides:Partial<Intelligence>):Intelligence=>({
    id:"listing-remarks-invalid",leadId:lead.id,createdBy:"synthetic-test",createdAt:now.toISOString(),
    classification:"OBSERVED",category:"condition",statement:"SYNTHETIC listing reports a roof leak.",
    source:"SYNTHETIC listing",sourceType:"PERMITTED_LISTING",sourceUrl:"https://example.invalid/listing",
    confidence:0.8,capturedAt:"2026-10-05T12:00:00.000Z",...overrides,
  });
  const freshNegative = makeListing({statement:"SYNTHETIC listing says there is no roof leak."});
  const stale = makeListing({id:"listing-stale",capturedAt:"2026-08-01T12:00:00.000Z"});
  const unlinked = makeListing({id:"listing-unlinked",sourceUrl:undefined});
  const model = makeListing({id:"model-condition",sourceType:"MODEL",classification:"AI_HYPOTHESIS"});
  const estimate = analyzeDeal(lead,{
    version:1,comps:[],repairs:[],repairsComplete:false,conditionConfirmed:false,
  },DEFAULT_ASSUMPTIONS,now,[freshNegative,stale,unlinked,model]).preliminaryRepairEstimate;
  assert.equal(estimate.status,"NOT_USED");
  assert.equal(estimate.hypotheses.length,0);
  assert.equal(estimate.total,null);
  assert.ok(estimate.sourceWarnings.some(warning=>warning.includes("stale or invalid")));
  assert.ok(estimate.sourceWarnings.some(warning=>warning.includes("HTTP(S) source link")));
  assert.ok(estimate.sourceWarnings.some(warning=>warning.includes("model hypothesis")));
});

test("a recognized condition phrase without a current market lump-sum card withholds its scenario total",()=>{
  const listing: Intelligence = {
    id:"listing-no-rate",leadId:lead.id,createdBy:"synthetic-test",createdAt:now.toISOString(),
    classification:"INDICATED",category:"listing_description",statement:"SYNTHETIC seller description: foundation settling.",
    source:"SYNTHETIC owner-provided listing",sourceType:"SELLER",sourceUrl:"https://example.invalid/seller-listing",
    confidence:0.8,capturedAt:"2026-10-05T12:00:00.000Z",
  };
  const estimate = analyzeDeal(lead,{version:1,comps:[],repairs:[],repairsComplete:false,conditionConfirmed:false},
    DEFAULT_ASSUMPTIONS,now,[listing]).preliminaryRepairEstimate;
  assert.equal(estimate.status,"BLOCKED");
  assert.equal(estimate.total,null);
  assert.match(estimate.blockers.join(" "),/no current source-backed PHILADELPHIA-PA LUMP_SUM rate/);
  assert.equal(estimate.hypotheses[0]?.epistemicStatus,"AI_HYPOTHESIS");
});
