import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeDeal, DEFAULT_ASSUMPTIONS, evaluateOffer, validateOfferDraft, validateOfferApproval,
  validateOfferCommunication, validateOfferWithdrawal, assertOfferPermission, buildCallBrief,
  type Lead, type OfferContext, type StoredOffer, type OfferApprovalInput,
  type OfferCommunicationInput, type OfferDraftInput,
} from "./index";

const now = new Date("2026-10-04T12:00:00Z");
const snapshotId = "00000000-0000-4000-8000-000000000002";
const evidenceId = "00000000-0000-4000-8000-000000000003";
const lead: Lead = {
  id:"00000000-0000-4000-8000-000000000001",address:"SYNTHETIC TEST 100 Example Lane",
  city:"Test City",state:"TX",county:"Test County",zip:"75001",propertyType:"SINGLE_FAMILY",
  sqft:1000,beds:3,baths:2,units:1,askingPrice:100000,sellerName:"Synthetic seller",
  sellerPhone:"000-000-0000",source:"Synthetic automated offer test, no real property",
  stage:"CONVERSATION",version:5,nextAction:"Prepare owner-reviewed proposal.",
  createdAt:now.toISOString(),updatedAt:now.toISOString(),followUpAt:null,
};
const analysis = analyzeDeal(lead,{
  version:1,comps:[290000,300000,310000].map((salePrice,i) => ({
    id:`comp-${i}`,address:`SYNTHETIC COMP ${i}`,salePrice,sqft:1000,soldAt:"2026-09-30",
    distanceMiles:0.5,propertyType:"SINGLE_FAMILY",condition:"RENOVATED",source:"Synthetic record",verified:true,
  })),
  repairs:[{category:"Whole scope",low:10000,expected:20000,high:30000,confidence:0.8,source:"Synthetic quote"}],
  repairsComplete:true,conditionConfirmed:true,
},DEFAULT_ASSUMPTIONS,now);
const ctx: OfferContext = {
  lead,analysis,analysisSnapshotId:snapshotId,currentPolicy:DEFAULT_ASSUMPTIONS,conversationLogged:true,now,
  intelligence:[{
    id:evidenceId,leadId:lead.id,classification:"VERIFIED_FACTS",category:"ownership",
    statement:"Synthetic seller is record owner.",source:"Synthetic public-record fixture",
    sourceType:"PUBLIC_RECORD",confidence:0.9,capturedAt:now.toISOString(),
    verificationNote:"Synthetic checked deed fixture, not real title evidence.",createdBy:"test",createdAt:now.toISOString(),
  }],
};
const draft: StoredOffer = {
  id:"00000000-0000-4000-8000-000000000004",leadId:lead.id,analysisSnapshotId:snapshotId,
  status:"DRAFT",amount:110000,earnestMoney:1000,closingDays:30,
  contingencies:"Subject to diligence, title and signed contract.",assignmentIntent:true,
  reason:"Synthetic test proposal.",createdBy:"test-analyst",createdAt:now.toISOString(),updatedAt:now.toISOString(),
  maximumApprovedAcquisitionPrice:null,authorityEvidenceId:null,approvedBy:null,approvedAt:null,approvalReason:null,
  expiresAt:null,communicatedBy:null,communicatedAt:null,communicatedAmount:null,channel:null,evidence:null,withdrawalReason:null,
};
const approval: OfferApprovalInput = {
  version:5,maximumApprovedAcquisitionPrice:120000,expiresAt:"2026-10-06T12:00:00Z",authorityEvidenceId:evidenceId,
  reason:"Reviewed synthetic terms and economics.",nextAction:"Discuss exact approved terms with seller.",followUpAt:"2026-10-05T12:00:00Z",
};
const approved: StoredOffer = {
  ...draft,status:"AUTHORIZED",maximumApprovedAcquisitionPrice:approval.maximumApprovedAcquisitionPrice,
  authorityEvidenceId:evidenceId,approvedBy:"test-owner",approvedAt:now.toISOString(),
  approvalReason:approval.reason,expiresAt:approval.expiresAt,
};
const communication: OfferCommunicationInput = {
  version:5,amount:110000,channel:"PHONE",evidence:"Synthetic caller attests exact terms discussed.",
  nextAction:"Confirm seller response.",followUpAt:"2026-10-05T12:00:00Z",
};

