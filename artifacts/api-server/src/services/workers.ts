import { and, eq, lt, desc, sql } from "drizzle-orm";
import type { z } from "zod";
import { db, jobsTable, contractsTable, leadsTable } from "@workspace/db";
import { SubmitWorkerJobBody } from "@workspace/api-zod";
import { assertOperationsRole, DomainError, type OfferActor } from "@workspace/deal-domain";
import { enrichProperty, prepareSellerBrief } from "./research-worker";
import { queueJob, jobRecord, allBuyerRecords, contractRecord } from "./operations-records";
import { refreshMatches, refreshAllMatches } from "./matching-store";
import { listLeads, leadDetail } from "./deal-store";
import { logger } from "../lib/logger";
import { discoverPublicBuyers, reviewBuyerPool } from "./buyer-pool";
import { discoverPublicProperties } from "./property-discovery-worker";
import { refreshPropertyBuyerDemandAlignment } from "./property-discovery-store";
import { reviewHandoffs } from "./handoffs";

const PROPERTY_SOURCE_POLICY_VERSION = "phila-property-sources-v4";
const BUYER_SOURCE_POLICY_VERSION = "phila-buyer-sources-v2";

export async function listWorkerJobs() {
  return (await db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt)).limit(100)).map(jobRecord);
}
export async function submitWorkerJob(input: z.infer<typeof SubmitWorkerJobBody>, actor: OfferActor) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  const parsed = SubmitWorkerJobBody.parse(input);
  if (["ENRICH_PROPERTY","PREPARE_BRIEF"].includes(parsed.kind)&&!parsed.leadId) throw new DomainError("Address checks and prepared briefs require one selected deal.");
  if (parsed.leadId) await leadDetail(parsed.leadId);
  if (["BUYER_DISCOVERY","DISCOVER_PROPERTIES"].includes(parsed.kind)&&(!parsed.termsReviewed||parsed.leadId)) {
    throw new DomainError("Public discovery requires reviewed source terms and cannot target a seller lead.");
  }
  return db.transaction(async tx=>{
    if (parsed.leadId) await tx.select({id:leadsTable.id}).from(leadsTable).where(eq(leadsTable.id,parsed.leadId)).for("update");
    return queueJob(tx,parsed.kind,parsed.leadId??null,`manual:${actor.id}:${parsed.idempotencyKey}`,actor.id,
      parsed.kind==="BUYER_DISCOVERY"
        ?{termsReviewed:true,recurringDiscovery:parsed.recurringDiscovery===true,sourcePolicyVersion:BUYER_SOURCE_POLICY_VERSION}
        :parsed.kind==="DISCOVER_PROPERTIES"
          ?{termsReviewed:true,recurringPropertyDiscovery:parsed.recurringPropertyDiscovery===true,sourcePolicyVersion:PROPERTY_SOURCE_POLICY_VERSION}:{});
  });
}
export async function reviewDeadlines(now = new Date()) {
  const leads = await listLeads();
  const followups = leads.filter(l=>!["CLOSED","DEAD_DEAL"].includes(l.stage)&&l.followUpAt&&Date.parse(l.followUpAt)<=now.getTime()).length;
  const contracts = (await db.select().from(contractsTable)).map(contractRecord);
  const deadlines = contracts.filter(c=>!["CLOSED","CANCELLED"].includes(c.status)&&Date.parse(c.closingAt)<now.getTime()+3*86400000).length;
  const stale = (await allBuyerRecords(db,now)).filter(b=>b.approvalStatus!=="APPROVED"&&b.currentBuyingStatus!=="NOT_BUYING").length;
  const staleLeads = leads.filter(l=>!["CLOSED","DEAD_DEAL"].includes(l.stage)&&now.getTime()-Date.parse(l.updatedAt)>30*86400000).length;
  return `${followups} seller follow-ups due; ${staleLeads} leads unchanged for 30 days; ${deadlines} transaction deadlines within three days or overdue; ${stale} buyers need current qualification. Action center reflects current work. No messages sent.`;
}
/** Durable leased claims: concurrent instances cannot execute the same queued row. */
export async function runWorkerOnce(now = new Date(), schedule = false, onlyJobId?: string) {
  if (schedule) {
    const bucket = Math.floor(now.getTime()/(5*60000));
    await queueJob(db,"REVIEW_DEADLINES",null,`scheduled:deadlines:${bucket}`,"system:scheduler");
    await queueJob(db,"MATCH_BUYERS",null,`scheduled:matches:${bucket}`,"system:scheduler");
    await queueJob(db,"REVIEW_BUYER_POOL",null,`scheduled:buyer-pool:${bucket}`,"system:scheduler");
    await queueJob(db,"REVIEW_HANDOFFS",null,`scheduled:handoffs:${bucket}`,"system:scheduler");
    const [policy] = await db.select().from(jobsTable).where(and(eq(jobsTable.kind,"BUYER_DISCOVERY"),
      sql`${jobsTable.idempotencyKey} like 'manual:%'`)).orderBy(desc(jobsTable.createdAt)).limit(1);
    if (policy?.payload.termsReviewed===true && policy.payload.sourcePolicyVersion===BUYER_SOURCE_POLICY_VERSION &&
      policy.payload.recurringDiscovery===true) {
      await queueJob(db,"BUYER_DISCOVERY",null,`scheduled:buyer-discovery:${Math.floor(now.getTime()/(6*3600000))}`,
        "system:scheduler",{termsReviewed:true,recurringDiscovery:true,sourcePolicyVersion:BUYER_SOURCE_POLICY_VERSION});
    }
    const [propertyPolicy] = await db.select().from(jobsTable).where(and(eq(jobsTable.kind,"DISCOVER_PROPERTIES"),
      sql`${jobsTable.idempotencyKey} like 'manual:%'`)).orderBy(desc(jobsTable.createdAt)).limit(1);
    if (propertyPolicy?.payload.termsReviewed===true && propertyPolicy.payload.sourcePolicyVersion===PROPERTY_SOURCE_POLICY_VERSION &&
      propertyPolicy.payload.recurringPropertyDiscovery===true) {
      await queueJob(db,"DISCOVER_PROPERTIES",null,
        `scheduled:property-discovery:${Math.floor(now.getTime()/(6*3600000))}`,
        "system:scheduler",{termsReviewed:true,recurringPropertyDiscovery:true,sourcePolicyVersion:PROPERTY_SOURCE_POLICY_VERSION});
    }
    // Bootstrap existing reviewed deals once per snapshot, not a paid AI run every tick.
    const rows = await db.select().from(leadsTable);
    let seeded = 0;
    for (const lead of rows) {
      const age = now.getTime()-Date.parse(String(lead.analysis?.calculatedAt));
      if (seeded>=10) break;
      if (!lead.analysisSnapshotId || !["STRONG","NEGOTIABLE"].includes(String(lead.analysis?.classification)) ||
        ["CLOSED","DEAD_DEAL"].includes(lead.stage) || !Number.isFinite(age) || age<0 || age>=7*86400000) continue;
      const key = `brief:${lead.id}:${lead.analysisSnapshotId}`;
      const [exists] = await db.select({id:jobsTable.id}).from(jobsTable).where(eq(jobsTable.idempotencyKey,key));
      if (exists) continue;
      await db.transaction(async tx=>{
        await tx.select({id:leadsTable.id}).from(leadsTable).where(eq(leadsTable.id,lead.id)).for("update");
        await queueJob(tx,"PREPARE_BRIEF",lead.id,key,"system:scheduler");
      });
      seeded++;
    }
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
  const heartbeat = setInterval(()=>{
    void db.update(jobsTable).set({updatedAt:new Date()})
      .where(and(eq(jobsTable.id,row.id),eq(jobsTable.state,"RUNNING"),eq(jobsTable.attempts,row.attempts)))
      .catch(()=>logger.warn({jobId:row.id},"Worker heartbeat failed; the persisted lease may need recovery."));
  },15000);
  heartbeat.unref();
  try {
    let message: string;
    if (row.kind==="MATCH_BUYERS") {
      if (row.leadId) {
        const result = await refreshMatches(row.leadId,now);
        message = `Reviewed ${result.matches.length} buyers; ${result.matches.filter(m=>m.eligible).length} currently qualified for this exact deal.`;
      } else message = `Recomputed criteria, funding, verification and deadlines for ${await refreshAllMatches(now)} active signed transactions.`;
    } else if (row.kind==="REVIEW_DEADLINES") message = await reviewDeadlines(now);
    else if (row.kind==="REVIEW_BUYER_POOL") {
      const buyerReview = await reviewBuyerPool(now);
      const demandRefresh = await refreshPropertyBuyerDemandAlignment(now);
      message = `${buyerReview} ${demandRefresh.message}`;
    }
    else if (row.kind==="REVIEW_HANDOFFS") message = await reviewHandoffs(now);
    else if (row.kind==="BUYER_DISCOVERY"&&row.payload.termsReviewed===true&&row.payload.sourcePolicyVersion===BUYER_SOURCE_POLICY_VERSION) message = await discoverPublicBuyers(now);
    else if (row.kind==="DISCOVER_PROPERTIES"&&row.payload.termsReviewed===true&&row.payload.sourcePolicyVersion===PROPERTY_SOURCE_POLICY_VERSION) message = await discoverPublicProperties(now);
    else if (row.kind==="BUYER_DISCOVERY"||row.kind==="DISCOVER_PROPERTIES") {
      throw new Error("This public-source job was queued under an earlier terms review. Review the current connector terms and queue a new job; old consent was not extended to the added sources.");
    }
    else if (row.kind==="ENRICH_PROPERTY"&&row.leadId) message = await enrichProperty(row.leadId,row.id,now);
    else if (row.kind==="PREPARE_BRIEF"&&row.leadId) message = await prepareSellerBrief(row.leadId,row.id,now);
    else throw new Error("No executor is registered for this worker kind.");
    const [finished] = await db.update(jobsTable).set({state:"SUCCEEDED",message,updatedAt:new Date()}).where(and(eq(jobsTable.id,row.id),eq(jobsTable.state,"RUNNING"),eq(jobsTable.attempts,row.attempts))).returning();
    return finished?jobRecord(finished):null;
  } catch (error) {
    const message = error instanceof Error?error.message:"Worker failed. No success was recorded.";
    const [failed] = await db.update(jobsTable).set({state:"FAILED",message,updatedAt:new Date()}).where(and(eq(jobsTable.id,row.id),eq(jobsTable.state,"RUNNING"),eq(jobsTable.attempts,row.attempts))).returning();
    logger.warn({jobId:row.id,kind:row.kind},"Worker failed; inspect the persisted failure and retry safely.");
    return failed?jobRecord(failed):null;
  } finally { clearInterval(heartbeat); }
}
export function startWorkers() {
  let busy = false;
  let lastScheduledBucket = -1;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = new Date(), bucket = Math.floor(now.getTime()/(5*60000));
      const schedule = bucket!==lastScheduledBucket;
      await runWorkerOnce(now,schedule);
      if (schedule) lastScheduledBucket = bucket;
    }
    catch (error) { logger.error({err:error},"Worker polling failed; queued jobs remain persisted."); }
    finally { busy=false; }
  };
  const timer = setInterval(()=>{void tick();},15000);
  timer.unref();
  void tick();
  return ()=>clearInterval(timer);
}