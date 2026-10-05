import { and, eq, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { db, buyersTable, leadsTable, jobsTable } from "@workspace/db";
import { ListHandoffsResponse, RecordHandoffEventBody } from "@workspace/api-zod";
import { assertOperationsRole, applyHandoffEvent, DomainError, type HumanHandoff, type OfferActor,
  type AuthorizedWorkerCommand, type WorkerExecutionPort, type WorkerExecutionResult } from "@workspace/deal-domain";
import { buyerRecord, queueJob, type Tx } from "./operations-records";
import { audit } from "./deal-store";
import { reviewBuyerPool } from "./buyer-pool";

const parseHandoff = (row: typeof jobsTable.$inferSelect) => ListHandoffsResponse.element.parse({...row.payload.handoff as object,id:row.id});
const active = (h: HumanHandoff) => !["REPLIED","CANCELLED"].includes(h.state);
// Routine matching bumps the row revision without changing the outreach intent.
// Only seller identity/route, due follow-up and business stage define this context.
function sellerContext(l:typeof leadsTable.$inferSelect) {
  return createHash("sha256").update(JSON.stringify([l.followUpAt?.toISOString(),l.stage,
    l.payload.address,l.payload.sellerName,l.payload.sellerPhone,l.payload.sellerEmail])).digest("hex");
}

/** No network sending capability. This executor durably prepares human work. */
export class NativeHandoffExecutor implements WorkerExecutionPort {
  id = "native-human-handoff";
  constructor(private actor: OfferActor, private now = new Date()) {}
  async availableCapabilities(): Promise<AuthorizedWorkerCommand["capability"][]> {
    return ["QUALIFY_BUYER","REVERIFY_BUYER","FOLLOW_UP_SELLER"];
  }
  async execute(command: AuthorizedWorkerCommand): Promise<WorkerExecutionResult> {
    assertOperationsRole(this.actor,["OWNER","ANALYST","OPERATOR"]);
    if (command.actorId!==this.actor.id||!command.subjectId||!(await this.availableCapabilities()).includes(command.capability))
      throw new DomainError("Unsupported or incorrectly attributed native handoff command.",403);
    if (command.approvedCommunicationReference!==null)
      throw new DomainError("Native preparation does not execute approved commercial communications. Record actual exact-term communication through the offer workflow.",409);
    const h = await db.transaction(async tx=>{
      const buyer = command.capability!=="FOLLOW_UP_SELLER";
      const table = buyer?buyersTable:leadsTable;
      const [subject] = await tx.select().from(table).where(eq(table.id,command.subjectId!)).for("update");
      if (!subject) throw new DomainError("Handoff subject not found.",404);
      let contextKey:string, recipient:string, message:string;
      if (buyer) {
        const b = buyerRecord(subject as typeof buyersTable.$inferSelect,this.now);
        const task = b.qualificationTask;
        if (!task||["COMPLETED","WAITING_REVIEW"].includes(task.state)||b.approvalStatus==="APPROVED"||b.currentBuyingStatus==="NOT_BUYING")
          throw new DomainError("No outstanding buyer qualification task.",409);
        if ((command.capability==="REVERIFY_BUYER")!==(task.kind==="REVERIFY"))
          throw new DomainError("Qualification command does not match the current task.",409);
        contextKey = task.id; recipient = b.name; message = task.preparedMessage;
      } else {
        const l = subject as typeof leadsTable.$inferSelect;
        if (["CLOSED","DEAD_DEAL"].includes(l.stage)||!l.followUpAt||l.followUpAt>this.now)
          throw new DomainError("No current due seller follow-up.",409);
        contextKey = sellerContext(l); recipient = `${l.payload.sellerName||"Seller contact unconfirmed"} — ${l.payload.address}`;
        message = `Follow up on ${l.payload.address}: confirm current status and next coordination steps. Read the current CALL NEXT brief before contacting. Do not quote or alter price, deposit, assignment or closing terms without the current exact owner-approved offer. Record the actual conversation in the seller workflow; this handoff is not a call or an offer.`;
      }
      const key = `native-handoff:${command.id}`;
      const [existing] = await tx.select().from(jobsTable).where(eq(jobsTable.idempotencyKey,key));
      if (existing) {
        if (!isDeepStrictEqual(existing.payload.command,command)) throw new DomainError("Command ID belongs to another execution.",409);
        return parseHandoff(existing);
      }
      const old = await tx.select().from(jobsTable).where(and(eq(jobsTable.kind,"HUMAN_HANDOFF"),
        sql`${jobsTable.payload}->'handoff'->>'subjectType' = ${buyer?"BUYER":"SELLER"}`,
        sql`${jobsTable.payload}->'handoff'->>'subjectId' = ${command.subjectId}`)).for("update");
      for (const row of old) {
        const previous = parseHandoff(row);
        if (active(previous)) await stopHandoff(tx,row,previous,"Superseded by current subject/task context. No external cancellation implied.",this.now);
      }
      const h = {version:1,subjectType:buyer?"BUYER":"SELLER",subjectId:command.subjectId,
        subjectVersion:subject.version,contextKey,recipient,preparedMessage:message,state:"WAITING_CONTACT",
        dueAt:this.now.toISOString(),createdAt:this.now.toISOString(),updatedAt:this.now.toISOString(),
        nextAction:"Review contact permission and recipient route, perform permitted human outreach and record actual evidence. Nothing has been sent.",events:[]};
      const [row] = await tx.insert(jobsTable).values({kind:"HUMAN_HANDOFF",state:"SUCCEEDED",leadId:buyer?null:command.subjectId,
        requestedBy:this.actor.id,idempotencyKey:key,message:"Preparation persisted. Human outreach remains pending; no message sent.",
        payload:{command,handoff:h},createdAt:this.now,updatedAt:this.now}).returning();
      if (!row) throw new Error("Handoff persistence failed.");
      await audit(tx,this.actor.id,"HUMAN_HANDOFF_PREPARED",command.subjectId!,"Native executor prepared informational outreach only; no external execution or verification claimed.");
      return parseHandoff(row);
    });
    return {commandId:command.id,state:h.state==="CANCELLED"?"FAILED":"WAITING_EXTERNAL",
      reason:h.nextAction,evidenceReferences:command.evidenceReferences,nextAction:h.nextAction};
  }
}
async function stopHandoff(tx: Tx,row:typeof jobsTable.$inferSelect,h:HumanHandoff,reason:string,now:Date) {
  await tx.update(jobsTable).set({payload:{...row.payload,handoff:{...h,state:"CANCELLED",version:h.version+1,
    updatedAt:now.toISOString(),nextAction:reason}},updatedAt:now}).where(eq(jobsTable.id,row.id));
}
async function currentContext(tx: Tx, h: HumanHandoff, now: Date) {
  if (h.subjectType==="BUYER") {
    const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id,h.subjectId)).for("update");
    if (!row) return false;
    const b = buyerRecord(row,now);
    return row.version===h.subjectVersion && b.qualificationTask?.id===h.contextKey &&
      !["COMPLETED","WAITING_REVIEW"].includes(b.qualificationTask.state)&&b.approvalStatus!=="APPROVED"&&b.currentBuyingStatus!=="NOT_BUYING";
  }
  const [l] = await tx.select().from(leadsTable).where(eq(leadsTable.id,h.subjectId)).for("update");
  return !!l&&!["CLOSED","DEAD_DEAL"].includes(l.stage)&&sellerContext(l)===h.contextKey;
}
export async function listHandoffs() {
  return (await db.select().from(jobsTable).where(eq(jobsTable.kind,"HUMAN_HANDOFF"))
    .orderBy(jobsTable.createdAt)).map(parseHandoff);
}
export async function recordHandoffEvent(id:string,input:unknown,actor:OfferActor,now = new Date()) {
  assertOperationsRole(actor,["OWNER","ANALYST","OPERATOR"]);
  const p = RecordHandoffEventBody.parse(input);
  return db.transaction(async tx=>{
    const [initial] = await tx.select().from(jobsTable).where(and(eq(jobsTable.id,id),eq(jobsTable.kind,"HUMAN_HANDOFF")));
    if (!initial) throw new DomainError("Handoff not found.",404);
    const context = await currentContext(tx,parseHandoff(initial),now); // Subject -> job lock order, same as preparation.
    const [row] = await tx.select().from(jobsTable).where(eq(jobsTable.id,id)).for("update");
    if (!row) throw new DomainError("Handoff not found.",404);
    const h = parseHandoff(row);
    if (!context&&!h.events.some(e=>e.eventKey===p.eventKey)&&!["CANCELLED","REPLIED"].includes(p.kind))
      throw new DomainError("Subject, qualification or follow-up context changed. Review the fresh handoff; no stale outreach can be recorded here.",409);
    const result = applyHandoffEvent(h,p,actor.id,now);
    if (result===h) return h;
    await tx.update(jobsTable).set({payload:{...row.payload,handoff:result},updatedAt:now}).where(eq(jobsTable.id,id));
    if (h.subjectType==="BUYER"&&p.kind==="REPLIED") {
      const [b] = await tx.select().from(buyersTable).where(eq(buyersTable.id,h.subjectId));
      if (b&&Date.parse(p.occurredAt)>Date.parse(String(b.payload.lastOutreachReplyAt??"1970-01-01"))) {
        const task = buyerRecord(b,now).qualificationTask;
        const needsReview = Date.parse(p.occurredAt)>Date.parse(String(b.payload.buyingEvidenceAt??"1970-01-01"));
        await tx.update(buyersTable).set({payload:{...b.payload,lastOutreachReplyAt:p.occurredAt,
          lastOutreachReplyEvidenceUrl:p.evidenceUrl,...(task&&task.id===h.contextKey&&needsReview
            ?{qualificationTask:{...task,state:"WAITING_REVIEW",reason:"Actual reply retained. Owner review of dated buying/criteria/identity/funding evidence is pending; no automatic resend.",updatedAt:now.toISOString()}}:{})},
          version:b.version+1,updatedAt:now}).where(eq(buyersTable.id,b.id));
        await queueJob(tx,"MATCH_BUYERS",null,`handoff-reply:${h.id}:${result.version}`,actor.id);
      }
    }
    await audit(tx,actor.id,`HANDOFF_${p.kind}`,h.subjectId,`Actual event ${p.occurredAt}; recorded ${now.toISOString()}. Human-reported evidence ${p.evidenceUrl}; no automatic send, qualification, offer acceptance or transfer.`);
    return result;
  });
}
export async function reviewHandoffs(now = new Date()) {
  await reviewBuyerPool(now);
  // Retire stale work before preparing current work, retaining all recorded events.
  for (const h of await listHandoffs()) if (active(h)) await db.transaction(async tx=>{
    const current = await currentContext(tx,h,now);
    const [row] = await tx.select().from(jobsTable).where(eq(jobsTable.id,h.id)).for("update");
    if (row&&!current&&active(parseHandoff(row))) await stopHandoff(tx,row,parseHandoff(row),
      "Subject/task changed or became terminal/verified. Stale handoff stopped; historical contact/reply evidence retained.",now);
  });
  const actor = {id:"system:handoffs",role:"ANALYST"};
  const native = new NativeHandoffExecutor(actor,now);
  let prepared = 0;
  for (const row of await db.select().from(buyersTable)) {
    const b = buyerRecord(row,now), task = b.qualificationTask;
    if (!task||["COMPLETED","WAITING_REVIEW"].includes(task.state)||b.approvalStatus==="APPROVED"||b.currentBuyingStatus==="NOT_BUYING") continue;
    await native.execute({id:`buyer:${b.id}:${task.id}:${b.version}`,capability:task.kind==="REVERIFY"?"REVERIFY_BUYER":"QUALIFY_BUYER",
      subjectId:b.id,actorId:actor.id,evidenceReferences:[],approvedCommunicationReference:null}); prepared++;
  }
  for (const l of await db.select().from(leadsTable)) {
    if (!l.followUpAt||l.followUpAt>now||["CLOSED","DEAD_DEAL"].includes(l.stage)) continue;
    await native.execute({id:`seller:${l.id}:${sellerContext(l)}`,capability:"FOLLOW_UP_SELLER",
      subjectId:l.id,actorId:actor.id,evidenceReferences:[],approvedCommunicationReference:null}); prepared++;
  }
  const rows = await listHandoffs(), due = rows.filter(h=>active(h)&&Date.parse(h.dueAt)<=now.getTime()).length;
  return `${prepared} current contexts reviewed; ${due} handoffs due. Preparation/replies are durable; no outreach sent, no approval inferred.`;
}