test("offer permissions enforce owner-only approval and revocation even below HTTP routes",() => {
  assertOfferPermission("DRAFT","ANALYST");
  assertOfferPermission("AUTHORIZE","OWNER");
  assertOfferPermission("COMMUNICATE","OPERATOR");
  assertOfferPermission("WITHDRAW","ANALYST",draft);
  for (const role of ["ANALYST","OPERATOR","VIEWER","PENDING"]) assert.throws(() => assertOfferPermission("AUTHORIZE",role),e => (e as {status:number}).status===403);
  assert.throws(() => assertOfferPermission("DRAFT","OPERATOR"));
  assert.throws(() => assertOfferPermission("COMMUNICATE","ANALYST"));
  assert.throws(() => assertOfferPermission("WITHDRAW","ANALYST",approved));
});
test("complete reviewed draft authorizes deterministically without modifying research",() => {
  const before = structuredClone(ctx.analysis);
  validateOfferApproval(draft,approval,ctx);
  assert.equal(evaluateOffer(approved,ctx).effectiveStatus,"AUTHORIZED");
  assert.deepEqual(ctx.analysis,before);
  assert.equal(ctx.analysis!.maximumApprovedAcquisitionPrice,null);
});
test("offer approval rejects above-MAO ceilings and underfunded draft amounts",() => {
  assert.throws(() => validateOfferApproval(draft,{...approval,maximumApprovedAcquisitionPrice:130000.01},ctx),/MAO/);
  assert.throws(() => validateOfferApproval(draft,{...approval,maximumApprovedAcquisitionPrice:109999},ctx),/Draft amount exceeds/);
});
test("offers require a recorded conversation, current snapshot, policy and callable research",() => {
  for (const changes of [
    {conversationLogged:false},{analysisSnapshotId:null},{analysis:null},
    {lead:{...lead,stage:"CALL_READY" as const}},{currentPolicy:{...DEFAULT_ASSUMPTIONS,assignmentTarget:18000}},
  ]) {
    assert.throws(() => validateOfferApproval(draft,approval,{...ctx,...changes}));
    assert.equal(evaluateOffer(approved,{...ctx,...changes}).effectiveStatus,"INVALIDATED");
  }
});
test("authority cannot be guessed, seller-reported, model-generated, unverified or stale",() => {
  assert.throws(() => validateOfferApproval(draft,approval,{...ctx,intelligence:[]}),/authority/i);
  for (const change of [
    {classification:"AI_HYPOTHESIS" as const},{sourceType:"MODEL" as const},{sourceType:"SELLER" as const},
    {category:"motivation"},{verificationNote:""},{capturedAt:"2026-09-01T12:00:00Z"},
  ]) {
    assert.throws(() => validateOfferApproval(draft,approval,{...ctx,intelligence:[{...ctx.intelligence[0]!,...change}]}),/authority/i);
  }
});
test("approval expiry and follow-up cannot silently outlive underwriting or approval",() => {
  assert.throws(() => validateOfferApproval(draft,{...approval,expiresAt:"2026-10-12T12:00:00Z"},ctx),/seven-day/);
  assert.throws(() => validateOfferApproval(draft,{...approval,expiresAt:"2026-10-03T12:00:00Z"},ctx),/future/);
  assert.throws(() => validateOfferApproval(draft,{...approval,followUpAt:"2026-10-07T12:00:00Z"},ctx),/before/);
});
test("expired and superseded-snapshot approvals are never effective permissions",() => {
  const expired = evaluateOffer(approved,{...ctx,now:new Date("2026-10-07T12:00:00Z")});
  assert.equal(expired.effectiveStatus,"EXPIRED");
  assert.match(expired.blockers.join(),/expired/);
  assert.equal(evaluateOffer(approved,{...ctx,analysisSnapshotId:"00000000-0000-4000-8000-000000000009"}).effectiveStatus,"INVALIDATED");
});
test("communication blocks draft, expired, already communicated and stale approvals",() => {
  validateOfferCommunication(approved,communication,ctx);
  for (const unavailable of [draft,{...approved,status:"COMMUNICATED" as const},{...approved,status:"REVOKED" as const}]) {
    assert.throws(() => validateOfferCommunication(unavailable,communication,ctx));
  }
  assert.throws(() => validateOfferCommunication(approved,communication,{...ctx,now:new Date("2026-10-07T12:00:00Z")}),/expired/);
});
test("operators cannot change an approved price even inside the owner's ceiling",() => {
  for (const amount of [109999,115000,130000]) assert.throws(() => validateOfferCommunication(approved,{...communication,amount},ctx),/exact approved/);
  assert.throws(() => validateOfferCommunication(approved,{...communication,followUpAt:"2026-10-01T12:00:00Z"},ctx),/future/);
});
test("draft terms validate dollars, deposit, closing targets and completeness",() => {
  const input: OfferDraftInput = {version:5,amount:110000,earnestMoney:1000,closingDays:30,contingencies:draft.contingencies,assignmentIntent:true,reason:draft.reason};
  validateOfferDraft(input,ctx);
  assert.throws(() => validateOfferDraft({...input,earnestMoney:120000},ctx),/Earnest money/);
  assert.throws(() => validateOfferDraft({...input,amount:110000.001},ctx),/whole cents/);
  assert.throws(() => validateOfferDraft({...input,closingDays:0},ctx));
  assert.throws(() => validateOfferDraft({...input,amount:NaN},ctx));
});
test("revocation preserves historical communication instead of pretending to unsend it",() => {
  const communicated = {...approved,status:"COMMUNICATED" as const,communicatedAt:now.toISOString(),communicatedBy:"test-operator",communicatedAmount:110000,evidence:communication.evidence,channel:"PHONE"};
  validateOfferWithdrawal(communicated,{version:5,reason:"Revoked internally.",nextAction:"Tell seller and renew if appropriate.",followUpAt:communication.followUpAt},now);
  const revoked = evaluateOffer({...communicated,status:"REVOKED",withdrawalReason:"Owner revoked; does not recall communication."},ctx);
  assert.equal(revoked.effectiveStatus,"REVOKED");
  assert.equal(revoked.communicatedAt,communicated.communicatedAt);
  assert.equal(revoked.communicatedAmount,110000);
  assert.equal(revoked.evidence,communication.evidence);
});
test("operator brief separates research economics from actual approval and terms",() => {
  const brief = buildCallBrief({...lead,stage:"OFFER_READY"},ctx.intelligence,analysis,evaluateOffer(approved,ctx),now);
  assert.equal(brief.authorizedOffer?.amount,110000);
  assert.match(brief.boundaries,/Owner-approved proposal/);
  assert.match(brief.boundaries,/Only these exact terms/);
  assert.match(brief.boundaries,/not an executed contract/);
  assert.equal(brief.analysis.maximumApprovedAcquisitionPrice,null);
});
test("brief generation independently suppresses expired, invalidated and stale approved terms",() => {
  const authorized = evaluateOffer(approved,ctx);
  assert.equal(buildCallBrief(lead,ctx.intelligence,analysis,authorized,new Date("2026-10-07T12:00:00Z")).authorizedOffer,null);
  assert.equal(buildCallBrief(lead,ctx.intelligence,analysis,{...authorized,effectiveStatus:"INVALIDATED"},now).authorizedOffer,null);
  assert.equal(buildCallBrief(lead,ctx.intelligence,{...analysis,calculatedAt:"invalid"},authorized,now).authorizedOffer,null);
});