import test from "node:test";
import assert from "node:assert/strict";
import { buyerPoolCoverage } from "./buyer-coverage";
import type { Buyer } from "./buyers";

const now=new Date("2026-10-16T12:00:00Z");
type CapacityBuyer=Buyer&{reservedFunds:number;reservedDeals:number};
const buyer=(overrides:Partial<CapacityBuyer>={}):CapacityBuyer=>({
  id:"b1",version:1,name:"Verified buyer",email:"buyer@example.test",phone:"5551000",source:"Manual owner-reviewed record",status:"ACTIVE",
  criteria:{states:["PA"],cities:["Philadelphia"],zipCodes:[],propertyTypes:["SINGLE_FAMILY"],maxPurchasePrice:250000,maxRepairs:100000,
    minBeds:2,minSqft:500,maxSqft:3000,closingDays:10,counties:["Philadelphia"],excludedCounties:[],excludedCities:[],excludedZipCodes:[],
    minPurchasePrice:0,minUnits:1,maxUnits:1,minBaths:1,rehabTolerance:"HEAVY",strategies:["FLIP"],fundingTypes:["CASH"],maxConcurrentDeals:2},
  verificationStatus:"VERIFIED",verifiedBy:"owner",verifiedAt:now.toISOString(),evidenceAt:now.toISOString(),validUntil:"2026-11-01T00:00:00Z",
  availableFunds:200000,reservedFunds:20000,reservedDeals:0,verifiedFundingTypes:["CASH"],identityEvidenceUrl:"https://example.test/id",fundingEvidenceUrl:"https://example.test/funds",
  currentBuyingStatus:"BUYING",buyingVerifiedAt:now.toISOString(),buyingEvidenceAt:now.toISOString(),buyingEvidenceUrl:"https://example.test/buying",
  criteriaEvidenceUrl:"https://example.test/criteria",verificationSource:"Owner review",confidence:.9,approvalStatus:"APPROVED",
  qualificationBlockers:[],createdAt:now.toISOString(),updatedAt:now.toISOString(),...overrides,
} as CapacityBuyer);

test("coverage counts only fresh, verified buyers with hard price, proof and capacity gates",()=>{
  const rows=buyerPoolCoverage([buyer()],now);
  const low=rows.find(r=>r.market==="STATE:PA"&&r.propertyType==="SINGLE_FAMILY"&&r.priceBand==="0-150k")!;
  assert.equal(low.eligibleBuyerCount,1);
  assert.equal(low.conditionCoverage.HEAVY,1);
  assert.equal(low.closingSpeedCoverage["≤14d"],1);
  const high=rows.find(r=>r.market==="STATE:PA"&&r.propertyType==="SINGLE_FAMILY"&&r.priceBand==="150-300k")!;
  assert.equal(high.eligibleBuyerCount,0);
  assert.ok(high.blockers.some(x=>x.includes("funds after active commitments")));
  assert.ok(high.tasks.some(t=>t.kind==="ACQUIRE"));
});

test("stale proof, duplicate identity conflicts and synthetic fixtures never inflate coverage",()=>{
  const stale=buyer({id:"stale",email:"stale@example.test",phone:"5551001",evidenceAt:"2026-09-01T00:00:00Z",validUntil:"2026-09-30T00:00:00Z",approvalStatus:"REVERIFICATION_REQUIRED",verificationStatus:"STALE"});
  const duplicate=buyer({id:"dup",email:"buyer@example.test",phone:"5552000"});
   const fixture=buyer({id:"fixture",email:"fixture@example.test",phone:"5553000",source:"Owner-reviewed fixture record",syntheticFixture:true});
  const rows=buyerPoolCoverage([buyer(),stale,duplicate,fixture],now);
  const low=rows.find(r=>r.market==="STATE:PA"&&r.propertyType==="SINGLE_FAMILY"&&r.priceBand==="0-150k")!;
  assert.equal(low.eligibleBuyerCount,0);
  assert.equal(low.staleProofCount,1);
  assert.ok(low.tasks.some(t=>t.kind==="REVERIFY"&&t.buyerId==="stale"));
  assert.ok(low.blockers.some(x=>x.includes("duplicate identity")));
  assert.equal(low.prospectCount,0);
});

test("capacity and funding proof are hard constraints; reported prospects are listed separately",()=>{
  const weak=buyer({id:"weak",email:"weak@example.test",phone:"5554000",availableFunds:50000,fundingEvidenceUrl:null,approvalStatus:"QUALIFICATION_REQUIRED",verificationStatus:"UNVERIFIED"});
  const rows=buyerPoolCoverage([weak],now);
  const low=rows.find(r=>r.market==="STATE:PA"&&r.propertyType==="SINGLE_FAMILY"&&r.priceBand==="0-150k")!;
  assert.equal(low.eligibleBuyerCount,0);
  assert.equal(low.prospectCount,1);
  assert.ok(low.tasks.some(t=>t.kind==="ACQUIRE"));
  const committed=buyer({id:"committed",email:"committed@example.test",phone:"5555000",reservedDeals:2});
  const committedRows=buyerPoolCoverage([committed],now);
  const committedBox=committedRows.find(r=>r.market==="STATE:PA"&&r.propertyType==="SINGLE_FAMILY"&&r.priceBand==="0-150k")!;
  assert.equal(committedBox.eligibleBuyerCount,0);
  assert.ok(committedBox.blockers.some(x=>x.includes("concurrent-deal capacity")));
});
