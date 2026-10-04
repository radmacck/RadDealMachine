import { GetCommandCenterResponse } from "@workspace/api-zod";
import { dealActions, strongestOpportunities } from "@workspace/deal-domain";
import { listLeads, leadDetail, callQueue } from "./deal-store";
import { dealOperations } from "./matching-store";
import { allBuyerRecords, jobRecord } from "./operations-records";
import { db, jobsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

export async function commandCenter(role: string, now = new Date()) {
  const leads = await listLeads();
  const deals = await Promise.all(leads.map(l => leadDetail(l.id,undefined,now)));
  const calls = await callQueue(now);
  const operations = await Promise.all(leads.map(l=>dealOperations(l.id,now)));
  const buyers = await allBuyerRecords(db,now);
  const jobs = (await db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt)).limit(30)).map(jobRecord);
  const actions = dealActions(deals,calls,role,now);
  const operate = ["OWNER","OPERATOR"].includes(role);
  for (const op of operations) {
    const d = deals.find(x=>x.lead.id===op.leadId)!;
    if (["CLOSED","DEAD_DEAL"].includes(d.lead.stage)) continue;
    const c = op.contract;
    const add = (category: typeof actions[number]["category"],priority:number,title:string,reason:string,cta:string) =>
      actions.push({id:`${category}:${op.leadId}`,category,priority,title,reason,cta,leadId:op.leadId,href:`/deals/${op.leadId}?work=transaction`,dueAt:c?.closingAt??null});
    if (!c && operate && d.offers.some(o=>o.effectiveStatus==="COMMUNICATED")) {
      add("CONTRACT",88,`Prepare contract: ${d.lead.address}`,"A current exact-term offer was communicated. Prepare frozen transaction terms; external signatures remain required.","Prepare contract");
    }
    if (c && !["CLOSED","CANCELLED"].includes(c.status) && operate) {
      const remaining = Date.parse(c.closingAt)-now.getTime();
      if (remaining<3*86400000) add("DEADLINE",remaining<=0?130:115,`Closing deadline: ${d.lead.address}`,op.nextAction,"Resolve deadline");
      add(c.status==="DRAFT"?"CONTRACT":c.committedBuyerId?"CLOSING":"BUYER_MATCH",c.status==="DRAFT"?85:c.committedBuyerId?90:82,
        `${c.status==="DRAFT"?"Record signed contract":c.committedBuyerId?"Complete closing":"Review qualified buyers"}: ${d.lead.address}`,op.nextAction,"Open transaction");
    }
  }
  if (["OWNER","ANALYST"].includes(role)) for (const b of buyers.filter(b=>b.approvalStatus!=="APPROVED"&&b.currentBuyingStatus!=="NOT_BUYING")) {
    actions.push({id:`BUYER_VERIFICATION:${b.id}`,category:"BUYER_VERIFICATION",priority:b.approvalStatus==="REVERIFICATION_REQUIRED"?92:60,
      title:`${b.approvalStatus==="REVERIFICATION_REQUIRED"?"Reverify":"Qualify"} ${b.name}`,reason:(b.qualificationBlockers??[]).join("; ") || "Current buying and structured criteria require reviewed dated evidence; discovery is not approval.",
      cta:"Review buyer evidence",leadId:null,href:`/buyers/${b.id}`,dueAt:b.validUntil??null});
  }
  if (["OWNER","ANALYST"].includes(role)) for (const j of jobs.filter(j=>j.state==="FAILED")) {
    actions.push({id:`WORKER:${j.id}`,category:"WORKER",priority:70,title:`Review failed ${j.kind.toLowerCase().replace(/_/g," ")} job`,
      reason:j.message,cta:"Inspect worker activity",leadId:j.leadId,href:"/workers",dueAt:null});
  }
  return GetCommandCenterResponse.parse({
    generatedAt:now.toISOString(),deals,calls,operations,buyers,jobs,
    actions:actions.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)),
    opportunities:strongestOpportunities(deals),
  });
}