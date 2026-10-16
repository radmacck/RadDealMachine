import { and, eq, inArray } from "drizzle-orm";
import { auditTable, db, operationalAlertsTable, transactionReadinessExceptionsTable, jobsTable } from "@workspace/db";
import type { CommandAction } from "@workspace/deal-domain";
import { DomainError } from "@workspace/deal-domain";

export async function listOperationalAlerts(actions: CommandAction[], now = new Date(), role = "OWNER") {
  const exceptions=await db.select().from(transactionReadinessExceptionsTable).where(eq(transactionReadinessExceptionsTable.status,"OPEN"));
  const failedJobs=await db.select().from(jobsTable).where(eq(jobsTable.state,"FAILED"));
  const exceptionActions=exceptions.map(exception=>({
    id:`exception:${exception.contractId}:${exception.issueKey}`,category:exception.category.includes("DEADLINE")?"DEADLINE":"CONTRACT",
    priority:exception.severity==="HIGH"?100:exception.severity==="MEDIUM"?70:40,title:exception.issueKey,
    reason:exception.nextAction,leadId:exception.leadId,href:`/leads/${exception.leadId}`,cta:"Resolve exception",dueAt:exception.eventAt?.toISOString()??null,
    workGuidance:{responsibleRole:exception.ownerRole},
  } as unknown as CommandAction));
  const workerActions=failedJobs.map(job=>({
    id:`worker-failure:${job.id}`,category:"WORKER",priority:95,title:"Worker/provider job failed",
    reason:job.message||"A persisted job failed and needs operator review.",leadId:null,href:"/workers",cta:"Review job",dueAt:job.updatedAt.toISOString(),
    workGuidance:{responsibleRole:"OPERATOR"},
  } as unknown as CommandAction));
  actions=[...actions,...exceptionActions,...workerActions];
  const existing = await db.select().from(operationalAlertsTable);
  const byKey = new Map(existing.map(row => [row.alertKey,row]));
  const liveKeys = new Set(actions.map(action => action.id));
  for (const action of actions) {
    const old = byKey.get(action.id);
    const fields = {sourceActionId:action.id,sourceRecordId:action.leadId ?? action.id,category:action.category,priority:action.priority,
      title:action.title,reason:action.reason,href:action.href,payload:{dueAt:action.dueAt,cta:action.cta,responsibleRole:action.workGuidance?.responsibleRole??"OPERATOR"}};
    if (!old) await db.insert(operationalAlertsTable).values({alertKey:action.id,...fields,status:"ACTIVE",createdAt:now,updatedAt:now}).onConflictDoNothing();
    else {
      const status = old.status==="RESOLVED" ? "ACTIVE" : old.snoozedUntil&&old.snoozedUntil<=now ? "ACTIVE" : old.status;
      await db.update(operationalAlertsTable).set({...fields,status,snoozedUntil:status==="ACTIVE"?null:old.snoozedUntil,updatedAt:now})
        .where(eq(operationalAlertsTable.id,old.id));
    }
  }
  for (const old of existing) if (!liveKeys.has(old.alertKey)&&["ACTIVE","SNOOZED","DISMISSED"].includes(old.status))
    await db.update(operationalAlertsTable).set({status:"RESOLVED",snoozedUntil:null,updatedAt:now}).where(eq(operationalAlertsTable.id,old.id));
  const current = await db.select().from(operationalAlertsTable)
    .where(inArray(operationalAlertsTable.status,["ACTIVE","SNOOZED"]));
  return current.filter(row=>(role==="OWNER"||row.payload.responsibleRole===role)&&
    (row.status==="ACTIVE"||!row.snoozedUntil||row.snoozedUntil<=now))
    .map(row=>row.status==="SNOOZED"?{...row,status:"ACTIVE",snoozedUntil:null}:row)
    .sort((a,b)=>b.priority-a.priority||a.createdAt.getTime()-b.createdAt.getTime());
}

export async function updateOperationalAlert(id:string,decision:"DISMISS"|"SNOOZE",actor:{id:string;role:string},until?:Date,now=new Date()) {
  if (!["OWNER","OPERATOR"].includes(actor.role)) throw new DomainError("Only owners and operators can manage operational alerts.",403);
  if (decision==="SNOOZE"&&(!until||until<=now||until.getTime()>now.getTime()+30*24*60*60_000))
    throw new DomainError("Snooze must end within the next 30 days.",400);
  const [row]=await db.select().from(operationalAlertsTable).where(eq(operationalAlertsTable.id,id)).limit(1);
  if (!row) throw new DomainError("Alert not found.",404);
  if (["DISMISSED","RESOLVED"].includes(row.status)) throw new DomainError("This alert is no longer actionable.",409);
  const status=decision==="DISMISS"?"DISMISSED":"SNOOZED";
  const [updated]=await db.update(operationalAlertsTable).set({status,snoozedUntil:decision==="SNOOZE"?until:null,updatedAt:now})
    .where(and(eq(operationalAlertsTable.id,id),inArray(operationalAlertsTable.status,["ACTIVE","SNOOZED"]))).returning();
  if (!updated) throw new DomainError("Alert changed; reload before retrying.",409);
  await db.insert(auditTable).values({actor:actor.id,action:`OPERATIONAL_ALERT_${decision}`,entityId:id,
    detail:decision==="SNOOZE"?`Alert snoozed until ${until!.toISOString()}.`:"Alert dismissed by operator.",createdAt:now});
  return updated;
}
