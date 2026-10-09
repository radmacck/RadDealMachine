import assert from "node:assert/strict";
import test from "node:test";
import { classifyClosingDeadline } from "./transaction-readiness";
import {
  classifyMilestoneDeadline, scheduleCoversAllMilestones, transactionDeadlineRequestHash, transactionTermsHash,
} from "./transaction-deadlines";

const instant = new Date("2026-10-09T12:00:00.000Z");

test("deadline classification uses only the persisted closing instant and a fixed seven-day threshold", () => {
  assert.equal(classifyClosingDeadline(null, instant), "INVALID");
  assert.equal(classifyClosingDeadline("not-a-date", instant), "INVALID");
  assert.equal(classifyClosingDeadline(new Date(instant.getTime() - 1), instant), "OVERDUE");
  assert.equal(classifyClosingDeadline(instant, instant), "UPCOMING");
  assert.equal(classifyClosingDeadline(new Date(instant.getTime() + 7 * 86_400_000), instant), "UPCOMING");
  assert.equal(classifyClosingDeadline(new Date(instant.getTime() + 7 * 86_400_000 + 1), instant), "ON_TRACK");
});

test("invalid, upcoming, and overdue deadlines never imply an extension or milestone completion", () => {
  assert.equal(classifyClosingDeadline(undefined, instant), "INVALID");
  assert.equal(classifyClosingDeadline("2026-10-10T12:00:00.000Z", instant), "UPCOMING");
  assert.equal(classifyClosingDeadline("2026-10-08T12:00:00.000Z", instant), "OVERDUE");
});

test("milestone deadlines remain calendar dates in the explicitly reviewed time zone", () => {
  const nearMidnightUtc = new Date("2026-10-09T01:00:00.000Z");
  const dueTodayInLosAngeles = { disposition:"DUE_DATE" as const,dueDate:"2026-10-08",timeZone:"America/Los_Angeles" };
  assert.equal(classifyMilestoneDeadline(dueTodayInLosAngeles,nearMidnightUtc),"UPCOMING");
  assert.equal(classifyMilestoneDeadline({...dueTodayInLosAngeles,dueDate:"2026-10-07"},nearMidnightUtc),"OVERDUE");
  assert.equal(classifyMilestoneDeadline({...dueTodayInLosAngeles,dueDate:"2026-10-15"},nearMidnightUtc),"UPCOMING");
  assert.equal(classifyMilestoneDeadline({...dueTodayInLosAngeles,dueDate:"2026-10-16"},nearMidnightUtc),"ON_TRACK");
  assert.equal(classifyMilestoneDeadline({...dueTodayInLosAngeles,timeZone:"Not/A_Timezone"},nearMidnightUtc),"INVALID");
  assert.equal(classifyMilestoneDeadline({...dueTodayInLosAngeles,dueDate:"2026-02-30"},nearMidnightUtc),"INVALID");
  assert.equal(classifyMilestoneDeadline({disposition:"NO_FIXED_DATE",dueDate:null,timeZone:null},nearMidnightUtc),"NOT_DATED");
  assert.equal(classifyMilestoneDeadline({disposition:"NOT_APPLICABLE",dueDate:null,timeZone:null},nearMidnightUtc),"NOT_APPLICABLE");
});

test("deadline request replay hashes are key-order stable; material contract-party changes stale schedules", () => {
  assert.equal(transactionDeadlineRequestHash({ b:2,a:{ y:1,x:0 } }),transactionDeadlineRequestHash({ a:{ x:0,y:1 },b:2 }));
  const base = {
    offerId:"synthetic-offer",purchasePrice:100000,assignmentTarget:15000,earnestMoney:1000,
    assignmentAllowed:true,closingAt:"2026-10-18T12:00:00.000Z",contingencies:"Synthetic terms",
    executedDocumentUrl:"https://example.com/synthetic-executed",sellerSignedAt:"2026-10-01T12:00:00.000Z",
    acquisitionSignedAt:"2026-10-02T12:00:00.000Z",committedBuyerId:null,agreedBuyerPrice:null,buyerCommittedAt:null,
  } as unknown as Parameters<typeof transactionTermsHash>[0];
  assert.equal(transactionTermsHash(base),transactionTermsHash({...base,version:99,milestones:[]}));
  assert.notEqual(transactionTermsHash(base),transactionTermsHash({...base,closingAt:"2026-10-19T12:00:00.000Z"}));
  assert.notEqual(transactionTermsHash(base),transactionTermsHash({...base,committedBuyerId:"synthetic-buyer"}));
});

test("a reviewed schedule requires one disposition per supported transaction milestone", () => {
  const schedule = {
    version:1,idempotencyKey:"synthetic-deadline-key",requestHash:"a".repeat(64),termsHash:"b".repeat(64),
    sourceEvidenceUrl:"https://example.com/synthetic-contract",sourceEffectiveAt:instant.toISOString(),
    recordedAt:instant.toISOString(),recordedBy:"synthetic-owner",reviewNote:"Synthetic schedule fixture only.",
    items:["TITLE_CLEARED","INSPECTION_COMPLETED","EARNEST_MONEY_CONFIRMED","ASSIGNMENT_SIGNED","FUNDS_CONFIRMED"]
      .map(kind=>({kind,disposition:"NO_FIXED_DATE",dueDate:null,timeZone:null,basisNote:"Synthetic terms review."})),
  } as unknown as NonNullable<Parameters<typeof scheduleCoversAllMilestones>[0]>;
  assert.equal(scheduleCoversAllMilestones(schedule),true);
  assert.equal(scheduleCoversAllMilestones({...schedule,items:schedule.items.slice(1)}),false);
});
