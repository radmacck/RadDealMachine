import test from "node:test";
import assert from "node:assert/strict";
import { matchBuyer, verificationStatus, evidenceUrl, type Buyer, type DealContract } from "./buyers";
import type { LeadDetail } from "./types";
import { analyzeDeal, DEFAULT_ASSUMPTIONS } from "./underwriting";
const now = new Date("2026-10-04T12:00:00Z");
const buyer: Buyer = {
  id:"synthetic-buyer",version:1,name:"SYNTHETIC BUYER",email:"synthetic@example.com",phone:"",source:"Synthetic test",status:"ACTIVE",
  criteria:{states:["TX"],cities:["Test City"],zipCodes:[],propertyTypes:["SINGLE_FAMILY"],maxPurchasePrice:200000,maxRepairs:50000,
    minBeds:2,minSqft:500,maxSqft:2000,closingDays:3},
  verificationStatus:"VERIFIED",verifiedBy:"synthetic-owner",verifiedAt:now.toISOString(),evidenceAt:now.toISOString(),
  validUntil:"2026-10-20T12:00:00Z",availableFunds:200000,createdAt:now.toISOString(),updatedAt:now.toISOString(),
};
const contract: DealContract = {
  id:"synthetic-contract",leadId:"synthetic-deal",offerId:"synthetic-offer",version:1,status:"UNDER_CONTRACT",
  purchasePrice:100000,assignmentTarget:15000,earnestMoney:1000,assignmentAllowed:true,closingAt:"2026-10-18T12:00:00Z",
  contingencies:"Synthetic terms",milestones:[],createdAt:now.toISOString(),
};
const lead: LeadDetail["lead"] = {
  id:"synthetic-deal",address:"SYNTHETIC SUBJECT",city:"Test City",state:"TX",county:"Synthetic County",zip:"75001",
  propertyType:"SINGLE_FAMILY",beds:3,baths:2,sqft:1000,units:1,sellerName:"Synthetic Seller",source:"Synthetic test",
  stage:"UNDER_CONTRACT",version:1,nextAction:"Review buyer fit.",createdAt:now.toISOString(),updatedAt:now.toISOString(),
};
const analysis = analyzeDeal(lead,{
  version:1,conditionConfirmed:true,repairsComplete:true,
  comps:[290000,300000,310000].map((salePrice,i)=>({id:`synthetic-comp-${i}`,address:`SYNTHETIC COMP ${i}`,
    sqft:1000,salePrice,soldAt:"2026-10-01",distanceMiles:0.5,propertyType:"SINGLE_FAMILY",condition:"RENOVATED",source:"Synthetic evidence",verified:true})),
  repairs:[{category:"Synthetic repairs",low:10000,expected:20000,high:30000,confidence:0.8,source:"Synthetic evidence"}],
},DEFAULT_ASSUMPTIONS,now);
const detail: LeadDetail = {lead,analysis,analysisSnapshotId:"synthetic-snapshot",underwriting:null,intelligence:[],offers:[],calls:[],transitions:[],allowedTransitions:[]};
test("matching explains current qualified fit, not just a magic score",()=>{
  const m = matchBuyer(buyer,detail,contract,now);
  assert.equal(m.eligible,true); assert.equal(m.score,100);
  assert.equal(m.mismatches.length,0); assert.ok(m.reasons.length>10);
});
test("matching exposes geographical, budget, rehab, size and funding exclusions",()=>{
  const b = {...buyer,availableFunds:50000,criteria:{...buyer.criteria,states:["CA"],cities:["Other City"],maxPurchasePrice:50000,maxRepairs:1000,minBeds:5}};
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