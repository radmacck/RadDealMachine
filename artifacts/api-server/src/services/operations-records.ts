import { eq, desc } from "drizzle-orm";
import { db, buyersTable, contractsTable, jobsTable } from "@workspace/db";
import { GetBuyerResponse, GetDealOperationsResponse, ListWorkerJobsResponse } from "@workspace/api-zod";
import { verificationStatus, DomainError } from "@workspace/deal-domain";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Store = typeof db | Tx;
export function buyerRecord(row: typeof buyersTable.$inferSelect, now = new Date()) {
  const record = {...row.payload,id:row.id,version:row.version,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
  const candidate = GetBuyerResponse.parse({...record,verificationStatus:"UNVERIFIED"});
  return {...candidate,verificationStatus:verificationStatus(candidate,now)};
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
  return ListWorkerJobsResponse.element.parse({...row,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()});
}
export async function queueJob(tx: Store, kind: "MATCH_BUYERS"|"REVIEW_DEADLINES", leadId: string|null, key: string, requestedBy: string) {
  await tx.insert(jobsTable).values({kind,leadId,idempotencyKey:key,requestedBy}).onConflictDoNothing();
  const [row] = await tx.select().from(jobsTable).where(eq(jobsTable.idempotencyKey,key));
  if (!row) throw new Error("Queued job could not be read.");
  if (row.kind!==kind || row.leadId!==leadId || row.requestedBy!==requestedBy) throw new DomainError("Idempotency key belongs to another command.",409);
  return jobRecord(row);
}