import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, intelligenceTable, analysesTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { DomainError, type IntelligenceInput, type UnderwritingInput } from "@workspace/deal-domain";
import { searchProperties } from "@workspace/property-sources";
import { importPublicProperty } from "./property-source-store";
import { intakePropertyEvidence } from "./evidence-intake";
import { callQueue, createLead, leadDetail, transitionLeadForActor } from "./deal-store";
const now = new Date();
const actor = {id:`synthetic-packet:${randomUUID()}`,role:"OWNER"};
assert.match(process.env.PGOPTIONS??"",/search_path=exercise_[a-f0-9]+/,"This exercise requires the isolated harness.");
try {
  // Real source through real services/persistence, but no invented seller,
  // inspection, renovation, comparable verification or buying intent.
  const actual = (await searchProperties(undefined,"properties",now))[0];
  assert.ok(actual,"Official source must return an actual supported property.");
  const imported = await importPublicProperty(actual.id,true,actor,now);
  let detail = await leadDetail(imported.leadId);
  const raw = await intakePropertyEvidence(imported.leadId,{version:detail.lead.version,lead:detail.lead,
    entries:[{key:"source",classification:"OBSERVED",category:"subject_property",statement:`Official parcel ${actual.id} reports ${actual.address}. Seller/contact/condition unknown.`,
      source:"Philadelphia OPA",sourceUrl:actual.sourceUrl,sourceType:"PUBLIC_RECORD",capturedAt:actual.capturedAt,confidence:0.7}],
    underwriting:{version:detail.lead.version,comps:[],repairs:[],repairsComplete:false,conditionConfirmed:false,subjectEvidenceId:"source"},
  },actor,now);
  assert.equal(raw.analysis?.classification,"INCOMPLETE");
  assert.ok(raw.intelligence.some(e=>e.category==="subject_property"&&e.sourceUrl===actual.sourceUrl));
  assert.ok(!(await callQueue(now)).some(b=>b.lead.id===imported.leadId));
  await assert.rejects(transitionLeadForActor(imported.leadId,{version:raw.lead.version,to:"CALL_READY",reason:"Source alone",nextAction:"Call"},actor,now),DomainError);

  // Separately labelled synthetic packet demonstrates the fully supplied
  // input adapter. It is NOT claimed as a completed real-property exercise.
  const lead = await createLead({address:"SYNTHETIC PACKET SUBJECT",city:"Synthetic City",state:"TX",county:"Synthetic County",zip:"75001",
    propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,sellerName:"SYNTHETIC SELLER",sellerPhone:"000-000-0000",
    askingPrice:100000,source:"SYNTHETIC isolated packet exercise"},actor.id,now);
  const entries: (IntelligenceInput&{key:string})[] = [];
  const evidence = (key: string, category: string, contact = false) => {
    entries.push({key,category,classification:contact?"INDICATED":"VERIFIED_FACTS",sourceType:contact?"SELLER":"INSPECTION",
      statement:"SYNTHETIC reviewed fixture; not a real property fact.",source:"SYNTHETIC exercise",sourceUrl:"https://example.com/synthetic",
      capturedAt:now.toISOString(),confidence:0.9,verificationNote:"SYNTHETIC review of a fixture, not an actual inspection."});
    return key;
  };
  const input: UnderwritingInput = {version:lead.version,conditionConfirmed:true,repairsComplete:true,
    subjectEvidenceId:evidence("subject","subject_property"),conditionEvidenceId:evidence("condition","subject_condition"),
    sellerContactEvidenceId:evidence("contact","seller_contact",true),
    comps:[290000,300000,310000].map((salePrice,i)=>({id:`packet-comp-${i}`,address:`SYNTHETIC COMP ${i}`,salePrice,sqft:1000,
      soldAt:new Date(now.getTime()-10*86400000).toISOString().slice(0,10),distanceMiles:0.5,propertyType:"SINGLE_FAMILY",condition:"RENOVATED",
      source:"SYNTHETIC source",verified:true,saleEvidenceId:evidence(`sale${i}`,`comp_sale:packet-comp-${i}`),
      conditionEvidenceId:evidence(`renovation${i}`,`comp_condition:packet-comp-${i}`)})),
    repairs:[{category:"Roof",low:10000,expected:20000,high:30000,source:"SYNTHETIC scope",confidence:0.9,evidenceId:evidence("repair","repair_scope:roof")}],
  };
  const packet = {version:lead.version,lead,entries,underwriting:input};
  await assert.rejects(intakePropertyEvidence(lead.id,packet,{...actor,role:"OPERATOR"},now),e=>(e as DomainError).status===403);
  await assert.rejects(intakePropertyEvidence(lead.id,{...packet,entries:[{...entries[0]!,sourceType:"MODEL"}]},actor,now),/Model output/);
  assert.equal((await db.select({n:count()}).from(analysesTable).where(eq(analysesTable.leadId,lead.id)))[0]?.n,0);
  detail = await intakePropertyEvidence(lead.id,packet,actor,now);
  assert.equal(detail.analysis?.classification,"STRONG");
  assert.ok(detail.underwriting?.subjectEvidenceId!== "subject");
  await assert.rejects(intakePropertyEvidence(lead.id,packet,actor,now),e=>(e as DomainError).status===409);
  detail = await transitionLeadForActor(lead.id,{version:detail.lead.version,to:"CALL_READY",reason:"Synthetic reviewed packet complete",nextAction:"Synthetic call"},actor,now);
  assert.ok((await callQueue(now)).some(b=>b.lead.id===lead.id));
  // Expired linked evidence is checked at read time, not only on save.
  const expired = new Date(now.getTime()+31*86400000);
  assert.equal((await leadDetail(lead.id,undefined,expired)).analysis?.classification,"INCOMPLETE");
  assert.ok(!(await callQueue(expired)).some(b=>b.lead.id===lead.id));
  assert.ok((await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,lead.id))).length>=entries.length);
  // Force a failure AFTER lead/evidence writes, at snapshot persistence. This
  // verifies an actual PostgreSQL rollback, not just input rejection.
  const beforeFault = await leadDetail(lead.id);
  const beforeRows = (await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,lead.id))).length;
  await db.execute(sql`CREATE FUNCTION exercise_packet_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic snapshot persistence fault'; END; $$`);
  await db.execute(sql`CREATE TRIGGER exercise_packet_fault BEFORE INSERT ON ${analysesTable} FOR EACH ROW EXECUTE FUNCTION exercise_packet_fault()`);
  try {
    await assert.rejects(intakePropertyEvidence(lead.id,{...packet,version:beforeFault.lead.version,
      underwriting:{...input,version:beforeFault.lead.version}},actor,now),
      e=>(e as {cause?:Error}).cause?.message.includes("Synthetic snapshot persistence fault")??false);
    assert.deepEqual(await leadDetail(lead.id),beforeFault);
    assert.equal((await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,lead.id))).length,beforeRows);
  } finally {
    await db.execute(sql`DROP TRIGGER exercise_packet_fault ON ${analysesTable}`);
    await db.execute(sql`DROP FUNCTION exercise_packet_fault()`);
  }
  console.log("Evidence intake PASSED: actual official parcel -> isolated persisted observations -> honest readiness blockers; separately synthetic atomic complete packet -> deterministic STRONG -> CALL NEXT; roles, invalid provenance, stale/repeated versions, expiry. No real seller contacted or facts fabricated.");
} finally { await pool.end(); }