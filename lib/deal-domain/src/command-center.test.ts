import test from "node:test";
import assert from "node:assert/strict";
import { buildDealWorkGuidance, dealActions, strongestOpportunities } from "./command-center";
import type { LeadDetail, LeadDetailWithoutWorkGuidance } from "./types";

const now = new Date("2026-10-04T12:00:00Z");
const deal = (stage: LeadDetail["lead"]["stage"] = "DISCOVERED"): LeadDetail => {
  const detail: LeadDetailWithoutWorkGuidance = {
  lead:{id:"synthetic-deal",address:"SYNTHETIC SUBJECT",city:"Test City",state:"TX",county:"Test County",zip:"75001",
    sqft:1000,beds:3,baths:2,units:1,propertyType:"SINGLE_FAMILY",sellerName:"Synthetic Seller",source:"Test",
    sellerPhone:"555-0100",stage,version:1,nextAction:"Check property condition.",createdAt:now.toISOString(),updatedAt:now.toISOString(),followUpAt:null},
  intelligence:[],analysis:null,analysisSnapshotId:null,underwriting:null,offers:[],calls:[],transitions:[],allowedTransitions:[],
  };
  return {...detail,workGuidance:buildDealWorkGuidance(detail,now)};
};
test("the command center uses one persisted research action and identifies its responsible role",() => {
  const owner = dealActions([deal()],"OWNER",now);
  assert.equal(owner[0]?.category,"RESEARCH");
  assert.equal(owner.length,1);
  assert.equal(owner[0]?.title,"Check property condition.");
  assert.equal(owner[0]?.href,"/deals/synthetic-deal?work=source");
  assert.equal(owner[0]?.workGuidance?.responsibleRole,"ANALYST");
  assert.ok(owner[0]?.workGuidance?.missingFacts.some((fact)=>fact.includes("analysis")));
  assert.equal(dealActions([deal()],"OPERATOR",now).length,0);
  assert.equal(dealActions([deal()],"VIEWER",now).length,0);
});
test("due seller follow-up uses the saved next action and follow-up time",() => {
  const d = deal("CONVERSATION");
  d.lead.id = "synthetic-follow-up";
  d.lead.followUpAt = "2026-10-04T10:00:00Z";
  d.workGuidance = buildDealWorkGuidance(d,now);
  const actions = dealActions([deal(),d],"OWNER",now);
  assert.equal(actions[0]?.category,"FOLLOW_UP");
  assert.equal(actions[0]?.priority,100);
  assert.equal(actions[0]?.title,"Check property condition.");
  assert.equal(actions[0]?.dueAt,"2026-10-04T10:00:00Z");
  assert.equal(actions.filter((action)=>action.leadId===d.lead.id).length,1);
  assert.equal(d.workGuidance?.responsibleRole,"OPERATOR");
  assert.equal(d.workGuidance?.dueLabel,"Seller follow-up");
  d.lead.followUpAt = null;
  d.workGuidance = buildDealWorkGuidance(d,now);
  assert.ok(d.workGuidance?.missingFacts.some((fact)=>fact.includes("future seller follow-up")));
});
test("seller contact gaps route directly to the editable lead record and transaction work can replace lead work",() => {
  const d = deal("CALL_READY");
  delete d.lead.sellerPhone;
  d.workGuidance = buildDealWorkGuidance(d,now);
  assert.equal(d.workGuidance?.href,"/deals/synthetic-deal?work=record");
  assert.ok(d.workGuidance?.missingFacts.some((fact)=>fact.includes("phone")));
  assert.equal(dealActions([d],"OWNER",now).length,1);
  assert.equal(dealActions([d],"OWNER",now,new Set([d.lead.id])).length,0);
});
test("a draft offer is an owner-only approval action and does not imply authorization",() => {
  const d = deal("OFFER_READY");
  d.offers = [{effectiveStatus:"DRAFT",blockers:[]} as unknown as LeadDetail["offers"][number]];
  d.workGuidance = buildDealWorkGuidance(d,now);
  assert.equal(d.workGuidance?.category,"OFFER_APPROVAL");
  assert.equal(d.workGuidance?.responsibleRole,"OWNER");
  assert.equal(d.workGuidance?.href,"/deals/synthetic-deal?work=offers");
  assert.ok(d.workGuidance?.why.includes("current owner authority"));
  assert.equal(dealActions([d],"OPERATOR",now).length,0);
});
test("transaction guidance does not reuse a seller follow-up date as a closing deadline",() => {
  const d = deal("UNDER_CONTRACT");
  d.lead.followUpAt = "2026-10-04T10:00:00Z";
  d.workGuidance = buildDealWorkGuidance(d,now);
  assert.equal(d.workGuidance?.dueAt,null);
  assert.equal(d.workGuidance?.dueLabel,"Contract deadline is shown in the Transaction panel.");
  assert.deepEqual(d.workGuidance?.missingFacts,[]);
});
test("terminal deals are absent from actionable work and strongest opportunities",() => {
  assert.equal(dealActions([deal("CLOSED"),deal("DEAD_DEAL")],"OWNER",now).length,0);
  assert.equal(strongestOpportunities([deal("CLOSED"),deal("DEAD_DEAL"),deal()]).length,0);
});