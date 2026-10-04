/**
 * Real official API -> real PostgreSQL -> existing deterministic underwriting.
 * Synthetic actors and isolated schemas only. Real records are NOT seller leads,
 * proof of buying intent, available properties or approved transactions.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, leadsTable, intelligenceTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { addSourceComps, getSourceResearch, importPublicProperty, refreshSourceResearch, searchPublicProperties } from "./property-source-store";
import { createLead, leadDetail } from "./deal-store";
const actor = {id:`synthetic-source:${randomUUID()}`,role:"OWNER"};
try {
  const search = await searchPublicProperties();
  assert.ok(search.records.length>0,"Official provider must return actual records; no fixture fallback.");
  // Choose a complete, ordinary row-house configuration, not the first
  // record (which can report zero/unknown rooms or an unusual size).
  const p = search.records.find(r=>r.propertyType==="TOWNHOUSE"&&r.sqft!==null&&r.sqft>=700&&r.sqft<=1800&&
    r.beds!==null&&r.beds>=2&&r.beds<=4&&r.baths!==null&&r.baths>0&&r.baths<=3&&r.lat!==null&&r.lng!==null)!;
  assert.ok(p);
  await assert.rejects(()=>importPublicProperty(p.id,false,actor),/license/);
  await assert.rejects(()=>importPublicProperty(p.id,true,{...actor,role:"OPERATOR"}),/permission|role|allowed/i);
  const first = await importPublicProperty(p.id,true,actor);
  assert.equal(first.created,true);
  assert.ok(first.research.candidates.length>0,"Real nearby reported-sale candidates are required for this live exercise.");
  const [a,b] = await Promise.all([importPublicProperty(p.id,true,actor),importPublicProperty(p.id,true,actor)]);
  assert.equal(a.created,false); assert.equal(b.created,false);
  assert.equal(a.leadId,first.leadId); assert.equal(b.leadId,first.leadId);
  const saved = (await getSourceResearch(first.leadId)).research!;
  assert.equal(saved.subject.id,p.id);
  assert.ok(saved.candidates.every(c=>c.comp.verified===false&&c.comp.condition==="UNKNOWN"));
  let detail = await leadDetail(first.leadId);
  assert.equal(detail.lead.stage,"ENRICHING");
  assert.equal(detail.lead.askingPrice,null); assert.equal(detail.lead.sellerName,"Seller not identified");
  assert.equal(detail.analysis,null); assert.equal(detail.offers.length,0);
  assert.ok(detail.intelligence.every(i=>i.classification==="OBSERVED"));
  await assert.rejects(()=>addSourceComps(first.leadId,{version:detail.lead.version,recordIds:["not-a-source-id"]},actor),/not supplied/);
  const selected = saved.candidates.slice(0,3).map(c=>c.record.id);
  detail = await addSourceComps(first.leadId,{version:detail.lead.version,recordIds:selected},actor);
  assert.equal(detail.underwriting!.comps.length,selected.length);
  assert.equal(detail.analysis!.classification,"INCOMPLETE");
  assert.ok(detail.analysis!.blockers.some(r=>r.includes("renovated")));
  assert.equal(detail.analysis!.maximumApprovedAcquisitionPrice,null);
  const snapshot = detail.analysisSnapshotId;
  const input = detail.underwriting;
  await refreshSourceResearch(first.leadId,detail.lead.version,true,actor);
  detail = await leadDetail(first.leadId);
  assert.equal(detail.analysisSnapshotId,snapshot);
  assert.deepEqual(detail.underwriting,input);
  assert.equal(detail.offers.length,0);
  await assert.rejects(()=>refreshSourceResearch(first.leadId,detail.lead.version-1,true,actor),/changed/);
  const unsupported = await createLead({address:"123 Synthetic Test Street",city:"Test",state:"FL",county:"Test",
    zip:"33101",propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,
    sellerName:"SYNTHETIC",source:"Isolated unsupported-source fixture; NOT a real seller."},actor.id);
  await assert.rejects(()=>refreshSourceResearch(unsupported.id,unsupported.version,true,actor),/jurisdiction/);
  const [identity] = await db.select().from(leadsTable).where(eq(leadsTable.id,first.leadId));
  await db.update(leadsTable).set({payload:{...identity!.payload,address:"999 SYNTHETIC DIFFERENT SUBJECT ST"}}).where(eq(leadsTable.id,first.leadId));
  await assert.rejects(()=>getSourceResearch(first.leadId),/different subject/);
  await assert.rejects(()=>importPublicProperty(p.id,true,actor),/different subject/);
  await assert.rejects(()=>addSourceComps(first.leadId,{version:detail.lead.version,recordIds:selected},actor),/different subject/);
  await db.update(leadsTable).set({payload:identity!.payload}).where(eq(leadsTable.id,first.leadId));
  await db.update(leadsTable).set({stage:"CLOSED"}).where(eq(leadsTable.id,first.leadId));
  const before = (await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,first.leadId))).length;
  await assert.rejects(()=>refreshSourceResearch(first.leadId,detail.lead.version,true,actor),/read-only/);
  assert.equal((await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,first.leadId))).length,before);
  const buyers = await searchPublicProperties(undefined,"buyer_candidates");
  assert.ok(buyers.records.length>0,"Real corporate-owner research candidates required; not fabricated buyers.");
  assert.ok(buyers.records.every(r=>r.entityCandidate&&r.classification==="OBSERVED"));
  logger.info({records:search.records.length,saleCandidates:saved.candidates.length,corporateResearchCandidates:buyers.records.length,
    checks:"real official API; atomic idempotent intake; real persisted provenance; unverified comp transfer; deterministic INCOMPLETE blockers; refresh preserves snapshot; authorization/terms/staleness/terminal/coverage rejection"},
    "Public property-source exercise PASSED (isolated actors/schema, actual source records, no contact or approval)");
} finally { await pool.end(); }