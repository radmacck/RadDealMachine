import test from "node:test";
import assert from "node:assert/strict";
import { buyerIdentityConflicts, matchBuyer, rankBuyerMatches, verificationStatus, evidenceUrl, type Buyer, type DealContract } from "./buyers";
import type { LeadDetail } from "./types";
import { analyzeDeal, DEFAULT_ASSUMPTIONS } from "./underwriting";
import { qualificationMaintenanceKind } from "./buyer-qualification";
import { buyerQualification, criteriaSignature } from "./buyer-qualification";
import { evaluateCurrentBuyerDemand } from "./lead-qualification";
const now = new Date("2026-10-04T12:00:00Z");
const buyer: Buyer = {
  id:"synthetic-buyer",version:1,name:"SYNTHETIC BUYER",email:"synthetic@example.com",phone:"",source:"Owner-reviewed buyer profile",status:"ACTIVE",
  criteria:{states:["TX"],cities:["Test City"],zipCodes:[],propertyTypes:["SINGLE_FAMILY"],maxPurchasePrice:200000,maxRepairs:50000,
    minBeds:2,minSqft:500,maxSqft:2000,closingDays:3,counties:[],excludedCounties:[],excludedCities:[],excludedZipCodes:[],
    minPurchasePrice:0,minUnits:1,maxUnits:1,minBaths:1,rehabTolerance:"HEAVY",strategies:["FLIP"],fundingTypes:["CASH"],maxConcurrentDeals:2},
  verifiedFundingTypes:["CASH"],verificationStatus:"VERIFIED",verifiedBy:"synthetic-owner",verifiedAt:now.toISOString(),evidenceAt:now.toISOString(),
  validUntil:"2026-10-20T12:00:00Z",availableFunds:200000,createdAt:now.toISOString(),updatedAt:now.toISOString(),
  destinationKind:"BUYER",identityEvidenceUrl:"https://example.com/synthetic-id",fundingEvidenceUrl:"https://example.com/synthetic-funds",
  currentBuyingStatus:"BUYING",buyingVerifiedAt:now.toISOString(),buyingEvidenceAt:now.toISOString(),
  buyingEvidenceUrl:"https://example.com/synthetic-buying",criteriaEvidenceUrl:"https://example.com/synthetic-criteria",
  verificationSource:"Synthetic reviewed response",confidence:0.9,
};

