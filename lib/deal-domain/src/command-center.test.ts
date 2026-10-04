import test from "node:test";
import assert from "node:assert/strict";
import { dealActions, strongestOpportunities } from "./command-center";
import type { LeadDetail, CallBrief } from "./types";

const now = new Date("2026-10-04T12:00:00Z");
const deal = (stage: LeadDetail["lead"]["stage"] = "DISCOVERED"): LeadDetail => ({
  lead:{id:"synthetic-deal",address:"SYNTHETIC SUBJECT",city:"Test City",state:"TX",county:"Test County",zip:"75001",
    sqft:1000,beds:3,baths:2,units:1,propertyType:"SINGLE_FAMILY",sellerName:"Synthetic Seller",source:"Test",
    stage,version:1,nextAction:"Check property condition.",createdAt:now.toISOString(),updatedAt:now.toISOString(),followUpAt:null},
  intelligence:[],analysis:null,analysisSnapshotId:null,underwriting:null,offers:[],calls:[],transitions:[],allowedTransitions:[],
});
test("command actions are role-aware, linked to real work and do not manufacture unsupported capabilities",() => {
  const owner = dealActions([deal()],[],"OWNER",now);
  assert.equal(owner[0]?.category,"RESEARCH");
  assert.equal(owner[0]?.href,"/deals/synthetic-deal?work=uw");
  assert.equal(owner[0]?.reason,"Check property condition.");
  assert.equal(dealActions([deal()],[],"OPERATOR",now).length,0);
  assert.equal(dealActions([deal()],[],"VIEWER",now).length,0);
});
test("due seller follow-up outranks routine research and only becomes a call if present in the guarded queue",() => {
  const d = deal("CONVERSATION");
  d.lead.followUpAt = "2026-10-04T10:00:00Z";
  const calls = [{lead:d.lead}] as CallBrief[];
  const actions = dealActions([deal(),d],calls,"OWNER",now);
  assert.equal(actions[0]?.category,"FOLLOW_UP");
  assert.equal(actions[0]?.priority,100);
  assert.equal(dealActions([d],[],"OWNER",now).length,0);
});
test("terminal deals are absent from actionable work and strongest opportunities",() => {
  assert.equal(dealActions([deal("CLOSED"),deal("DEAD_DEAL")],[],"OWNER",now).length,0);
  assert.equal(strongestOpportunities([deal("CLOSED"),deal("DEAD_DEAL"),deal()]).length,0);
});