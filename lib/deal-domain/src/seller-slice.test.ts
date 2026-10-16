import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeDeal, DEFAULT_ASSUMPTIONS, validateProvenance, groupIntelligence,
  allowedTransitions, validateTransition, buildCallBrief, prioritizeCallQueue,
  type Lead, type UnderwritingInput, type IntelligenceInput,
} from "./index";

const now = new Date("2026-10-04T12:00:00Z");
const lead: Lead = {
  id:"00000000-0000-4000-8000-000000000001",address:"TEST SUBJECT 100 Example Lane",
  city:"Test City",state:"TX",county:"Test County",zip:"75001",
  propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,
  askingPrice:100000,sellerName:"Synthetic exercise seller",sellerPhone:"000-000-0000",
  source:"Synthetic automated test fixture, not a real property",urgency:"MEDIUM",
  stage:"STRONG",version:1,nextAction:"Review research before calling.",
  createdAt:now.toISOString(),updatedAt:now.toISOString(),followUpAt:null,
};
const input: UnderwritingInput = {
  version:1,repairsComplete:true,conditionConfirmed:true,
  comps:[290000,300000,310000].map((salePrice,index) => ({
    id:`test-comp-${index}`,address:`TEST COMP ${index} Example Road`,salePrice,
    sqft:1000,soldAt:"2026-09-30",distanceMiles:0.5,propertyType:"SINGLE_FAMILY",
    condition:"RENOVATED",source:"Synthetic verified-sale fixture",verified:true,
  })),
  repairs:[{category:"Interior and systems",low:10000,expected:20000,high:30000,confidence:0.8,source:"Synthetic inspection quote"}],
};
const hypothesis: IntelligenceInput = {
  classification:"AI_HYPOTHESIS",category:"motivation",statement:"Seller may prefer an expedited close.",
  source:"Synthetic model hypothesis",sourceType:"MODEL",confidence:0.4,capturedAt:now.toISOString(),
  question:"What closing timeline works for you?",action:"Ask seller; do not assume urgency.",
};

