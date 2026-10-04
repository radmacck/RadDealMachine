/**
 * Exercises the actual persistence/service layer, not an in-memory repository.
 * All data is conspicuously synthetic and deleted by its generated ID in finally.
 * This does not claim to verify the signed-in browser UI or a real business deal.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db, pool, leadsTable, auditTable, analysesTable, intelligenceTable } from "@workspace/db";
import { logger } from "../lib/logger";
import * as store from "./deal-store";
import { commandCenter } from "./command-center";
import { DEFAULT_ASSUMPTIONS, type LeadInput, type UnderwritingInput } from "@workspace/deal-domain";

async function exercise() {
  const actor = `synthetic-exercise:${randomUUID()}`;
  const now = new Date();
  const soldAt = new Date(now.getTime() - 10 * 86_400_000).toISOString().slice(0,10);
  const payload: LeadInput = {
    address:`SYNTHETIC TEST ${randomUUID()} Example Lane`,city:"Synthetic City",state:"TX",
    county:"Synthetic County",zip:"75001",propertyType:"SINGLE_FAMILY",sqft:1000,
    beds:3,baths:2,units:1,askingPrice:100000,sellerName:"SYNTHETIC EXERCISE ONLY",
    sellerPhone:"000-000-0000",sellerDescription:"Synthetic condition description.",
    sellingReason:"Synthetic motive, not an established fact.",source:"Automated persistence exercise; no real property",
  };
  let id: string | null = null;
  try {
    const created = await store.createLead(payload,actor,now);
    id = created.id;
    assert.equal(created.stage,"DISCOVERED");
    const center = await commandCenter("OWNER",now);
    assert.ok(center.actions.some(a => a.leadId === id && a.category === "RESEARCH"));
    assert.ok(center.deals.some(d => d.lead.id === id));
    const operatorCenter = await commandCenter("OPERATOR",now);
    assert.ok(!operatorCenter.actions.some(a => a.leadId === id && a.category === "RESEARCH"));
    const initial = await store.leadDetail(id);
    assert.equal(initial.intelligence.length,2);
    assert.ok(initial.intelligence.every(i => i.classification === "INDICATED"));
    await assert.rejects(store.addIntelligence(id,{
      classification:"VERIFIED_FACTS",category:"motivation",statement:"Invented urgency",
      source:"Model",sourceType:"MODEL",confidence:0.4,capturedAt:now.toISOString(),
    },actor,now),/Model output/);
    await store.addIntelligence(id,{
      classification:"AI_HYPOTHESIS",category:"motivation",statement:"Synthetic possible preference",
      source:"Synthetic model",sourceType:"MODEL",confidence:0.4,capturedAt:now.toISOString(),
      question:"What timeline works?",action:"Ask the seller, do not assume.",
    },actor,now);
    let detail = await store.leadDetail(id);
    assert.equal(detail.lead.stage,"ENRICHING");
    const underwriting: UnderwritingInput = {
      version:detail.lead.version,conditionConfirmed:true,repairsComplete:true,
      comps:[290000,300000,310000].map((salePrice,index) => ({
        id:`synthetic-${index}`,address:`SYNTHETIC COMP ${index} Example Lane`,salePrice,sqft:1000,
        soldAt,distanceMiles:0.5,propertyType:"SINGLE_FAMILY",condition:"RENOVATED",
        source:"Synthetic automated comp data",verified:true,
      })),
      repairs:[{category:"Synthetic repair scope",low:10000,expected:20000,high:30000,confidence:0.8,source:"Synthetic quote"}],
    };
    detail = await store.saveUnderwriting(id,underwriting,actor,now);
    // Current policy may differ from default; test determinism with its persisted snapshot.
    assert.ok(detail.analysis);
    assert.equal(detail.analysis!.maximumApprovedAcquisitionPrice,null);
    const policy = await store.getAssumptions();
    assert.deepEqual(detail.analysis!.assumptions,policy);
    const matchesDefault = JSON.stringify(policy) === JSON.stringify(DEFAULT_ASSUMPTIONS);
    if (matchesDefault) {
      assert.equal(detail.lead.stage,"STRONG");
      assert.equal(detail.analysis!.mao,130000);
    }
    await assert.rejects(store.saveUnderwriting(id,underwriting,actor,now),/changed in another session/);
    const snapshots = await db.select().from(analysesTable).where(eq(analysesTable.leadId,id));
    assert.equal(snapshots.length,1);
    if (!detail.allowedTransitions.includes("CALL_READY")) {
      throw new Error("Current workspace policy blocks synthetic call readiness; exercise cannot continue. Restore a test-compatible policy only in an isolated test database.");
    }
    detail = await store.transitionLead(id,{
      version:detail.lead.version,to:"CALL_READY",reason:"Synthetic analysis and brief reviewed",
      nextAction:"Run synthetic seller conversation exercise.",
    },actor,now);
    const queue = await store.callQueue(now);
    const brief = queue.find(b => b.lead.id === id);
    assert.ok(brief);
    assert.ok(brief!.questions.includes("What timeline works?"));
    assert.match(brief!.boundaries,/No price is authorized/);
    const followUpAt = new Date(now.getTime()+86_400_000).toISOString();
    const call = {version:detail.lead.version,outcome:"CONNECTED" as const,notes:"Synthetic seller answered.",nextAction:"Prepare for authorization workflow; do not release an offer.",followUpAt};
    detail = await store.recordCall(id,call,actor,now);
    assert.equal(detail.lead.stage,"CONVERSATION");
    assert.equal(detail.calls.length,1);
    assert.equal(detail.lead.followUpAt,followUpAt);
    assert.ok(detail.transitions.some(t => t.to === "ANALYZED"));
    assert.ok(detail.transitions.some(t => t.to === "CONTACTED"));
    assert.ok(!detail.allowedTransitions.includes("OFFER_READY"));
    const reloaded = await store.leadDetail(id);
    assert.deepEqual(reloaded,detail);
    assert.ok(!(await store.callQueue(now)).some(b => b.lead.id === id));
    const stale = await store.callQueue(new Date(now.getTime()+8*86_400_000));
    assert.ok(!stale.some(b => b.lead.id === id));
    await assert.rejects(store.recordCall(id,call,actor,now),/changed in another session/);
    // Concurrent writers with same version: one wins; other must get explicit conflict.
    const changes = {...payload,version:detail.lead.version,sellerDescription:"Synthetic revised description"};
    const results = await Promise.allSettled([store.updateLead(id,changes,actor,now),store.updateLead(id,changes,actor,now)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length,1);
    assert.equal(results.filter(r => r.status === "rejected").length,1);
    detail = await store.leadDetail(id);
    assert.equal(detail.analysis,null);
    assert.equal(detail.lead.stage,"ENRICHING");
    assert.equal((await db.select().from(analysesTable).where(eq(analysesTable.leadId,id))).length,1);
    assert.ok((await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,id))).some(e => e.payload.classification === "AI_HYPOTHESIS"));
    const audits = await db.select().from(auditTable).where(eq(auditTable.entityId,id));
    assert.ok(audits.length>=10);
    logger.info({checks:"persist/reload, provenance rejection, deterministic snapshot, stale/concurrent write rejection, call readiness, brief, followup, immutable evidence, analysis invalidation"},"Seller vertical persistence exercise PASSED (synthetic data)");
  } finally {
    if (id) {
      await db.transaction(async tx => {
        await tx.delete(leadsTable).where(eq(leadsTable.id,id!));
        await tx.delete(auditTable).where(and(eq(auditTable.entityId,id!),eq(auditTable.actor,actor)));
      });
      const remaining = await db.execute(sql`select count(*)::int as count from re_leads where id=${id}::uuid`);
      assert.equal(remaining.rows[0]?.count,0);
    }
    await pool.end();
  }
}
exercise().catch(error => {
  logger.error({err:error},"Seller persistence exercise FAILED");
  process.exitCode = 1;
});