test("early buyer-demand fit counts only approved current buyers and cannot claim an underwritten deal match",()=>{
  const subject = {
    state:"TX",county:"Test County",city:"Test City",zip:"75001",propertyType:"SINGLE_FAMILY",
    sqft:1000,beds:3,baths:2,
  };
  const aligned = evaluateCurrentBuyerDemand(subject,[buyer],now);
  assert.equal(aligned.status,"ALIGNED_ON_KNOWN_FIELDS");
  assert.equal(aligned.alignedBuyerCount,1);
  assert.equal(aligned.priorityBonus,5);
  assert.ok(aligned.missingInformation.some(item=>item.toLowerCase().includes("asking/acquisition price")));
  assert.ok(aligned.evidence[0]!.reason.includes("not a deal-level match"));

  const mismatch = {...buyer,id:"synthetic-city-mismatch",criteria:{...buyer.criteria!,cities:["Other City"]}};
  const stale = {...buyer,id:"synthetic-stale-demand",validUntil:"2026-10-03T12:00:00Z"};
  const excluded = evaluateCurrentBuyerDemand(subject,[mismatch,stale],now);
  assert.equal(excluded.alignedBuyerCount,0);
  assert.equal(excluded.currentQualifiedBuyerCount,1);
  assert.equal(excluded.unqualifiedBuyerCount,1);
  assert.equal(excluded.excludedForKnownCriteriaMismatch,1);
});
const contract: DealContract = {
  id:"synthetic-contract",leadId:"synthetic-deal",offerId:"synthetic-offer",version:1,status:"UNDER_CONTRACT",
  purchasePrice:100000,assignmentTarget:15000,earnestMoney:1000,assignmentAllowed:true,closingAt:"2026-10-18T12:00:00Z",
  contingencies:"Synthetic terms",milestones:[],deadlineScheduleVersion:0,deadlineScheduleHistory:[],createdAt:now.toISOString(),
};
const lead: LeadDetail["lead"] = {
  id:"synthetic-deal",address:"SYNTHETIC SUBJECT",city:"Test City",state:"TX",county:"Synthetic County",zip:"75001",
  propertyType:"SINGLE_FAMILY",beds:3,baths:2,sqft:1000,units:1,sellerName:"Synthetic Seller",source:"Synthetic test",
  stage:"UNDER_CONTRACT",version:1,nextAction:"Review buyer fit.",createdAt:now.toISOString(),updatedAt:now.toISOString(),
};
const underwriting: NonNullable<LeadDetail["underwriting"]> = {
  version:1,conditionConfirmed:true,repairsComplete:true,
  comps:[290000,300000,310000].map((salePrice,i)=>({id:`synthetic-comp-${i}`,address:`SYNTHETIC COMP ${i}`,
    sqft:1000,salePrice,soldAt:"2026-10-01",distanceMiles:0.5,propertyType:"SINGLE_FAMILY",condition:"RENOVATED",source:"Synthetic evidence",verified:true})),
  repairs:[{category:"Synthetic repairs",low:10000,expected:20000,high:30000,confidence:0.8,source:"Synthetic evidence"}],
};
const analysis = analyzeDeal(lead,underwriting,DEFAULT_ASSUMPTIONS,now);
const detail: LeadDetail = {lead,analysis,analysisSnapshotId:"synthetic-snapshot",underwriting,intelligence:[],offers:[],calls:[],transitions:[],allowedTransitions:[],workGuidance:null};
test("matching explains current qualified fit, not just a magic score",()=>{
  const m = matchBuyer(buyer,detail,contract,now);
  assert.equal(m.eligible,true); assert.equal(m.score,100);
  assert.equal(m.mismatches.length,0); assert.ok(m.reasons.length>10);
});
test("match records distinguish verified buyers, synthetic fixtures and contact permission without turning fit into consent",()=>{
  const record = {...buyer,source:"Owner-reviewed buyer profile"} as Buyer & {contactPermission?: {status:string;channels:string[];evidenceUrl:string;source:string;capturedAt:string;validUntil:string}};
  const noPermission = matchBuyer(record,detail,contract,now);
  assert.ok(noPermission.reasons.includes("Buyer standing: verified buyer."));
  assert.ok(noPermission.reasons.includes("Contact permission: not_reviewed; matching does not authorize outreach."));
  const permittedBuyer = Object.assign({},record,{contactPermission:{status:"GRANTED",channels:["EMAIL"],evidenceUrl:"https://example.com/consent",source:"Owner review",capturedAt:now.toISOString(),validUntil:"2026-10-20T12:00:00Z"}});
  const permitted = matchBuyer(permittedBuyer,detail,contract,now);
  assert.ok(permitted.reasons.some(reason=>reason.startsWith("Contact permission: permitted")));
  assert.equal(permitted.eligible,true,"fit remains distinct from the permission gate for outreach");
  const staleBuyer = Object.assign({},record,{contactPermission:{status:"GRANTED",channels:["EMAIL"],evidenceUrl:"https://example.com/consent",source:"Owner review",capturedAt:now.toISOString(),validUntil:"2026-10-04T11:59:59Z"}});
  const stale = matchBuyer(staleBuyer,detail,contract,now);
  assert.ok(stale.reasons.some(reason=>reason.startsWith("Contact permission: stale")));
  const fixture = matchBuyer({...buyer,source:"SYNTHETIC FIXTURE: demo record"},detail,contract,now);
  assert.ok(fixture.reasons.includes("Buyer standing: synthetic fixture."));
  assert.equal(fixture.eligible,false,"explicit fixtures must not count as real acquisition demand");
  assert.ok(fixture.mismatches.includes("Synthetic fixture cannot count as live buyer demand."));
  assert.ok(matchBuyer({...record,validUntil:"2026-10-03T12:00:00Z"},detail,contract,now).reasons.includes("Buyer standing: stale."));
});
test("a synthetic fixture can never display as an approved real buyer, even with current-looking proof fields",()=>{
  for (const fixture of [
    {...buyer,source:"Synthetic buyer exercise record"},
    {...buyer,source:"Owner-reviewed buyer profile",syntheticFixture:true},
  ]) {
    const qualification=buyerQualification(fixture,now);
    assert.notEqual(qualification.approvalStatus,"APPROVED");
    assert.ok(qualification.qualificationBlockers.some(reason=>/Synthetic fixture is not a real buyer/.test(reason)));
    assert.equal(matchBuyer(fixture,detail,contract,now).eligible,false);
  }
});
test("buyer ranking is deterministic: eligible, then checklist fit, then stable buyer ID",()=>{
  const rows = [
    {buyerId:"z",eligible:true,score:80},{buyerId:"b",eligible:false,score:100},
    {buyerId:"c",eligible:true,score:90},{buyerId:"a",eligible:true,score:90},
  ];
  assert.deepEqual(rankBuyerMatches(rows).map(row=>row.buyerId),["a","c","z","b"]);
  assert.deepEqual(rankBuyerMatches(rows).map(row=>row.buyerId),rankBuyerMatches(rows).map(row=>row.buyerId));
});

