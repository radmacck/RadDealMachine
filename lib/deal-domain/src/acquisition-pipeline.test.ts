import test from "node:test";
import assert from "node:assert/strict";
import { deriveAcquisitionPipelineStage, deriveAcquisitionPipelineCounts, ACQUISITION_PIPELINE_STAGES } from "./acquisition-pipeline";
import { allowedTransitions, assertTransitionPermission, validateTransition } from "./workflow";
import type { Lead } from "./types";

const evidence = (overrides: Partial<Parameters<typeof deriveAcquisitionPipelineStage>[0]> = {}) => ({
  discovered:true,normalized:true,qualifiedForResearch:true,contactRouteResearched:false,callReady:false,
  humanCallOutcome:null,nurtureFollowUpValid:false,sellerQualified:false,underwritingReady:false,offerReady:false,terminal:null,
  ...overrides,
});

test("pipeline stage only advances on the named evidence and terminal outcomes win", () => {
  assert.equal(deriveAcquisitionPipelineStage(evidence({normalized:false,qualifiedForResearch:false})),"DISCOVERED");
  assert.equal(deriveAcquisitionPipelineStage(evidence({qualifiedForResearch:false})),"NORMALIZED");
  assert.equal(deriveAcquisitionPipelineStage(evidence({contactRouteResearched:true})),"CONTACT_ROUTE_RESEARCHED");
  assert.equal(deriveAcquisitionPipelineStage(evidence({callReady:true})),"CALL_READY");
  assert.equal(deriveAcquisitionPipelineStage(evidence({humanCallOutcome:"NO_ANSWER",nurtureFollowUpValid:true})),"NURTURE");
  assert.equal(deriveAcquisitionPipelineStage(evidence({humanCallOutcome:"NO_ANSWER"})),"CONTACTED");
  assert.equal(deriveAcquisitionPipelineStage(evidence({humanCallOutcome:"CONNECTED"})),"CONTACTED");
  assert.equal(deriveAcquisitionPipelineStage(evidence({humanCallOutcome:"CONNECTED",sellerQualified:true})),"SELLER_QUALIFIED");
  assert.equal(deriveAcquisitionPipelineStage(evidence({underwritingReady:true})),"UNDERWRITING_READY");
  assert.equal(deriveAcquisitionPipelineStage(evidence({offerReady:true})),"OFFER_READY");
  assert.equal(deriveAcquisitionPipelineStage(evidence({terminal:"CLOSED",offerReady:true})),"CLOSED");
});

test("derived counts reconcile exactly to the persisted stage projection", () => {
  const stages = [deriveAcquisitionPipelineStage(evidence()),deriveAcquisitionPipelineStage(evidence({humanCallOutcome:"CONNECTED"}))];
  const counts = deriveAcquisitionPipelineCounts(stages);
  assert.equal(counts.reduce((sum,item)=>sum+item.count,0),stages.length);
  assert.deepEqual(counts.map(item=>item.stage),ACQUISITION_PIPELINE_STAGES);
});

test("manual transitions cannot claim contacted or seller-qualified without a persisted call result", () => {
  const lead = { stage:"CALL_READY", sellerPhone:"(215) 555-0100" } as Lead;
  assert.ok(!allowedTransitions(lead,null,new Date()).includes("CONTACTED"));
  assert.ok(!allowedTransitions({...lead,stage:"CONTACTED"},null,new Date()).includes("CONVERSATION"));
  assert.throws(()=>assertTransitionPermission("VIEWER","CONTACTED"),/cannot make this stage change/i);
  assert.doesNotThrow(()=>assertTransitionPermission("OPERATOR","CONTACTED"));
});

test("manual stage changes cannot bypass roles or claim contract, buyer, or closing completion", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  const callReady = { stage:"STRONG", sellerPhone:"(215) 555-0100" } as Lead;
  assert.ok(!allowedTransitions(callReady, null, now).includes("CALL_READY"),
    "Incomplete analysis cannot be promoted to call-ready by a stage change.");
  assert.throws(() => assertTransitionPermission("OPERATOR","CALL_READY"), error =>
    (error as {status:number}).status === 403, "Operators must not self-approve research/call readiness.");
  assert.doesNotThrow(() => assertTransitionPermission("ANALYST","CALL_READY"));

  for (const stage of ["UNDER_CONTRACT","BUYER_COMMITTED","CLOSING","CLOSED"] as const) {
    assert.throws(() => validateTransition(callReady,null,{
      version:1,to:stage,reason:"Attempted direct stage change.",nextAction:"Should remain blocked.",
    },now),/not available/i,
    `${stage} must be recorded through its evidence-backed transaction action, not a manual stage edge.`);
  }
  for (const stage of ["CLOSED","DEAD_DEAL"] as const) {
    assert.deepEqual(allowedTransitions({stage} as Lead,null,now),[],
      `${stage} cannot be falsely marked complete and then manually reopened.`);
  }
});
