import { eq, desc, and, gte } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { db, buyersTable, contractsTable, jobsTable } from "@workspace/db";
import { GetBuyerResponse, GetDealOperationsResponse, ListWorkerJobsResponse } from "@workspace/api-zod";
import { buyerQualification, verificationStatus, buyerReservations, DomainError } from "@workspace/deal-domain";
import { buyerOutreachReadiness, type BuyerContactPermission } from "./buyer-outreach";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Store = typeof db | Tx;
export function buyerRecord(row: typeof buyersTable.$inferSelect, now = new Date()) {
  const record = {...row.payload,id:row.id,version:row.version,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
  const candidate = GetBuyerResponse.parse({...record,verificationStatus:"UNVERIFIED"});
  const rawPermission = row.payload.contactPermission;
  const contactPermission = rawPermission && typeof rawPermission === "object" &&
    "status" in rawPermission && "channels" in rawPermission
    ? rawPermission as BuyerContactPermission
    : null;
  const withPermission = {...candidate,contactPermission};
  const qualificationTask = candidate.qualificationTask
    ? {...candidate.qualificationTask,outreachReadiness:buyerOutreachReadiness({...withPermission,contactRouteVerified:false},now)}
    : candidate.qualificationTask;
  return {...candidate,destinationKind:candidate.destinationKind??"BUYER",currentBuyingStatus:candidate.currentBuyingStatus??"UNKNOWN",
    contactPermission:withPermission.contactPermission,qualificationTask,verificationStatus:verificationStatus(candidate,now),
    ...buyerQualification(withPermission,now)};
}
export function contractRecord(row: typeof contractsTable.$inferSelect) {
  const documents = Array.isArray(row.payload.documentArtifacts)
    ? row.payload.documentArtifacts.filter((item):item is Record<string,unknown> => !!item&&typeof item==="object"&&!Array.isArray(item))
      .map(({pdfBase64:_,...metadata})=>metadata)
    : [];
  return GetDealOperationsResponse.shape.contract.options[0].parse({
    ...row.payload,
    deadlineScheduleVersion: typeof row.payload.deadlineScheduleVersion === "number" ? row.payload.deadlineScheduleVersion : 0,
    deadlineSchedule: row.payload.deadlineSchedule ?? null,
    deadlineScheduleHistory: Array.isArray(row.payload.deadlineScheduleHistory) ? row.payload.deadlineScheduleHistory : [],
    documents,id:row.id,leadId:row.leadId,version:row.version,createdAt:row.createdAt.toISOString(),
  });
}
export async function getBuyerRecord(id: string, database: Store = db, now = new Date()) {
  const [row] = await database.select().from(buyersTable).where(eq(buyersTable.id,id));
  if (!row) throw new DomainError("Buyer not found.",404);
  return buyerRecord(row,now);
}
export async function getBuyerContactResearchRecord(id: string, database: Store = db) {
  const [row] = await database.select().from(buyersTable).where(eq(buyersTable.id,id));
  if (!row) throw new DomainError("Buyer not found.",404);
  const history=Array.isArray(row.payload.contactPermissionHistory)?row.payload.contactPermissionHistory:[];
  const permission=row.payload.contactPermission??null;
  const routePresent=!!(row.payload.email||row.payload.phone);
  const nextAction=!routePresent?"Record a route from a permitted source; never invent contact details."
    :(!row.payload.contactSourceUrl||!row.payload.contactObservedAt)?"Add source record URL and observed timestamp; keep identity and permission unverified."
      :!permission?"Owner-review current channel-specific permission before outreach."
        :"Review identity conflicts and ensure permission is current for the selected channel. No message has been sent.";
  return {buyerId:row.id,version:row.version,contactSourceUrl:row.payload.contactSourceUrl??null,
    contactObservedAt:row.payload.contactObservedAt??null,contactConfidence:row.payload.contactConfidence??null,
    contactPermission:permission,contactPermissionHistory:history,nextAction};
}
export async function allBuyerRecords(database: Store = db, now = new Date()) {
  return (await database.select().from(buyersTable).orderBy(desc(buyersTable.updatedAt))).map(row=>buyerRecord(row,now));
}
export async function buyerCapacityRecords(database: Store = db) {
  const [buyerRows,contractRows]=await Promise.all([database.select({id:buyersTable.id}).from(buyersTable),database.select().from(contractsTable)]);
  const contracts=contractRows.map(contractRecord);
  return buyerRows.map(row=>({buyerId:row.id,...buyerReservations(contracts,row.id)}));
}
export async function getContractRecord(id: string, database: Store = db) {
  const [row] = await database.select().from(contractsTable).where(eq(contractsTable.leadId,id));
  return row?contractRecord(row):null;
}
export function jobRecord(row: typeof jobsTable.$inferSelect) {
  return ListWorkerJobsResponse.element.parse({...row,
    termsReviewed:row.payload.termsReviewed===true,
    recurringDiscovery:row.payload.recurringDiscovery===true,
    recurringPropertyDiscovery:row.payload.recurringPropertyDiscovery===true,
    createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()});
}
export async function queueJob(tx: Store, kind: "MATCH_BUYERS"|"REVIEW_DEADLINES"|"ENRICH_PROPERTY"|"PREPARE_BRIEF"|"BUYER_DISCOVERY"|"DISCOVER_PROPERTIES"|"REVIEW_BUYER_POOL"|"REVIEW_HANDOFFS"|"EVALUATE_DECISION", leadId: string|null, key: string, requestedBy: string, payload:Record<string,unknown> = {}) {
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
  if (row.kind!==kind || row.leadId!==leadId || row.requestedBy!==requestedBy || !isDeepStrictEqual(row.payload,payload)) throw new DomainError("Idempotency key belongs to another command.",409);
  return jobRecord(row);
}