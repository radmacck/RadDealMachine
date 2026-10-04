import { eq, desc, and, gte } from "drizzle-orm";
import { db, buyersTable, contractsTable, jobsTable } from "@workspace/db";
import { GetBuyerResponse, GetDealOperationsResponse, ListWorkerJobsResponse } from "@workspace/api-zod";
import { buyerQualification, verificationStatus, DomainError } from "@workspace/deal-domain";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Store = typeof db | Tx;
export function buyerRecord(row: typeof buyersTable.$inferSelect, now = new Date()) {
  const record = {...row.payload,id:row.id,version:row.version,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
  const candidate = GetBuyerResponse.parse({...record,verificationStatus:"UNVERIFIED"});
  return {...candidate,destinationKind:candidate.destinationKind??"BUYER",currentBuyingStatus:candidate.currentBuyingStatus??"UNKNOWN",
    verificationStatus:verificationStatus(candidate,now),...buyerQualification(candidate,now)};
}
export function contractRecord(row: typeof contractsTable.$inferSelect) {
  return GetDealOperationsResponse.shape.contract.options[0].parse({
    ...row.payload,id:row.id,leadId:row.leadId,version:row.version,createdAt:row.createdAt.toISOString(),
  });
}
export async function getBuyerRecord(id: string, database: Store = db, now = new Date()) {
  const [row] = await database.select().from(buyersTable).where(eq(buyersTable.id,id));
  if (!row) throw new DomainError("Buyer not found.",404);
  return buyerRecord(row,now);
}
export async function allBuyerRecords(database: Store = db, now = new Date()) {
  return (await database.select().from(buyersTable).orderBy(desc(buyersTable.updatedAt))).map(row=>buyerRecord(row,now));
}
export async function getContractRecord(id: string, database: Store = db) {
  const [row] = await database.select().from(contractsTable).where(eq(contractsTable.leadId,id));
  return row?contractRecord(row):null;
}
export function jobRecord(row: typeof jobsTable.$inferSelect) {
  return ListWorkerJobsResponse.element.parse({...row,recurringDiscovery:row.payload.recurringDiscovery===true,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()});
}
export async function queueJob(tx: Store, kind: "MATCH_BUYERS"|"REVIEW_DEADLINES"|"ENRICH_PROPERTY"|"PREPARE_BRIEF"|"BUYER_DISCOVERY"|"REVIEW_BUYER_POOL", leadId: string|null, key: string, requestedBy: string, payload:Record<string,unknown> = {}) {
  let budgetReached = false;
  if (kind==="PREPARE_BRIEF"&&leadId) {
    const since = new Date(); since.setUTCHours(0,0,0,0);
    const today = await tx.select({id:jobsTable.id}).from(jobsTable).where(and(eq(jobsTable.leadId,leadId),eq(jobsTable.kind,kind),gte(jobsTable.createdAt,since)));
    budgetReached = today.length>=6;
  }
  await tx.insert(jobsTable).values({kind,payload,leadId,idempotencyKey:key,requestedBy,
    ...(budgetReached?{state:"FAILED",message:"Daily AI budget reached: six prepared-brief jobs per deal per UTC day. No model call was made. Core deal actions are not blocked."}:{})}).onConflictDoNothing();
  const [row] = await tx.select().from(jobsTable).where(eq(jobsTable.idempotencyKey,key));
  if (!row) throw new Error("Queued job could not be read.");
  if (row.kind!==kind || row.leadId!==leadId || row.requestedBy!==requestedBy || JSON.stringify(row.payload)!==JSON.stringify(payload)) throw new DomainError("Idempotency key belongs to another command.",409);
  return jobRecord(row);
}