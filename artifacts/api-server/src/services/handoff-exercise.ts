import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, buyersTable, leadsTable, jobsTable, auditTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { DiscoverBuyerResponse, RecordHandoffEventResponse } from "@workspace/api-zod";
import { discoverBuyer, discoverPublicBuyers, requestBuyerQualification } from "./buyer-pool";
import { NativeHandoffExecutor, listHandoffs, recordHandoffEvent, reviewHandoffs } from "./handoffs";
import { getBuyerRecord } from "./operations-records";
import { createLead } from "./deal-store";
import { runWorkerOnce, submitWorkerJob } from "./workers";
const actor = {id:`synthetic-handoffs:${randomUUID()}`,role:"OWNER"};
const now = new Date(), later = (seconds:number)=>new Date(now.getTime()+seconds*1000);
assert.match(process.env.PGOPTIONS??"",/search_path=exercise_[a-f0-9]+/);
try {
  // Actual permitted corporate-owner source, persisted only in this isolated schema.
  // No contact permission, buying intent or bank/identity review is invented.
  const actualSource = await discoverPublicBuyers(now);
  const actualRows = await db.select().from(buyersTable);
  assert.ok(actualRows.length>0);
  await reviewHandoffs(now);
  const actualHandoffs = await listHandoffs();
  assert.ok(actualHandoffs.length>=actualRows.length);
  assert.ok(actualHandoffs.every(h=>h.state==="WAITING_CONTACT"&&h.events.length===0));
  assert.ok(actualRows.every(r=>DiscoverBuyerResponse.parse({...r.payload,id:r.id,version:r.version,
    verificationStatus:"UNVERIFIED",createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString()}).currentBuyingStatus==="UNKNOWN"));
  console.log("Actual public-source -> PostgreSQL prospect/task -> recurring native pending handoff PASSED.",actualSource);

  // All human contact/reply cases below are explicitly synthetic business fixtures.
  const b = await discoverBuyer({name:"SYNTHETIC HANDOFF ONLY",source:"SYNTHETIC fixture",
    sourceUrl:"https://example.com/synthetic",capturedAt:now.toISOString(),confidence:0.8},actor,now);
  const native = new NativeHandoffExecutor(actor,now);
  const command = {id:`synthetic:${b.id}`,capability:"QUALIFY_BUYER" as const,subjectId:b.id,actorId:actor.id,
    evidenceReferences:[],approvedCommunicationReference:null};
  const results = await Promise.all([native.execute(command),native.execute(command)]);
  assert.ok(results.every(r=>r.state==="WAITING_EXTERNAL"));
  let h = (await listHandoffs()).find(h=>h.subjectId===b.id)!;
  assert.equal((await listHandoffs()).filter(h=>h.subjectId===b.id).length,1);
  await assert.rejects(native.execute({...command,actorId:"different"}),e=>(e as {status:number}).status===403);
  await assert.rejects(native.execute({...command,approvedCommunicationReference:"unapproved-fiction"}),/does not execute/);
  await assert.rejects(native.execute({...command,capability:"MONITOR_DEAL"}),/Unsupported/);
  const input = {version:h.version,eventKey:"synthetic-contact-once",kind:"CONTACTED" as const,occurredAt:later(1).toISOString(),
    evidenceUrl:"https://example.com/synthetic-contact",note:"SYNTHETIC contact; no actual communication performed.",
    channel:"EMAIL" as const,routeValue:"synthetic@example.com",permissionEvidenceUrl:"https://example.com/synthetic-permission",
    followUpAt:later(120).toISOString()};
  await assert.rejects(recordHandoffEvent(h.id,input,{...actor,role:"VIEWER"},later(2)),e=>(e as {status:number}).status===403);
  await assert.rejects(recordHandoffEvent(h.id,{...input,permissionEvidenceUrl:undefined},actor,later(2)),/permission/);
  const contacts = await Promise.all([recordHandoffEvent(h.id,input,actor,later(2)),recordHandoffEvent(h.id,input,actor,later(2))]);
  assert.equal(contacts[0]!.version,2); assert.equal(contacts[1]!.version,2);
  h = RecordHandoffEventResponse.parse(contacts[0]);
  assert.equal(h.events.length,1); assert.equal(h.events[0]?.occurredAt,later(1).toISOString());
  await assert.rejects(recordHandoffEvent(h.id,{...input,note:"Different event"},actor,later(2)),/another event/);
  const reply = {version:2,eventKey:"synthetic-reply-once",kind:"REPLIED" as const,occurredAt:later(3).toISOString(),
    evidenceUrl:"https://example.com/synthetic-reply",note:"SYNTHETIC actual-response fixture, not a real reply."};
  const races = await Promise.allSettled([recordHandoffEvent(h.id,reply,actor,later(4)),
    recordHandoffEvent(h.id,{...reply,eventKey:"synthetic-competing-reply"},actor,later(4))]);
  assert.equal(races.filter(r=>r.status==="fulfilled").length,1);
  h = (await listHandoffs()).find(x=>x.id===h.id)!;
  assert.equal(h.state,"REPLIED"); assert.equal(h.events.length,2);
  assert.equal((await getBuyerRecord(b.id,db,later(4))).approvalStatus,"DISCOVERED");
  assert.equal((await getBuyerRecord(b.id,db,later(4))).currentBuyingStatus,"UNKNOWN");
  const awaiting = await getBuyerRecord(b.id,db,later(4));
  assert.equal(awaiting.qualificationTask?.state,"WAITING_REVIEW");
  await reviewHandoffs(later(5));
  assert.equal((await listHandoffs()).filter(x=>x.subjectId===b.id).length,1,"No automatic resend after a reply.");
  await assert.rejects(requestBuyerQualification(b.id,{version:awaiting.version,note:"SYNTHETIC more evidence"}, {...actor,role:"OPERATOR"},later(5)),
    e=>(e as {status:number}).status===403);
  const reopened = await requestBuyerQualification(b.id,{version:awaiting.version,note:"SYNTHETIC more evidence"},actor,later(5));
  assert.notEqual(reopened.qualificationTask?.id,awaiting.qualificationTask?.id);
  assert.equal(reopened.qualificationTask?.state,"WAITING_EXTERNAL");
  await assert.rejects(requestBuyerQualification(b.id,{version:awaiting.version,note:"SYNTHETIC stale"},actor,later(5)),/changed/);
  await reviewHandoffs(later(6));
  assert.ok((await listHandoffs()).some(x=>x.subjectId===b.id&&x.state==="WAITING_CONTACT"));

  // A second subject proves rollback after a persisted update, stale retirement,
  // due retry and restoration of worker leases without duplicating handoffs.
  const second = await discoverBuyer({name:"SYNTHETIC ROLLBACK ONLY",source:"SYNTHETIC fixture",
    sourceUrl:"https://example.com/synthetic-second",capturedAt:now.toISOString(),confidence:0.8},actor,now);
  await native.execute({...command,id:`synthetic:${second.id}`,subjectId:second.id});
  let pending = (await listHandoffs()).find(h=>h.subjectId===second.id)!;
  const beforeAudit = await db.select().from(auditTable);
  await db.execute(sql`CREATE FUNCTION exercise_handoff_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic handoff audit fault'; END; $$`);
  await db.execute(sql`CREATE TRIGGER exercise_handoff_fault BEFORE INSERT ON ${auditTable} FOR EACH ROW EXECUTE FUNCTION exercise_handoff_fault()`);
  try {
    await assert.rejects(recordHandoffEvent(pending.id,{...input,version:pending.version},actor,later(2)),
      e=>(e as {cause?:Error}).cause?.message.includes("Synthetic handoff audit fault")??false);
    assert.deepEqual((await listHandoffs()).find(h=>h.id===pending.id),pending);
    assert.deepEqual(await db.select().from(auditTable),beforeAudit);
  } finally {
    await db.execute(sql`DROP TRIGGER exercise_handoff_fault ON ${auditTable}`);
    await db.execute(sql`DROP FUNCTION exercise_handoff_fault()`);
  }
  pending = await recordHandoffEvent(pending.id,{...input,version:pending.version},actor,later(2));
  const beforeReplyFault = await getBuyerRecord(second.id,db,later(2));
  const jobsBeforeReplyFault = (await db.select().from(jobsTable)).length;
  await db.execute(sql`CREATE FUNCTION exercise_reply_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic reply persistence fault'; END; $$`);
  await db.execute(sql`CREATE TRIGGER exercise_reply_fault BEFORE INSERT ON ${auditTable} FOR EACH ROW EXECUTE FUNCTION exercise_reply_fault()`);
  try {
    await assert.rejects(recordHandoffEvent(pending.id,{...reply,version:pending.version},actor,later(4)),
      e=>(e as {cause?:Error}).cause?.message.includes("Synthetic reply persistence fault")??false);
    assert.deepEqual((await listHandoffs()).find(h=>h.id===pending.id),pending);
    assert.deepEqual(await getBuyerRecord(second.id,db,later(2)),beforeReplyFault);
    assert.equal((await db.select().from(jobsTable)).length,jobsBeforeReplyFault);
  } finally {
    await db.execute(sql`DROP TRIGGER exercise_reply_fault ON ${auditTable}`);
    await db.execute(sql`DROP FUNCTION exercise_reply_fault()`);
  }
  await assert.rejects(recordHandoffEvent(pending.id,{...reply,version:pending.version,kind:"NO_RESPONSE",
    followUpAt:later(240).toISOString()},actor,later(4)),/deadline/);
  pending = await recordHandoffEvent(pending.id,{...reply,version:pending.version,kind:"NO_RESPONSE",
    occurredAt:later(121).toISOString(),followUpAt:later(240).toISOString()},actor,later(122));
  assert.equal(pending.state,"WAITING_CONTACT"); assert.equal(pending.events.length,2);
  await db.update(buyersTable).set({version:second.version+1}).where(eq(buyersTable.id,second.id));
  await assert.rejects(recordHandoffEvent(pending.id,{...input,eventKey:"synthetic-stale-contact",version:pending.version},actor,later(123)),/context changed/);
  await reviewHandoffs(later(124));
  const retired = (await listHandoffs()).find(x=>x.id===pending.id)!;
  assert.equal(retired.state,"CANCELLED"); assert.equal(retired.events.length,2);
  assert.ok((await listHandoffs()).some(x=>x.subjectId===second.id&&x.id!==retired.id&&x.state==="WAITING_CONTACT"));

  // Seller handoffs freeze informational requests, never prices or signed agreements.
  const l = await createLead({address:"SYNTHETIC HANDOFF SELLER",city:"Synthetic",state:"TX",county:"Synthetic",zip:"75001",
    propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,source:"SYNTHETIC fixture",sellerName:"SYNTHETIC"},actor.id,now);
  await db.update(leadsTable).set({followUpAt:now}).where(eq(leadsTable.id,l.id));
  await reviewHandoffs(later(125));
  const sellerHandoff = (await listHandoffs()).find(x=>x.subjectId===l.id)!;
  assert.equal(sellerHandoff.subjectType,"SELLER"); assert.match(sellerHandoff.preparedMessage,/Do not quote or alter/);
  await db.update(leadsTable).set({version:l.version+1}).where(eq(leadsTable.id,l.id));
  await reviewHandoffs(later(125));
  assert.equal((await listHandoffs()).filter(x=>x.subjectId===l.id).length,1,"Routine revision must not replace unchanged seller intent.");
  assert.equal((await listHandoffs()).find(x=>x.id===sellerHandoff.id)?.state,"WAITING_CONTACT");
  await db.update(leadsTable).set({stage:"CLOSED",version:l.version+1}).where(eq(leadsTable.id,l.id));
  await reviewHandoffs(later(126));
  assert.equal((await listHandoffs()).find(x=>x.id===sellerHandoff.id)?.state,"CANCELLED");

  const job = await submitWorkerJob({kind:"REVIEW_HANDOFFS",idempotencyKey:"synthetic-recurring-recovery"},actor);
  await db.update(jobsTable).set({state:"RUNNING",attempts:1,updatedAt:new Date(now.getTime()-4*60000)}).where(eq(jobsTable.id,job.id));
  const workerRaces = await Promise.all([runWorkerOnce(later(130),false,job.id),runWorkerOnce(later(130),false,job.id)]);
  assert.equal(workerRaces.filter(Boolean).length,1);
  assert.equal(workerRaces.find(Boolean)?.state,"SUCCEEDED");
  assert.equal((await db.select().from(jobsTable).where(eq(jobsTable.id,job.id)))[0]?.attempts,2);
  await runWorkerOnce(later(131),true,job.id);
  await runWorkerOnce(later(131),true,job.id);
  const scheduled = await db.select().from(jobsTable).where(and(eq(jobsTable.kind,"REVIEW_HANDOFFS"),
    sql`${jobsTable.idempotencyKey} like 'scheduled:handoffs:%'`));
  assert.equal(scheduled.length,1);
  const before = (await listHandoffs()).length;
  await reviewHandoffs(later(132)); await reviewHandoffs(later(132));
  assert.equal((await listHandoffs()).length,before);
  console.log("Handoff PostgreSQL/system GREEN: native port attribution/capabilities, preparation idempotency, permission guard, actual/recorded events, concurrent event recording, reply does not qualify, audit-fault rollback, no-response retry, stale/terminal retirement, recurring bucket deduplication and expired-lease recovery. Synthetic contact/reply fixtures are not real outreach.");
} finally { await pool.end(); }