/**
 * Exercises the repair catalog and estimator through the real service/persistence
 * layer in an isolated schema. All property, inspection and rate values are
 * clearly synthetic; nothing is written to workspace data.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool, auditTable, leadsTable, analysesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import * as store from "./deal-store";
import { exerciseEvidence } from "./exercise-evidence";
import { DEFAULT_ASSUMPTIONS, type LeadInput, type RepairRateCard, type UnderwritingInput } from "@workspace/deal-domain";

async function exercise() {
  const actor = `synthetic-repair-exercise:${randomUUID()}`;
  const now = new Date();
  const idSuffix = randomUUID();
  const inspectionDate = new Date(now.getTime()-86_400_000).toISOString();
  const payload: LeadInput = {
    address:`SYNTHETIC REPAIR TEST ${idSuffix} Lane`,city:"Philadelphia",state:"PA",county:"Synthetic County",
    zip:"19100",propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,askingPrice:100000,
    sellerName:"SYNTHETIC TEST ONLY",sellerPhone:"000-000-0000",
    source:"Automated repair estimator persistence exercise; not a real property",
  };
  let id:string|null=null;
  try {
    const created=await store.createLead(payload,actor,now);
    id=created.id;
    const inspected=await store.addIntelligence(id,{
      classification:"VERIFIED_FACTS",category:"repair_scope:Roof",
      statement:"SYNTHETIC fixture: inspection measured a moderate roof work area of 100 square feet.",
      source:"SYNTHETIC inspection fixture",sourceType:"INSPECTION",sourceUrl:`https://example.invalid/inspection/${id}`,
      confidence:0.9,capturedAt:inspectionDate,verificationNote:"Synthetic exercise evidence only; not a real inspection.",
    },actor,now);
    const listingClue=await store.addIntelligence(id,{
      classification:"OBSERVED",category:"listing_remarks",
      statement:"SYNTHETIC listing remarks say the roof leaks; this is not an inspection finding.",
      source:"SYNTHETIC permitted listing fixture",sourceType:"PERMITTED_LISTING",
      sourceUrl:`https://example.invalid/listing/${id}`,confidence:0.8,
      capturedAt:inspectionDate,
    },actor,now);
    const policy=await store.getAssumptions();
    const card:RepairRateCard={
      id:`synthetic-rate-${id}`,version:1,marketKey:"PHILADELPHIA-PA",category:"Roof",severity:"MODERATE",unit:"SQFT",
      lowRate:4,expectedRate:6,highRate:8,confidence:0.85,source:"SYNTHETIC test rate card",
      sourceUrl:`https://example.invalid/rates/${id}`,capturedOn:now.toISOString().slice(0,10),
      validThrough:new Date(now.getTime()+30*86_400_000).toISOString().slice(0,10),active:true,
    };
    const preliminaryCard:RepairRateCard={
      id:`synthetic-preliminary-rate-${id}`,version:1,marketKey:"PHILADELPHIA-PA",category:"Roof",severity:"MODERATE",unit:"LUMP_SUM",
      lowRate:1000,expectedRate:2000,highRate:3000,confidence:0.75,source:"SYNTHETIC preliminary scenario rate",
      sourceUrl:`https://example.invalid/preliminary-rates/${id}`,capturedOn:now.toISOString().slice(0,10),
      validThrough:new Date(now.getTime()+30*86_400_000).toISOString().slice(0,10),active:true,
    };
    await store.saveAssumptions({...policy,repairRates:[card,preliminaryCard]},actor);
    const loadedPolicy=await store.getAssumptions();
    assert.equal(loadedPolicy.repairRateCatalogVersion,policy.repairRateCatalogVersion+1);

    const comps=[290000,300000,310000].map((salePrice,index)=>({
      id:`synthetic-repair-comp-${index}`,address:`SYNTHETIC REPAIR COMP ${index} ${idSuffix}`,
      salePrice,sqft:1000,soldAt:new Date(now.getTime()-10*86_400_000).toISOString().slice(0,10),
      distanceMiles:0.5,propertyType:"SINGLE_FAMILY",condition:"RENOVATED" as const,
      source:"SYNTHETIC test comp",verified:true,
    }));
    let underwriting:UnderwritingInput={
      version:(await store.leadDetail(id,undefined,now)).lead.version,
      comps,repairs:[],repairObservations:[{
        category:"Roof",severity:"MODERATE",quantity:100,unit:"SQFT",evidenceId:inspected.id,
      }],repairsComplete:true,conditionConfirmed:true,
    };
    underwriting=await exerciseEvidence(id,underwriting,actor,now);
    const detail=await store.saveUnderwriting(id,underwriting,actor,now);
    assert.equal(detail.analysis?.repairEstimate.status,"CALCULATED");
    assert.deepEqual(detail.analysis?.repairs,{low:400,expected:600,high:800,confidence:0.85});
    assert.equal(detail.analysis?.preliminaryRepairEstimate.status,"CALCULATED");
    assert.deepEqual(detail.analysis?.preliminaryRepairEstimate.total,{low:1000,expected:2000,high:3000,confidence:0.4});
    assert.equal(detail.analysis?.preliminaryRepairEstimate.hypotheses[0]?.epistemicStatus,"AI_HYPOTHESIS");
    assert.equal(detail.analysis?.preliminaryRepairEstimate.hypotheses[0]?.evidenceId,listingClue.id);
    assert.notEqual(detail.analysis?.repairs.expected,detail.analysis?.preliminaryRepairEstimate.total?.expected,
      "Preliminary phrase-derived ranges remain separate from inspection-based underwriting repairs.");
    assert.equal(detail.underwriting?.repairEstimate?.catalogVersion,loadedPolicy.repairRateCatalogVersion);
    assert.equal(detail.underwriting?.repairs[0]?.source,`Cost catalog ${card.id} v1: ${card.source}`);
    assert.equal(detail.underwriting?.repairs[0]?.evidenceId,inspected.id);
    assert.ok(detail.analysisSnapshotId);
    const [row]=await db.select().from(leadsTable).where(eq(leadsTable.id,id));
    assert.equal((row?.underwriting as UnderwritingInput).repairEstimate?.status,"CALCULATED");
    const snapshots=await db.select().from(analysesTable).where(eq(analysesTable.leadId,id));
    assert.equal(snapshots.length,1);
    assert.equal((snapshots[0]?.snapshot as {input:UnderwritingInput}).input.repairEstimate?.status,"CALCULATED");
    assert.equal((snapshots[0]?.snapshot as {analysis:{preliminaryRepairEstimate:{hypotheses:Array<{evidenceId:string}>}}})
      .analysis.preliminaryRepairEstimate.hypotheses[0]?.evidenceId,listingClue.id);

    await assert.rejects(
      store.saveAssumptions({...loadedPolicy,repairRates:[{...card,expectedRate:7}]},actor),
      /immutable/,
    );
    assert.deepEqual(await store.getAssumptions(),loadedPolicy);
    const events=await db.select().from(auditTable).where(eq(auditTable.entityId,"workspace"));
    assert.ok(events.some(event=>event.action==="ASSUMPTIONS_CHANGED"));
    logger.info({checks:"inspection-sourced repairs and separately labeled listing-condition hypotheses, exact current-rate multiplication, non-propagation into MAO, provenance-bound persisted snapshot, immutable rate history, audit"},"Repair estimator persistence exercise PASSED (synthetic isolated data)");
  } finally {
    if(id) {
      await db.transaction(async tx=>{
        await tx.delete(leadsTable).where(eq(leadsTable.id,id!));
        await tx.delete(auditTable).where(and(eq(auditTable.entityId,id!),eq(auditTable.actor,actor)));
      });
    }
    await pool.end();
  }
}
exercise().catch(error=>{
  logger.error({err:error},"Repair estimator persistence exercise FAILED");
  process.exitCode=1;
});
