import test from "node:test";
import assert from "node:assert/strict";
import { appendMatchEvaluationHistory, type MatchEvaluationSnapshot } from "./match-evaluation-history";

const snapshot: MatchEvaluationSnapshot = {
  leadId:"lead-1",buyerId:"buyer-1",buyerVersion:2,buyerSource:"owner-reviewed synthetic fixture",
  criteriaEvidenceRef:"https://example.com/criteria-v2",verificationEvidenceRefs:["https://example.com/buying-v2"],
  contactPermission:{status:"GRANTED",source:"synthetic permission fixture",
    evidenceRef:"https://example.com/permission-v1",capturedAt:"2026-10-22T12:00:00.000Z",validUntil:"2026-10-30T12:00:00.000Z"},
  propertySourceKey:"OPA:account-1",propertyDiscoveryId:"discovery-1",
  propertyEvidenceRefs:["https://example.com/parcel-v2"],analysisSnapshotId:"analysis-2",
  status:"MATCHED",eligible:true,score:90,reasons:["Current evidence reviewed."],mismatches:[],
};

test("identical match refreshes preserve history without duplicating an evaluation",()=>{
  const first=appendMatchEvaluationHistory([],snapshot,"2026-10-22T12:01:00.000Z");
  const replay=appendMatchEvaluationHistory(first,snapshot,"2026-10-22T12:02:00.000Z");
  assert.equal(first.length,1);
  assert.deepEqual(replay,first);
  assert.equal(first[0]?.buyerSource,snapshot.buyerSource);
  assert.equal(first[0]?.propertySourceKey,snapshot.propertySourceKey);
  assert.equal(first[0]?.propertyDiscoveryId,snapshot.propertyDiscoveryId);
  assert.equal(first[0]?.contactPermission.evidenceRef,snapshot.contactPermission.evidenceRef);
});

test("material source, version, or eligibility changes append immutable match evidence",()=>{
  const first=appendMatchEvaluationHistory([],snapshot,"2026-10-22T12:01:00.000Z");
  const revised=appendMatchEvaluationHistory(first,{
    ...snapshot,buyerVersion:3,buyerSource:"updated source attribution",
    criteriaEvidenceRef:"https://example.com/criteria-v3",
    propertyEvidenceRefs:["https://example.com/parcel-v3"],eligible:false,
    status:"STALE_BUYER",mismatches:["Buyer evidence is stale."],
  },"2026-10-22T12:03:00.000Z");
  assert.equal(revised.length,2);
  assert.equal(revised[0]?.buyerVersion,2);
  assert.equal(revised[0]?.eligible,true);
  assert.equal(revised[1]?.buyerVersion,3);
  assert.equal(revised[1]?.status,"STALE_BUYER");
  assert.equal(revised[1]?.buyerSource,"updated source attribution");
  assert.notEqual(revised[0]?.snapshotHash,revised[1]?.snapshotHash);
});
