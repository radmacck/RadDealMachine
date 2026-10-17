import { eq, and, desc } from "drizzle-orm";
import { db, buyersTable, contractsTable, matchesTable, jobsTable } from "@workspace/db";
import { GetDealOperationsResponse } from "@workspace/api-zod";
import { buyerIdentityConflicts, buyerReservations, matchBuyer, rankBuyerMatches, type BuyerMatch, type DealContract, type LeadDetail, DomainError } from "@workspace/deal-domain";
import { allBuyerRecords, buyerRecord, getContractRecord, contractRecord, jobRecord, type Store } from "./operations-records";
import { leadDetail, lockedLead, move, audit } from "./deal-store";
import { leadsTable } from "@workspace/db";

async function evaluatedMatches(detail: LeadDetail, contract: DealContract|null, database: Store, now: Date) {
  const buyers = await allBuyerRecords(database,now);
  const recorded = await database.select().from(matchesTable).where(eq(matchesTable.leadId,detail.lead.id));
  const contracts = (await database.select().from(contractsTable)).map(contractRecord);
  return rankBuyerMatches(buyers.map(b=>{
    const existing = recorded.find(m=>m.buyerId===b.id);
    const previousStatus = existing?.payload.status as BuyerMatch["status"]|undefined;
    const status = b.destinationKind==="BUYER"?previousStatus:undefined;
    const price = status==="COMMITTED"?existing?.payload.agreedPrice as number|undefined:undefined;
    const reservations = buyerReservations(contracts,b.id,contract?.id);
    const evaluated = matchBuyer(b,detail,contract,now,price,reservations.count,reservations.funds);
    const identityConflicts = buyerIdentityConflicts(b,buyers);
    const legacyDestinationResponse = b.destinationKind!=="BUYER"&&existing
      ? existing.payload.legacyDestinationResponse??(["INTERESTED","COMMITTED","DECLINED"].includes(String(previousStatus))
        ?{status:previousStatus,evidence:typeof existing.payload.evidence==="string"?existing.payload.evidence:null}:undefined)
      : undefined;
    return {...evaluated,eligible:evaluated.eligible&&status!=="DECLINED"&&!identityConflicts.length,
      reasons:identityConflicts.length?[...evaluated.reasons,...identityConflicts]:evaluated.reasons,
      mismatches:[...evaluated.mismatches,...identityConflicts,...(status==="DECLINED"?["Buyer declined this exact deal."]:[])],
      status:status??"MATCHED",agreedPrice:status==="COMMITTED"?existing?.payload.agreedPrice as number|null??null:null,
      evidence:status?existing?.payload.evidence as string|null??null:null,
      ...(legacyDestinationResponse?{legacyDestinationResponse}:{})};
  }));
}
export async function dealOperations(id: string, now = new Date()) {
  return db.transaction(async tx=>{
    const detail = await leadDetail(id,tx,now);
    const contract = await getContractRecord(id,tx);
    const matches = await evaluatedMatches(detail,contract,tx,now);
    const rows = await tx.select().from(jobsTable).where(eq(jobsTable.leadId,id)).orderBy(desc(jobsTable.createdAt)).limit(10);
    const hasReviewDocument = !!contract?.documents?.some(document =>
      document.kind==="PURCHASE_TERMS_REVIEW"&&document.attemptNumber===(contract.attemptNumber??1)&&document.sourceOfferId===contract.offerId);
    let nextAction = contract?.status==="CLOSED"?"Deal closed. Review recorded proceeds and preserve settlement evidence.":
      contract?.status==="CANCELLED"?(detail.lead.stage==="DEAD_DEAL"?"Contract cancelled. Retain evidence; owner may restart as a new reviewed attempt.":"Reopened for a new attempt. Refresh evidence and underwriting; a new approved communicated offer is required."):
      contract?.status==="DRAFT"?(hasReviewDocument
        ?"Review the saved fillable terms PDF; its download rechecks the current snapshot. Compare with an approved external agreement and record actual signatures. The worksheet itself is not a contract."
        :"Prepare the fillable terms-review PDF from the authorized snapshot, then use an approved external agreement and record actual signatures. The worksheet is not execution evidence."):
      contract?.committedBuyerId?"Complete title, earnest money, assignment and funds evidence; review the closing deadline.":
      contract?`Review ${matches.filter(m=>m.eligible&&m.destinationKind==="BUYER").length} current acquisition buyers and ${matches.filter(m=>m.eligible&&m.destinationKind!=="BUYER").length} approved destinations. Record real interest; only an acquisition buyer can commit.`:
      "Finish seller conversation and owner-approved offer before preparing a contract.";
    if (contract?.committedBuyerId && !matches.find(m=>m.buyerId===contract.committedBuyerId)?.eligible && !["CLOSED","CANCELLED"].includes(contract.status)) {
      nextAction = "Committed buyer no longer passes current criteria/funding/freshness gates. Resolve the mismatch before closing.";
    }
    return GetDealOperationsResponse.parse({leadId:id,contract,matches,jobs:rows.map(jobRecord),nextAction});
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}
export async function refreshMatches(id: string, now = new Date()) {
  let needsBuyerDemandTask = false;
  await db.transaction(async tx=>{
    const row = await lockedLead(tx,id), contract = await getContractRecord(id,tx);
    const detail = await leadDetail(id,tx,now);
    const results = await evaluatedMatches(detail,contract,tx,now);
    for (const result of results) {
      await tx.insert(matchesTable).values({leadId:id,buyerId:result.buyerId,payload:result,updatedAt:now})
        .onConflictDoUpdate({target:[matchesTable.leadId,matchesTable.buyerId],set:{payload:result,updatedAt:now}});
    }
    const qualified = results.filter(m=>m.eligible&&m.status!=="DECLINED"&&m.destinationKind==="BUYER");
    const destinations = results.filter(m=>m.eligible&&m.status!=="DECLINED"&&m.destinationKind!=="BUYER");
    if (contract && ["UNDER_CONTRACT","BUYER_MATCHED"].includes(row.stage)) {
      needsBuyerDemandTask = qualified.length===0;
      if (qualified.length && row.stage==="UNDER_CONTRACT") await move(tx,row,"BUYER_MATCHED","Current criteria, funding and verification passed automatic matching",`Review ${qualified.length} qualified buyers for this exact deal.`, "system:matching",now);
      else row.nextAction = qualified.length?`Review ${qualified.length} qualified buyers for this exact deal.`:
        destinations.length?`Review ${destinations.length} approved deal-finder/guru destinations; record actual interest and qualify a separate acquisition buyer before commitment.`:
        "No current qualified acquisition buyer. Qualify a buyer with matching geography, price, condition and closing capacity, or reverify stale buyer evidence. A destination is not an acquisition buyer.";
      await tx.update(leadsTable).set({stage:row.stage,nextAction:row.nextAction,version:row.version+1,updatedAt:now}).where(eq(leadsTable.id,id));
    }
    await audit(tx,"system:matching","BUYERS_MATCHED",id,`${qualified.length} qualified of ${results.length} reviewed; every exclusion retains its reasons.`);
  });
  if (needsBuyerDemandTask) {
    const { evaluateLeadDecision } = await import("./intelligence-decision-store");
    await evaluateLeadDecision(id,"system:matching",now);
  }
  return dealOperations(id,now);
}
export async function refreshAllMatches(now = new Date()) {
  const rows = await db.select().from(contractsTable);
  let matched = 0;
  for (const row of rows) {
    const contract = contractRecord(row);
    if (!["DRAFT","CLOSED","CANCELLED"].includes(contract.status)) {
      await refreshMatches(row.leadId,now); matched++;
    }
  }
  return matched;
}