test("ARV, repairs, MAO, opening ranges and spread have exact reproducible arithmetic",() => {
  const result = analyzeDeal(lead,input,DEFAULT_ASSUMPTIONS,now);
  assert.deepEqual(result,analyzeDeal(lead,input,DEFAULT_ASSUMPTIONS,now));
  assert.deepEqual(result.arv,{low:290000,expected:300000,high:310000,confidence:0.65});
  assert.deepEqual(result.repairs,{low:10000,expected:20000,high:30000,confidence:0.8});
  assert.equal(result.mao,130000);
  assert.equal(result.openingLow,104000);
  assert.equal(result.openingHigh,117000);
  assert.equal(result.spreadAtAsking,30000,
    "buyer margin at asking must include the configured assignment target, not only the pre-assignment ceiling");
  assert.equal(result.classification,"STRONG");
  assert.equal(result.maximumApprovedAcquisitionPrice,null);
});
test("assignment economics reduce buyer spread and MAO dollar-for-dollar without authorizing an offer",() => {
  const noAssignment = analyzeDeal(lead,input,{...DEFAULT_ASSUMPTIONS,assignmentTarget:0},now);
  const standard = analyzeDeal(lead,input,DEFAULT_ASSUMPTIONS,now);
  const higherAssignment = analyzeDeal(lead,input,{...DEFAULT_ASSUMPTIONS,assignmentTarget:25000},now);
  assert.equal(noAssignment.spreadAtAsking! - standard.spreadAtAsking!,15000);
  assert.equal(standard.spreadAtAsking! - higherAssignment.spreadAtAsking!,10000);
  assert.equal(noAssignment.mao - standard.mao,15000);
  assert.equal(standard.mao - higherAssignment.mao,10000);
  assert.equal(standard.maximumApprovedAcquisitionPrice,null);
});
test("classification uses explicit conservative and expected-case thresholds",() => {
  assert.equal(analyzeDeal({...lead,askingPrice:140000},input,DEFAULT_ASSUMPTIONS,now).classification,"NEGOTIABLE");
  assert.equal(analyzeDeal({...lead,askingPrice:200000},input,DEFAULT_ASSUMPTIONS,now).classification,"PASS");
  const unknown = analyzeDeal({...lead,askingPrice:null},input,DEFAULT_ASSUMPTIONS,now);
  assert.equal(unknown.classification,"NEGOTIABLE");
  assert.equal(unknown.spreadAtAsking,null);
  assert.match(unknown.risks.join(" " ),/Asking price unknown/);
});
test("missing or incomplete repairs never become zero-cost completed underwriting",() => {
  for (const incomplete of [{...input,repairs:[]},{...input,repairsComplete:false},{...input,conditionConfirmed:false}]) {
    assert.equal(analyzeDeal(lead,incomplete,DEFAULT_ASSUMPTIONS,now).classification,"INCOMPLETE");
  }
});
test("nonresidential and multi-unit subjects fail explicitly instead of guessing",() => {
  const unsupported = analyzeDeal({...lead,propertyType:"LAND",units:2},input,DEFAULT_ASSUMPTIONS,now);
  assert.equal(unsupported.classification,"INCOMPLETE");
  assert.match(unsupported.blockers.join(" "),/adapter/);
});
test("comp filters explain future, age, geography, type, size, condition and verification mismatches",() => {
  const variants = [
    {soldAt:"2026-10-05"},{soldAt:"2020-01-01"},{distanceMiles:3},{propertyType:"LAND"},
    {sqft:2000},{condition:"UNKNOWN" as const},{verified:false},
  ];
  for (const variant of variants) {
    const result = analyzeDeal(lead,{...input,comps:[{...input.comps[0]!,...variant},...input.comps.slice(1)]},DEFAULT_ASSUMPTIONS,now);
    assert.equal(result.compDecisions[0]!.included,false);
    assert.ok(result.compDecisions[0]!.reasons.length);
    assert.equal(result.classification,"INCOMPLETE");
  }
});
test("duplicate and subject-address comps cannot inflate confidence",() => {
  const duplicates = analyzeDeal(lead,{...input,comps:[...input.comps,{...input.comps[0]!,id:"new-id"}]},DEFAULT_ASSUMPTIONS,now);
  assert.equal(duplicates.compDecisions[3]!.included,false);
  assert.equal(duplicates.arv.confidence,0.65);
  const subject = analyzeDeal(lead,{...input,comps:[{...input.comps[0]!,address:lead.address},...input.comps.slice(1)]},DEFAULT_ASSUMPTIONS,now);
  assert.equal(subject.classification,"INCOMPLETE");
});
test("versioned outlier rule excludes abnormal price per sqft",() => {
  const result = analyzeDeal(lead,{...input,comps:[...input.comps,{...input.comps[0]!,id:"outlier",address:"TEST OUTLIER",salePrice:900000}]},DEFAULT_ASSUMPTIONS,now);
  assert.equal(result.compDecisions[3]!.included,false);
  assert.match(result.compDecisions[3]!.reasons.join(),/30%/);
});
test("invalid negative, nonfinite and reversed-range numeric inputs fail explicitly",() => {
  assert.throws(() => analyzeDeal({...lead,sqft:NaN},input,DEFAULT_ASSUMPTIONS,now));
  assert.throws(() => analyzeDeal(lead,{...input,repairs:[{...input.repairs[0]!,high:-1}]},DEFAULT_ASSUMPTIONS,now));
  assert.throws(() => analyzeDeal(lead,{...input,repairs:[{...input.repairs[0]!,low:25000}]},DEFAULT_ASSUMPTIONS,now),/low/);
  assert.throws(() => analyzeDeal(lead,input,{...DEFAULT_ASSUMPTIONS,approvalRequired:false},now),/authorization/);
  assert.throws(() => analyzeDeal(lead,input,{...DEFAULT_ASSUMPTIONS,openingLowPct:0.95},now),/Opening range/);
});
test("configured insufficient confidence blocks readiness",() => {
  const result = analyzeDeal(lead,input,{...DEFAULT_ASSUMPTIONS,minConfidence:0.8},now);
  assert.equal(result.classification,"INCOMPLETE");
  assert.match(result.blockers.join(),/confidence/);
});
test("model output cannot be promoted to any non-hypothesis section",() => {
  for (const classification of ["VERIFIED_FACTS","OBSERVED","INDICATED"] as const) {
    assert.throws(() => validateProvenance({...hypothesis,classification},now),/Model output/);
  }
  validateProvenance(hypothesis,now);
});
test("hypotheses require uncertainty, question and action; future evidence is rejected",() => {
  for (const change of [{confidence:1},{question:""},{action:""}]) {
    assert.throws(() => validateProvenance({...hypothesis,...change},now));
  }
  assert.throws(() => validateProvenance({...hypothesis,capturedAt:"2027-01-01T12:00:00Z"},now),/future/);
});
test("seller assertions cannot be verified facts; public-record verification requires a note",() => {
  assert.throws(() => validateProvenance({...hypothesis,classification:"VERIFIED_FACTS",sourceType:"SELLER"},now),/seller/i);
  assert.throws(() => validateProvenance({...hypothesis,classification:"VERIFIED_FACTS",sourceType:"PUBLIC_RECORD"},now),/verification note/);
  validateProvenance({...hypothesis,classification:"VERIFIED_FACTS",sourceType:"PUBLIC_RECORD",verificationNote:"Compared to dated assessor record."},now);
  assert.deepEqual(Object.keys(groupIntelligence([])),["VERIFIED_FACTS","OBSERVED","INDICATED","AI_HYPOTHESIS"]);
});
test("call readiness rejects incomplete/pass/stale underwriting and absent phone",() => {
  const analysis = analyzeDeal(lead,input,DEFAULT_ASSUMPTIONS,now);
  assert.ok(allowedTransitions(lead,analysis,now).includes("CALL_READY"));
  assert.ok(!allowedTransitions({...lead,sellerPhone:""},analysis,now).includes("CALL_READY"));
  assert.ok(!allowedTransitions(lead,{...analysis,classification:"PASS"},now).includes("CALL_READY"));
  assert.ok(!allowedTransitions(lead,analysis,new Date("2026-10-12T12:00:00Z")).includes("CALL_READY"));
  assert.throws(() => validateTransition(lead,analysis,{version:1,to:"UNDER_CONTRACT",reason:"Cannot skip",nextAction:"Must not reach downstream."},now),/not available/);
});
test("call briefs preserve hypotheses and expose questions/actions without authorizing prices",() => {
  const entry = {...hypothesis,id:"entry",leadId:lead.id,createdBy:"test",createdAt:now.toISOString()};
  const brief = buildCallBrief(lead,[entry],analyzeDeal(lead,input,DEFAULT_ASSUMPTIONS,now));
  assert.equal(brief.intelligence[0]!.classification,"AI_HYPOTHESIS");
  assert.ok(brief.questions.includes(hypothesis.question!));
  assert.ok(brief.actions.includes(hypothesis.action!));
  assert.match(brief.boundaries,/No price is authorized/);
});
test("call queue ranks overdue then urgency, suppresses future followups and stale analyses",() => {
  const analysis = analyzeDeal(lead,input,DEFAULT_ASSUMPTIONS,now);
  const plain = buildCallBrief({...lead,stage:"CALL_READY"},[],analysis);
  const overdue = buildCallBrief({...lead,id:"overdue",stage:"CONTACTED",followUpAt:"2026-10-03T12:00:00Z",urgency:"LOW"},[],analysis);
  const future = buildCallBrief({...lead,id:"future",stage:"CONVERSATION",followUpAt:"2026-10-05T12:00:00Z"},[],analysis);
  assert.deepEqual(prioritizeCallQueue([plain,future,overdue],now).map(b => b.lead.id),["overdue",lead.id]);
  assert.equal(prioritizeCallQueue([plain],new Date("2026-10-12T12:00:00Z")).length,0);
});