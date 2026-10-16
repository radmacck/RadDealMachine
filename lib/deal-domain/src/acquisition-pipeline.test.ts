import test from "node:test";
import assert from "node:assert/strict";
import { deriveAcquisitionPipelineStage, deriveAcquisitionPipelineCounts, ACQUISITION_PIPELINE_STAGES } from "./acquisition-pipeline";
import { allowedTransitions, assertTransitionPermission } from "./workflow";
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