test("duplicate email or phone routes block recipient eligibility without merging buyer records",()=>{
  const sameEmail={...buyer,id:"duplicate-email",email:buyer.email.toUpperCase()};
  assert.deepEqual(buyerIdentityConflicts(buyer,[buyer,sameEmail]),[
    "Contact route conflicts with 1 other buyer record(s); resolve identity before package distribution.",
  ]);
  const samePhone={...buyer,id:"duplicate-phone",email:"other@example.com",phone:"+1 (555) 123-4567"};
  const routeOwner={...samePhone,id:"route-owner",phone:"5551234567"};
  assert.equal(buyerIdentityConflicts(samePhone,[samePhone,routeOwner]).length,1);
  assert.deepEqual(buyerIdentityConflicts(buyer,[buyer]),[]);
});
test("newer actual reply blocks otherwise-qualified matching until dated owner review",()=>{
  const withReply = {...buyer,lastOutreachReplyAt:"2026-10-05T12:00:01Z",lastOutreachReplyEvidenceUrl:"https://example.com/synthetic-new-reply"};
  const evaluated = matchBuyer(withReply,detail,contract,new Date("2026-10-05T12:00:02Z"));
  assert.equal(evaluated.eligible,false); assert.match(evaluated.mismatches.join(";"),/newer actual outreach reply/);
  const reviewed = {...withReply,buyingEvidenceAt:"2026-10-05T12:00:01Z",buyingVerifiedAt:"2026-10-05T12:00:02Z"};
  assert.equal(matchBuyer(reviewed,detail,contract,new Date("2026-10-05T12:00:02Z")).eligible,true);
});
test("maintenance preserves pending human review through qualification-kind and expiry changes",()=>{
  for (const kind of ["QUALIFY","REVERIFY"] as const) for (const at of ["2026-10-05T12:00:00Z","2026-12-05T12:00:00Z"]) {
    const pending = {...buyer,qualificationTask:{id:"synthetic-review",kind,state:"WAITING_REVIEW" as const,
      reason:"SYNTHETIC actual reply awaiting review",preparedMessage:"Not sent",dueAt:at,updatedAt:at}};
    assert.equal(qualificationMaintenanceKind(pending,new Date(at)),null);
  }
  assert.equal(qualificationMaintenanceKind({...buyer,qualificationTask:{id:"synthetic-completed",kind:"QUALIFY",state:"COMPLETED",
    reason:"Reviewed",preparedMessage:"Not sent",dueAt:"2026-10-05T12:00:00Z",updatedAt:"2026-10-05T12:00:00Z"}},
    new Date("2026-12-05T12:00:00Z")),"REVERIFY");
});
test("funding preferences are not evidenced methods and loan funding does not pass native cash assignment",()=>{
  const missing = matchBuyer({...buyer,verifiedFundingTypes:undefined},detail,contract,now);
  assert.equal(missing.eligible,false);
  const loan = matchBuyer({...buyer,verifiedFundingTypes:["CONVENTIONAL"],criteria:{...buyer.criteria!,fundingTypes:["CONVENTIONAL"]}},detail,contract,now);
  assert.equal(loan.eligible,false); assert.ok(loan.mismatches.some(m=>m.includes("requires CASH")));
  assert.equal(matchBuyer({...buyer,criteria:{...buyer.criteria!,fundingTypes:["HARD_MONEY"]}},detail,contract,now).eligible,false);
});
test("matching exposes geographical, budget, rehab, size and funding exclusions",()=>{
  const b = {...buyer,availableFunds:50000,criteria:{...buyer.criteria!,states:["CA"],cities:["Other City"],maxPurchasePrice:50000,maxRepairs:1000,minBeds:5}};
  const m = matchBuyer(b,detail,contract,now);
  assert.equal(m.eligible,false);
  for (const word of ["State","City/ZIP","budget","funds","rehab","Beds"]) assert.ok(m.mismatches.some(s=>s.includes(word)));
});
test("missing or stale buyer verification never becomes eligible",()=>{
  assert.equal(matchBuyer({...buyer,verifiedBy:null},detail,contract,now).eligible,false);
  assert.equal(matchBuyer({...buyer,validUntil:now.toISOString()},detail,contract,now).eligible,false);
  assert.equal(verificationStatus({...buyer,evidenceAt:"2026-09-01T12:00:00Z"},now),"STALE");
  assert.equal(matchBuyer({...buyer,status:"PAUSED"},detail,contract,now).eligible,false);
});
test("unexecuted contracts, no assignment, expired underwriting and infeasible deadlines block matching",()=>{
  assert.equal(matchBuyer(buyer,detail,null,now).eligible,false);
  assert.equal(matchBuyer(buyer,detail,{...contract,status:"DRAFT"},now).eligible,false);
  assert.equal(matchBuyer(buyer,detail,{...contract,assignmentAllowed:false},now).eligible,false);
  assert.equal(matchBuyer(buyer,detail,{...contract,closingAt:"2026-10-05T12:00:00Z"},now).eligible,false);
  assert.equal(matchBuyer(buyer,{...detail,analysis:{...detail.analysis!,calculatedAt:"2026-09-20T12:00:00Z"}},contract,now).eligible,false);
});
test("actual committed price is checked against available funds; evidence references reject credentials and unsafe schemes",()=>{
  assert.equal(matchBuyer(buyer,detail,contract,now,250000).eligible,false);
  assert.throws(()=>evidenceUrl("javascript:alert(1)"));
  assert.throws(()=>evidenceUrl("https://synthetic:synthetic@example.com/evidence"));
  assert.equal(evidenceUrl("https://example.com/evidence"),"https://example.com/evidence");
});
test("maximum price and available funds are inclusive at the exact verified boundary",()=>{
  assert.equal(matchBuyer(buyer,detail,contract,now,buyer.criteria!.maxPurchasePrice).eligible,true);
  assert.equal(matchBuyer(buyer,detail,contract,now,buyer.criteria!.maxPurchasePrice+0.01).eligible,false);
  assert.equal(matchBuyer({...buyer,availableFunds:buyer.criteria!.maxPurchasePrice},detail,contract,now,
    buyer.criteria!.maxPurchasePrice).eligible,true);
  assert.equal(matchBuyer({...buyer,availableFunds:buyer.criteria!.maxPurchasePrice-0.01},detail,contract,now,
    buyer.criteria!.maxPurchasePrice).eligible,false);
});
test("bank verification alone never grandfathers a buyer into the approved current pool",()=>{
  const legacy = {...buyer,currentBuyingStatus:undefined,buyingVerifiedAt:undefined};
  assert.equal(verificationStatus(legacy,now),"VERIFIED");
  assert.equal(buyerQualification(legacy,now).approvalStatus,"QUALIFICATION_REQUIRED");
  assert.equal(matchBuyer(legacy,detail,contract,now).eligible,false);
  assert.equal(matchBuyer({...buyer,criteria:null,verifiedBy:null},detail,contract,now).eligible,false);
});
test("current buying evidence and reviewer confidence are independent approval gates",()=>{
  for (const changed of [
    {currentBuyingStatus:"NOT_BUYING" as const},{confidence:0.55},{criteriaEvidenceUrl:null},{verificationSource:null},
    {buyingEvidenceAt:"2026-09-01T12:00:00Z"},{buyingVerifiedAt:"2026-10-05T12:00:00Z"},{email:"",phone:""},
  ]) assert.equal(matchBuyer({...buyer,...changed},detail,contract,now).eligible,false);
  assert.equal(buyerQualification({...buyer,buyingEvidenceAt:"2026-09-01T12:00:00Z"},now).approvalStatus,"REVERIFICATION_REQUIRED");
});
test("structured criteria veto county exclusions, units, baths, price, ARV, rehab, unsupported returns and policy spread",()=>{
  const c = buyer.criteria!;
  for (const changed of [
    {counties:["Other County"]},{excludedCounties:[" SYNTHETIC COUNTY "]},{excludedCities:["Test City"]},{excludedZipCodes:["75001"]},
    {minUnits:2,maxUnits:4},{maxUnits:0},{minBaths:3},{maxBeds:2},{maxBaths:1},
    {minPurchasePrice:150000},{minArv:1000000},{maxArv:1000},{rehabTolerance:"NONE" as const},
    {strategies:["RENTAL" as const]},{minCapRate:0.08},{minSpread:1000000},{maxConcurrentDeals:1},
  ]) assert.equal(matchBuyer({...buyer,criteria:{...c,...changed}},detail,contract,now,undefined,1).eligible,false,JSON.stringify(changed));
  assert.equal(matchBuyer({...buyer,criteria:{...c,counties:["synthetic county"]}},detail,contract,now).eligible,true);
});
test("JSONB key order, criterion-set ordering and cleared optional bounds preserve unchanged approval signatures",()=>{
  const c = buyer.criteria!;
  const reversed = Object.fromEntries(Object.entries({...c,minCapRate:null}).reverse()) as typeof c;
  assert.equal(criteriaSignature(c),criteriaSignature(reversed));
  assert.equal(criteriaSignature({...c,states:["TX","FL"]}),criteriaSignature({...c,states:["FL","TX"]}));
  assert.notEqual(criteriaSignature(c),criteriaSignature({...c,maxUnits:4}));
});
test("declared funding and closing capacity cannot be allocated twice across active deals",()=>{
  assert.equal(matchBuyer(buyer,detail,contract,now,undefined,2).eligible,false);
  assert.equal(matchBuyer(buyer,detail,contract,now,undefined,1,100000).eligible,false);
});
test("approved destinations route opportunities without asserting acquisition funding",()=>{
  const guru: Buyer = {...buyer,destinationKind:"GURU",availableFunds:null,fundingEvidenceUrl:null};
  const m = matchBuyer(guru,detail,contract,now);
  assert.equal(m.eligible,true); assert.equal(m.destinationKind,"GURU");
  assert.ok(m.reasons.some(r=>r.includes("end buyer is still required")));
});