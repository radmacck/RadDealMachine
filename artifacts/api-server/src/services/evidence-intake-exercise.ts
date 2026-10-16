import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, leadsTable, propertyDiscoveriesTable, intelligenceTable, analysesTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { DomainError, type IntelligenceInput, type UnderwritingInput } from "@workspace/deal-domain";
import { searchProperties } from "@workspace/property-sources";
import { recordPublicPropertyDiscovery } from "./property-discovery-store";
import { intakePropertyEvidence } from "./evidence-intake";
import { callQueue, createLead, leadDetail, recordCall, transitionLeadForActor } from "./deal-store";
import { recordSellerContactObservation } from "./seller-contact-store";
const now = new Date();
const actor = {id:`synthetic-packet:${randomUUID()}`,role:"OWNER"};
assert.match(process.env.PGOPTIONS??"",/search_path=exercise_[a-f0-9]+/,"This exercise requires the isolated harness.");
try {
  // Real source through real services/persistence, but no invented seller,
  // inspection, renovation, comparable verification or buying intent.
  const actual = (await searchProperties(undefined,"properties",now))[0];
  assert.ok(actual,"Official source must return an actual supported property.");
  const discovery = await recordPublicPropertyDiscovery(actual.id,true,actor,now);
  assert.ok(["DISCOVERED_PROPERTY","RELEVANT_CANDIDATE"].includes(discovery.status));
  assert.equal(discovery.leadId,null);
  assert.equal(discovery.canPromote,false);
   assert.ok(discovery.property.contactPaths.every(path =>
     path.channel==="POSTAL"&&path.classification==="OBSERVED"&&path.permissionStatus==="NOT_REVIEWED"));
   assert.ok(!("phone" in discovery.property)&&!("email" in discovery.property),
     "The live OPA record contains no direct phone or email route.");
  const matchingLead = await db.select().from(leadsTable).where(sql`${leadsTable.payload}->>'address' = ${actual.address}`);
  assert.equal(matchingLead.length,0,"An OPA discovery must not create an active lead.");
  assert.ok(!(await callQueue(now)).some(b=>b.lead.address===actual.address));
  await assert.rejects(transitionLeadForActor(discovery.id,{version:discovery.version,to:"CALL_READY",reason:"Source alone",nextAction:"Call"},actor,now),DomainError);

   // Separately labelled synthetic packet exercises evidence intake and
   // deterministic underwriting. Synthetic routes must never authorize CALL_READY.
  const lead = await createLead({address:"SYNTHETIC PACKET SUBJECT",city:"Synthetic City",state:"TX",county:"Synthetic County",zip:"75001",
    propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,sellerName:"SYNTHETIC SELLER",
    askingPrice:100000,source:"SYNTHETIC isolated packet exercise"},actor.id,now);
  const contactEvidence = await recordSellerContactObservation(lead.id,{
    version:lead.version,channel:"PHONE",routeValue:"(215) 555-0142",recipient:"SYNTHETIC test seller",
    recipientRole:"SELLER_SELF_IDENTIFIED",classification:"OBSERVED",confidence:0.9,sourceType:"SELLER",
    sourceId:"synthetic-packet-contact",sourceName:"SYNTHETIC isolated contact exercise",
    sourceRecordId:"SYNTHETIC-PACKET-CONTACT-001",permissionStatus:"PERMITTED",
    contactPermissionEvidenceUrl:"https://example.com/synthetic-contact-permission",
    routeVerificationStatus:"CONFIRMED",verificationNote:"SYNTHETIC owner-reviewed route; not a real contact or identity.",
  },{...actor,role:"OWNER" as const},now);
  assert.equal(contactEvidence.directRouteStatus,"PHONE_ROUTE_AVAILABLE");
  const persistedLeadVersion=contactEvidence.leadVersion;
  const [leadRow] = await db.select().from(leadsTable).where(eq(leadsTable.id,lead.id));
  const [qualificationDiscovery] = await db.insert(propertyDiscoveriesTable).values({
    identityKey:`synthetic-qualification:${randomUUID()}`,
    marketKey:"SYNTHETIC_TX",
    status:"QUALIFIED_LEAD",
    score:51,
    confidence:0.85,
    version:1,
    leadId:lead.id,
    payload:{property:{},signals:[],firstObservedAt:now.toISOString()},
    createdAt:now,
    updatedAt:now,
  }).returning();
  assert.ok(leadRow&&qualificationDiscovery);
  await db.update(leadsTable).set({payload:{...leadRow.payload,propertyQualification:{
    discoveryId:qualificationDiscovery.id,status:"QUALIFIED_LEAD",score:51,confidence:0.85,criteriaVersion:1,
    reviewReason:"SYNTHETIC qualification-state fixture; not a real opportunity.",
    qualifiedBy:actor.id,qualifiedAt:now.toISOString(),
    reason:"SYNTHETIC test fixture for CALL_READY status persistence; not a real property fact.",
    signals:[],missingInformation:["SYNTHETIC status fixture only."],nextAction:lead.nextAction,
  }}}).where(eq(leadsTable.id,lead.id));
  let detail = await leadDetail(lead.id);
  assert.equal(detail.lead.propertyQualification?.status,"QUALIFIED_LEAD",
    "The synthetic linked qualification must be exposed on the lead before workflow transitions.");
  const entries: (IntelligenceInput&{key:string})[] = [];
  const evidence = (key: string, category: string, contact = false) => {
    if (contact) throw new Error("Synthetic packets use the persisted contact-route boundary, not a manually re-entered contact claim.");
    entries.push({key,category,classification:contact?"OBSERVED":"VERIFIED_FACTS",sourceType:contact?"SELLER":"INSPECTION",
      statement:"SYNTHETIC reviewed fixture; not a real property fact.",source:"SYNTHETIC exercise",sourceUrl:"https://example.com/synthetic",
      capturedAt:now.toISOString(),confidence:0.9,verificationNote:"SYNTHETIC review of a fixture, not an actual inspection."});
    return key;
  };
  const input: UnderwritingInput = {version:persistedLeadVersion,conditionConfirmed:true,repairsComplete:true,
    subjectEvidenceId:evidence("subject","subject_property"),conditionEvidenceId:evidence("condition","subject_condition"),
    sellerContactEvidenceId:contactEvidence.selectedPhonePath!.id,
    comps:[290000,300000,310000].map((salePrice,i)=>({id:`packet-comp-${i}`,address:`SYNTHETIC COMP ${i}`,salePrice,sqft:1000,
      soldAt:new Date(now.getTime()-10*86400000).toISOString().slice(0,10),distanceMiles:0.5,propertyType:"SINGLE_FAMILY",condition:"RENOVATED",
      source:"SYNTHETIC source",verified:true,saleEvidenceId:evidence(`sale${i}`,`comp_sale:packet-comp-${i}`),
      conditionEvidenceId:evidence(`renovation${i}`,`comp_condition:packet-comp-${i}`)})),
    repairs:[{category:"Roof",low:10000,expected:20000,high:30000,source:"SYNTHETIC scope",confidence:0.9,evidenceId:evidence("repair","repair_scope:roof")}],
  };
  const packet = {version:persistedLeadVersion,lead,entries,underwriting:input};
  await assert.rejects(intakePropertyEvidence(lead.id,packet,{...actor,role:"OPERATOR"},now),e=>(e as DomainError).status===403);
  await assert.rejects(intakePropertyEvidence(lead.id,{...packet,entries:[{...entries[0]!,sourceType:"MODEL"}]},actor,now),/Model output/);
  assert.equal((await db.select({n:count()}).from(analysesTable).where(eq(analysesTable.leadId,lead.id)))[0]?.n,0);
  detail = await intakePropertyEvidence(lead.id,packet,actor,now);
  assert.equal(detail.analysis?.classification,"STRONG");
  assert.ok(detail.underwriting?.subjectEvidenceId!== "subject");
  assert.equal(detail.lead.propertyQualification?.status,"QUALIFIED_LEAD",
    "Evidence intake must preserve the qualification rationale on the linked lead.");
  await assert.rejects(intakePropertyEvidence(lead.id,packet,actor,now),e=>(e as DomainError).status===409);
   await assert.rejects(transitionLeadForActor(lead.id,{version:detail.lead.version,to:"CALL_READY",
     reason:"Synthetic packet is not real contactability evidence.",nextAction:"Obtain permitted owner-reviewed contactability evidence."},actor,now),
     /CALL_READY is blocked: source-backed ownership\/identity review and a permitted seller route are required/);
   detail = await leadDetail(lead.id);
   assert.ok(!(await callQueue(now)).some(b=>b.lead.id===lead.id),
     "Synthetic evidence must never enter the call-ready seller queue.");
   assert.equal(detail.lead.propertyQualification?.status,"QUALIFIED_LEAD");
  const [readyDiscovery] = await db.select().from(propertyDiscoveriesTable).where(eq(propertyDiscoveriesTable.id,qualificationDiscovery.id));
   assert.equal(readyDiscovery?.status,"QUALIFIED_LEAD");
  // Expired linked evidence is checked at read time, not only on save.
  const expired = new Date(now.getTime()+31*86400000);
  assert.equal((await leadDetail(lead.id,undefined,expired)).analysis?.classification,"INCOMPLETE");
  assert.ok(!(await callQueue(expired)).some(b=>b.lead.id===lead.id));
   await assert.rejects(recordCall(lead.id,{version:detail.lead.version,outcome:"NO_ANSWER",
     notes:"SYNTHETIC stale-route guard exercise.",nextAction:"Refresh contact route evidence.",
      followUpAt:new Date(expired.getTime()+86400000).toISOString()},actor.id,expired),
      /Calls can only be recorded for call-ready or active seller\/closing conversations/);
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