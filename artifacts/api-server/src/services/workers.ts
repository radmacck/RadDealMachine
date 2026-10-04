import { and, eq, lt, desc } from "drizzle-orm";
import type { z } from "zod";
import { db, jobsTable, contractsTable } from "@workspace/db";
import { SubmitWorkerJobBody } from "@workspace/api-zod";
import { assertOperationsRole, type OfferActor } from "@workspace/deal-domain";
import { queueJob, jobRecord, allBuyerRecords, contractRecord } from "./operations-records";
import { refreshMatches, refreshAllMatches } from "./matching-store";
import { listLeads, leadDetail } from "./deal-store";
import { logger } from "../lib/logger";

export async function listWorkerJobs() {
  return (await db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt)).limit(100)).map(jobRecord);
}
export async function submitWorkerJob(input: z.infer<typeof SubmitWorkerJobBody>, actor: OfferActor) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  const parsed = SubmitWorkerJobBody.parse(input);
  if (parsed.leadId) await leadDetail(parsed.leadId);
  return queueJob(db,parsed.kind,parsed.leadId??null,`manual:${actor.id}:${parsed.idempotencyKey}`,actor.id);
}
export async function reviewDeadlines(now = new Date()) {
  const leads = await listLeads();
  const followups = leads.filter(l=>!["CLOSED","DEAD_DEAL"].includes(l.stage)&&l.followUpAt&&Date.parse(l.followUpAt)<=now.getTime()).length;
  const contracts = (await db.select().from(contractsTable)).map(contractRecord);
  const deadlines = contracts.filter(c=>!["CLOSED","CANCELLED"].includes(c.status)&&Date.parse(c.closingAt)<now.getTime()+3*86400000).length;
  const stale = (await allBuyerRecords(db,now)).filter(b=>b.status==="ACTIVE"&&b.verificationStatus!=="VERIFIED").length;
  return `${followups} seller follow-ups due; ${deadlines} transaction deadlines within three days or overdue; ${stale} buyers need current verification. Action center reflects each current item. No messages sent.`;
}
/** Durable leased claims: concurrent instances cannot execute the same queued row. */
export async function runWorkerOnce(now = new Date(), schedule = false, onlyJobId?: string) {
  if (schedule) {
    const bucket = Math.floor(now.getTime()/(5*60000));
    await queueJob(db,"REVIEW_DEADLINES",null,`scheduled:deadlines:${bucket}`,"system:scheduler");
    await queueJob(db,"MATCH_BUYERS",null,`scheduled:matches:${bucket}`,"system:scheduler");
  }
  await db.update(jobsTable).set({state:"QUEUED",message:"Worker lease expired; work requeued.",updatedAt:now})
    .where(and(eq(jobsTable.state,"RUNNING"),lt(jobsTable.updatedAt,new Date(now.getTime()-3*60000)),lt(jobsTable.attempts,3)));
  await db.update(jobsTable).set({state:"FAILED",message:"Worker lease expired after three attempts. Review and submit a fresh retry.",updatedAt:now})
    .where(and(eq(jobsTable.state,"RUNNING"),lt(jobsTable.updatedAt,new Date(now.getTime()-3*60000))));
  const row = await db.transaction(async tx=>{
    const [job] = await tx.select().from(jobsTable).where(onlyJobId?and(eq(jobsTable.state,"QUEUED"),eq(jobsTable.id,onlyJobId)):eq(jobsTable.state,"QUEUED")).orderBy(jobsTable.createdAt).limit(1).for("update",{skipLocked:true});
    if (!job) return null;
    const [claimed] = await tx.update(jobsTable).set({state:"RUNNING",attempts:job.attempts+1,message:"Executing persisted work.",updatedAt:now}).where(eq(jobsTable.id,job.id)).returning();
    return claimed??null;
  });
  if (!row) return null;
  try {
    let message: string;
    if (row.kind==="MATCH_BUYERS") {
      if (row.leadId) {
        const result = await refreshMatches(row.leadId,now);
        message = `Reviewed ${result.matches.length} buyers; ${result.matches.filter(m=>m.eligible).length} currently qualified for this exact deal.`;
      } else message = `Recomputed criteria, funding, verification and deadlines for ${await refreshAllMatches(now)} active signed transactions.`;
    } else if (row.kind==="REVIEW_DEADLINES") message = await reviewDeadlines(now);
    else throw new Error("No executor is registered for this worker kind.");
    const [finished] = await db.update(jobsTable).set({state:"SUCCEEDED",message,updatedAt:new Date()}).where(and(eq(jobsTable.id,row.id),eq(jobsTable.state,"RUNNING"))).returning();
    return finished?jobRecord(finished):null;
  } catch (error) {
    const message = error instanceof Error?error.message:"Worker failed. No success was recorded.";
    const [failed] = await db.update(jobsTable).set({state:"FAILED",message,updatedAt:new Date()}).where(eq(jobsTable.id,row.id)).returning();
    logger.warn({jobId:row.id,kind:row.kind},"Worker failed; inspect the persisted failure and retry safely.");
    return failed?jobRecord(failed):null;
  }
}
export function startWorkers() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runWorkerOnce(new Date(),true); }
    catch (error) { logger.error({err:error},"Worker polling failed; queued jobs remain persisted."); }
    finally { busy=false; }
  };
  const timer = setInterval(()=>{void tick();},15000);
  timer.unref();
  void tick();
  return ()=>clearInterval(timer);
}