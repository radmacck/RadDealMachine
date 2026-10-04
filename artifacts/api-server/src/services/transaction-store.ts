import { eq, and, lte, gt, desc, sql } from "drizzle-orm";
import { db, contractsTable, leadsTable, buyersTable, matchesTable, offersTable, analysesTable, intelligenceTable } from "@workspace/db";
import type { z } from "zod";
import {
  CreateContractBody, ExecuteContractBody, RecordBuyerResponseBody, RecordClosingMilestoneBody, RecordDealOutcomeBody,
} from "@workspace/api-zod";
import {
  assertOperationsRole, buyerReservations, evidenceUrl, pastInstant, wholeDollars, closingBlockers, matchBuyer, DomainError, DAY,
  type OfferActor, type DealContract,
  evidenceReviewedAnalysis, type Analysis, type Lead, type UnderwritingInput, type Intelligence,
} from "@workspace/deal-domain";
import { lockedLead, leadDetail, move, audit } from "./deal-store";
import { contractRecord, buyerRecord, queueJob, type Tx } from "./operations-records";
import { dealOperations, refreshMatches } from "./matching-store";

export async function lockedContract(tx: Tx, id: string, version: number) {
  const [row] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId,id)).for("update");
  if (!row) throw new DomainError("Prepare the contract first.",409);
  if (row.version!==version) throw new DomainError("Transaction changed. Reload before saving.",409);
  const contract = contractRecord(row);
  if (["CLOSED","CANCELLED"].includes(contract.status)) throw new DomainError("This transaction is terminal; its history is read-only.",409);
  return {row,contract};
}
export async function save(tx: Tx,row: typeof contractsTable.$inferSelect, contract: DealContract, now: Date) {
  const {id:_,leadId:__,version:___,createdAt:____,...payload} = contract;
  await tx.update(contractsTable).set({payload,version:row.version+1,updatedAt:now}).where(eq(contractsTable.id,row.id));
}
export async function saveLead(tx: Tx,row: typeof leadsTable.$inferSelect, now: Date) {
  await tx.update(leadsTable).set({stage:row.stage,nextAction:row.nextAction,version:row.version+1,updatedAt:now}).where(eq(leadsTable.id,row.id));
}
export async function createContract(id: string,input: z.infer<typeof CreateContractBody>,actor: OfferActor,now = new Date()) {
  assertOperationsRole(actor,["OWNER","OPERATOR"]);
  const parsed = CreateContractBody.parse(input);
  await db.transaction(async tx=>{
    const lead = await lockedLead(tx,id,parsed.version);
    const [exists] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId,id));
    if (exists && exists.payload.status!=="CANCELLED") throw new DomainError("This deal already has an active transaction. Open its existing workspace.",409);
    const detail = await leadDetail(id,tx,now);
    const offer = detail.offers.find(o=>o.id===parsed.offerId && o.effectiveStatus==="COMMUNICATED");
    if (!offer || !detail.analysis) throw new DomainError("A current owner-approved, actually communicated exact-term offer is required.",409);
    const close = Date.parse(parsed.closingAt);
    if (!Number.isFinite(close) || close<=now.getTime() || close>now.getTime()+offer.closingDays*DAY) throw new DomainError("Closing deadline must be future and within the approved closing target.");
    const payload: Record<string,unknown> = {
      offerId:offer.id,status:"DRAFT",purchasePrice:offer.amount,assignmentTarget:detail.analysis.assumptions.assignmentTarget,
      earnestMoney:offer.earnestMoney,assignmentAllowed:offer.assignmentIntent,closingAt:parsed.closingAt,
      contingencies:offer.contingencies,milestones:[],attemptNumber:exists?Number(exists.payload.attemptNumber??1)+1:1,
    };
    if (exists) {
      const responses = await tx.select().from(matchesTable).where(eq(matchesTable.leadId,id));
      const {history:_,...previousState} = exists.payload;
      payload.history = [...(Array.isArray(exists.payload.history)?exists.payload.history:[]),{
        kind:"CANCELLED_ATTEMPT",recordedAt:now.toISOString(),effectiveAt:now.toISOString(),recordedBy:actor.id,
        evidenceUrl:String(exists.payload.outcomeEvidenceUrl??(Array.isArray(exists.payload.history)?exists.payload.history.at(-1)?.evidenceUrl:"")),
        note:"New exact approved terms begin a distinct attempt; prior cancelled agreement and buyer responses retained. For an unexecuted abandoned draft, the link records owner-reviewed restart rather than claiming a signed cancellation.",
        previousState:{...previousState,buyerResponses:responses.map(r=>({buyerId:r.buyerId,...r.payload}))},
      }];
      await tx.update(contractsTable).set({payload,version:exists.version+1,updatedAt:now}).where(eq(contractsTable.id,exists.id));
      // Clear only derived CURRENT response state; originals remain in the cancelled-attempt history.
      for (const r of responses) await tx.update(matchesTable).set({payload:{...r.payload,status:"MATCHED",agreedPrice:null,
        commitmentEvidenceUrl:null,evidence:null,eligible:false,mismatches:["New attempt is not externally executed yet."]},updatedAt:now}).where(eq(matchesTable.id,r.id));
    } else await tx.insert(contractsTable).values({leadId:id,payload});
    await move(tx,lead,"CONTRACT_PENDING","Prepared frozen terms from the exact communicated proposal","Review external contract against frozen terms, then record both signatures.",actor.id,now);
    await saveLead(tx,lead,now);
    await audit(tx,actor.id,"CONTRACT_PREPARED",id,`Exact approved purchase $${offer.amount}; no document signed or generated by the system.`);
  });
  return dealOperations(id,now);
}
export async function executeContract(id: string,input: z.infer<typeof ExecuteContractBody>,actor: OfferActor,now = new Date()) {
  assertOperationsRole(actor,["OWNER"]);
  const parsed = ExecuteContractBody.parse(input);
  evidenceUrl(parsed.executedDocumentUrl);
  const sellerAt = pastInstant(parsed.sellerSignedAt,now,"Seller signature"), acquisitionAt = pastInstant(parsed.acquisitionSignedAt,now,"Acquisition signature");
  await db.transaction(async tx=>{
    const lead = await lockedLead(tx,id), {row,contract} = await lockedContract(tx,id,parsed.version);
    if (contract.status!=="DRAFT") throw new DomainError("Signatures have already been recorded.",409);
    const [offerRow] = await tx.select().from(offersTable).where(and(eq(offersTable.id,contract.offerId),eq(offersTable.leadId,id)));
    const offer = offerRow?.payload;
    const signedAt = Math.max(sellerAt,acquisitionAt);
    if (!offerRow||!offer?.approvedBy||!offer?.communicatedAt||!offer.expiresAt||!offer.approvedAt ||
      Math.min(sellerAt,acquisitionAt)<Math.max(Date.parse(String(offer.communicatedAt)),Date.parse(String(offer.approvedAt))) ||
      signedAt>=Date.parse(String(offer.expiresAt)) || signedAt>=Date.parse(contract.closingAt))
      throw new DomainError("Both actual signatures must follow recorded approval/communication and precede its expiry and the closing deadline. Late recording never backdates authorization.",409);
    if (!["AUTHORIZED","COMMUNICATED"].includes(offerRow.status)&&
      Date.parse(String(offer.authorityEndedAt??offerRow.updatedAt.toISOString()))<=signedAt)
      throw new DomainError("Offer authority was withdrawn or invalidated before execution.",409);
    const [snapshot] = await tx.select().from(analysesTable).where(and(eq(analysesTable.id,offerRow.analysisSnapshotId),eq(analysesTable.leadId,id)));
    if (!snapshot) throw new DomainError("Original authorized financial snapshot is missing.",409);
    const original = snapshot.snapshot as {lead:Lead;input:UnderwritingInput;analysis:Analysis};
    const evidence = await tx.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,id));
    const records = evidence.map(e=>({...e.payload,id:e.id,leadId:id,createdBy:e.createdBy,createdAt:e.createdAt.toISOString()})) as Intelligence[];
    const historical = evidenceReviewedAnalysis(original.analysis,original.lead,original.input,records,new Date(signedAt));
    const authority = records.find(e=>e.id===offer.authorityEvidenceId);
    if (!historical||historical.blockers.length||signedAt-Date.parse(historical.calculatedAt)>=7*DAY||
      !authority||authority.classification!=="VERIFIED_FACTS"||authority.sourceType!=="PUBLIC_RECORD"||
      signedAt-Date.parse(authority.capturedAt)<0||signedAt-Date.parse(authority.capturedAt)>30*DAY)
      throw new DomainError("Persisted source/financial/authority evidence does not prove valid authorization at actual signature time.",409);
    Object.assign(contract,{status:"UNDER_CONTRACT",executedDocumentUrl:parsed.executedDocumentUrl,
      sellerSignedAt:parsed.sellerSignedAt,acquisitionSignedAt:parsed.acquisitionSignedAt,reviewNote:parsed.reviewNote});
    await save(tx,row,contract,now);
    await move(tx,lead,"UNDER_CONTRACT","Owner recorded externally executed acquisition agreement","Automatic matching queued. Review qualified buyers for this exact deal.",actor.id,now);
    await saveLead(tx,lead,now);
    await queueJob(tx,"MATCH_BUYERS",id,`execution:${row.id}:${row.version+1}`,actor.id);
    await audit(tx,actor.id,"CONTRACT_EXECUTION_RECORDED",id,`Owner recorded external signatures at ${new Date(signedAt).toISOString()}, recorded ${now.toISOString()}; original authorization/source snapshot checked at execution time. System did not e-sign or establish title clearance.`);
  });
  // Produce immediately useful matches; the durable job remains as a refresh/recovery path.
  return refreshMatches(id,now);
}
export async function recordBuyerResponse(id: string,buyerId: string,input: z.infer<typeof RecordBuyerResponseBody>,actor: OfferActor,now = new Date()) {
  const parsed = RecordBuyerResponseBody.parse(input);
  assertOperationsRole(actor,parsed.status==="COMMITTED"?["OWNER"]:["OWNER","OPERATOR"]);
  await db.transaction(async tx=>{
    const lead = await lockedLead(tx,id), {row,contract} = await lockedContract(tx,id,parsed.version);
    if (contract.status==="DRAFT") throw new DomainError("Record the externally signed acquisition contract before buyer responses.",409);
    const [buyerRow] = await tx.select().from(buyersTable).where(eq(buyersTable.id,buyerId)).for("update");
    if (!buyerRow) throw new DomainError("Buyer not found.",404);
    if (buyerRow.version!==parsed.buyerVersion) throw new DomainError("Buyer criteria or evidence changed. Review the current match.",409);
    const buyer = buyerRecord(buyerRow,now), detail = await leadDetail(id,tx,now);
    if (parsed.status==="COMMITTED"&&buyer.destinationKind!=="BUYER") throw new DomainError("A deal-finder/guru destination cannot commit as the acquisition buyer. Qualify and record the actual end buyer.",409);
    const reservations = buyerReservations((await tx.select().from(contractsTable)).map(contractRecord),buyer.id,contract.id);
    const evaluated = matchBuyer(buyer,detail,contract,now,parsed.status==="COMMITTED"?parsed.agreedPrice:undefined,reservations.count,reservations.funds);
    const [existing] = await tx.select().from(matchesTable).where(and(eq(matchesTable.leadId,id),eq(matchesTable.buyerId,buyerId)));
    if (existing?.payload.status==="COMMITTED") throw new DomainError("A committed buyer cannot be silently changed or declined; record an externally evidenced transaction cancellation if the contract is released.",409);
    if (parsed.status!=="DECLINED"&&!evaluated.eligible) throw new DomainError(evaluated.mismatches.join("; "),409);
    if (parsed.status==="COMMITTED") {
      if (contract.committedBuyerId) throw new DomainError("This deal already has a committed buyer.",409);
      if (existing?.payload.status!=="INTERESTED") throw new DomainError("Record actual buyer interest before committing.",409);
      if (parsed.agreedPrice==null || !parsed.commitmentEvidenceUrl) throw new DomainError("Commitment needs exact price and a reviewed signed document reference.");
      wholeDollars(parsed.agreedPrice,"Buyer price"); evidenceUrl(parsed.commitmentEvidenceUrl);
      if (parsed.agreedPrice<contract.purchasePrice+contract.assignmentTarget) throw new DomainError("Buyer price cannot fall below the frozen acquisition plus target assignment.");
      Object.assign(contract,{committedBuyerId:buyerId,agreedBuyerPrice:parsed.agreedPrice,buyerCommittedAt:now.toISOString(),
        commitmentSnapshot:{recordedAt:now.toISOString(),buyer,detail,reservedCount:reservations.count,reservedFunds:reservations.funds}});
      await save(tx,row,contract,now);
      await move(tx,lead,"BUYER_COMMITTED","Owner recorded buyer commitment with reviewed external evidence","Record title, earnest money, assignment and funds evidence before settlement.",actor.id,now);
    } else if (parsed.status==="INTERESTED" && buyer.destinationKind==="BUYER" && !contract.committedBuyerId && ["UNDER_CONTRACT","BUYER_MATCHED"].includes(lead.stage)) {
      await move(tx,lead,"BUYER_INTERESTED","Actual buyer interest recorded", "Review buyer commitment evidence and obtain owner approval.",actor.id,now);
      // Version the transaction for every response, not only financial commitment.
      await save(tx,row,contract,now);
    } else await save(tx,row,contract,now);
    const payload = {...evaluated,status:parsed.status,evidence:parsed.evidence,
      agreedPrice:parsed.status==="COMMITTED"?parsed.agreedPrice:null,commitmentEvidenceUrl:parsed.commitmentEvidenceUrl??null};
    await tx.insert(matchesTable).values({leadId:id,buyerId,payload,updatedAt:now})
      .onConflictDoUpdate({target:[matchesTable.leadId,matchesTable.buyerId],set:{payload,updatedAt:now}});
    await saveLead(tx,lead,now);
    await audit(tx,actor.id,`BUYER_${parsed.status}`,id,`Buyer ${buyerId}; ${parsed.evidence}. Actual human-reported response, not a system-sent message.`);
  });
  return dealOperations(id,now);
}
export async function recordClosingMilestone(id: string,input: z.infer<typeof RecordClosingMilestoneBody>,actor: OfferActor,now = new Date()) {
  assertOperationsRole(actor,["OWNER"]);
  const parsed = RecordClosingMilestoneBody.parse(input); evidenceUrl(parsed.evidenceUrl);
  await db.transaction(async tx=>{
    const lead = await lockedLead(tx,id), {row,contract} = await lockedContract(tx,id,parsed.version);
    if (contract.status==="DRAFT") throw new DomainError("Record executed acquisition agreement first.",409);
    if (contract.milestones.some(m=>m.kind===parsed.kind)) throw new DomainError("This milestone is already recorded; evidence history is immutable.",409);
    if (["ASSIGNMENT_SIGNED","FUNDS_CONFIRMED"].includes(parsed.kind) && !contract.committedBuyerId) throw new DomainError("A qualified committed buyer is required before assignment or funds confirmation.",409);
    contract.milestones.push({kind:parsed.kind,evidenceUrl:parsed.evidenceUrl,note:parsed.note,recordedBy:actor.id,recordedAt:now.toISOString()});
    if (contract.committedBuyerId) {
      const [buyerRow] = await tx.select().from(buyersTable).where(eq(buyersTable.id,contract.committedBuyerId)).for("update");
      const detail = await leadDetail(id,tx,now);
      const reservations = buyerReservations((await tx.select().from(contractsTable)).map(contractRecord),contract.committedBuyerId,contract.id);
      const buyer = buyerRow?buyerRecord(buyerRow,now):null;
      if (buyer&&matchBuyer(buyer,detail,contract,now,contract.agreedBuyerPrice??undefined,reservations.count,reservations.funds).eligible) {
        contract.history = [...(contract.history??[]),{kind:"ELIGIBILITY_REVIEW",effectiveAt:now.toISOString(),recordedAt:now.toISOString(),recordedBy:actor.id,
          evidenceUrl:parsed.evidenceUrl,note:"Current criteria, funding, reservations and financial/source snapshot rechecked while recording this milestone; no new commitment or external action.",
          previousState:{eligibilitySnapshot:contract.commitmentSnapshot}}];
        contract.commitmentSnapshot = {recordedAt:now.toISOString(),buyer,detail,reservedCount:reservations.count,reservedFunds:reservations.funds};
      }
      contract.status = "CLOSING";
      await move(tx,lead,"CLOSING","Closing evidence recorded","Complete outstanding evidence and record actual settlement outcome.",actor.id,now);
    }
    await save(tx,row,contract,now); await saveLead(tx,lead,now);
    await audit(tx,actor.id,"CLOSING_MILESTONE_RECORDED",id,`${parsed.kind}: ${parsed.note}. External evidence reviewed by owner, not an automated escrow check.`);
  });
  return dealOperations(id,now);
}
export async function recordDealOutcome(id: string,input: z.infer<typeof RecordDealOutcomeBody>,actor: OfferActor,now = new Date()) {
  assertOperationsRole(actor,["OWNER"]);
  const parsed = RecordDealOutcomeBody.parse(input); evidenceUrl(parsed.evidenceUrl);
  const eventAt = parsed.occurredAt ? pastInstant(parsed.occurredAt,now,"Actual external outcome time") : now.getTime();
  const eventTime = new Date(eventAt);
  await db.transaction(async tx=>{
    const lead = await lockedLead(tx,id), {row,contract} = await lockedContract(tx,id,parsed.version);
    if (parsed.outcome==="CLOSED") {
      const currentDetail = await leadDetail(id,tx,now);
      const late = eventAt<now.getTime();
      const priorTimes = [contract.sellerSignedAt,contract.acquisitionSignedAt,contract.buyerCommittedAt].filter(Boolean).map(t=>Date.parse(t!));
      if (eventAt<Math.max(0,...priorTimes))
        throw new DomainError("Settlement cannot precede recorded signatures or buyer commitment.");
      const candidates = [contract.commitmentSnapshot,...(contract.history??[])
        .filter(h=>h.kind==="ELIGIBILITY_REVIEW").map(h=>h.previousState.eligibilitySnapshot as DealContract["commitmentSnapshot"])]
        .filter((s):s is NonNullable<DealContract["commitmentSnapshot"]>=>Boolean(s))
        .filter(s=>Date.parse(s.recordedAt??contract.buyerCommittedAt??"")<=eventAt)
        .sort((a,b)=>Date.parse(b.recordedAt??contract.buyerCommittedAt??"")-Date.parse(a.recordedAt??contract.buyerCommittedAt??""));
      const historical = candidates[0];
      if (late&&!historical) throw new DomainError("Late settlement needs a retained eligibility snapshot predating the event; historical eligibility cannot be invented.");
      const detail = late?historical!.detail:currentDetail;
      const [buyerRow] = contract.committedBuyerId?await tx.select().from(buyersTable).where(eq(buyersTable.id,contract.committedBuyerId)).for("update"):[];
      const [recorded] = contract.committedBuyerId?await tx.select().from(matchesTable).where(and(eq(matchesTable.leadId,id),eq(matchesTable.buyerId,contract.committedBuyerId))):[];
      const reservations = buyerReservations((await tx.select().from(contractsTable)).map(contractRecord),contract.committedBuyerId??"",contract.id);
      if (late) {
        const reviewedAt = new Date(historical!.recordedAt??contract.buyerCommittedAt!);
        const [latest] = await tx.select().from(analysesTable).where(and(eq(analysesTable.leadId,id),lte(analysesTable.createdAt,eventTime)))
          .orderBy(desc(analysesTable.createdAt),sql`(snapshot->'input'->>'version')::integer DESC`).limit(1);
        const [changedEvidence] = await tx.select({id:intelligenceTable.id}).from(intelligenceTable).where(and(
          eq(intelligenceTable.leadId,id),gt(intelligenceTable.createdAt,reviewedAt),lte(intelligenceTable.createdAt,eventTime),
          sql`${intelligenceTable.payload}->>'classification' <> 'AI_HYPOTHESIS'`)).limit(1);
        if (changedEvidence || (latest&&latest.id!==historical!.detail.analysisSnapshotId&&latest.createdAt>=reviewedAt) ||
          (buyerRow&&buyerRow.version!==historical!.buyer.version&&buyerRow.updatedAt<=eventTime))
          throw new DomainError("Source, financial or buyer evidence changed before this settlement without a retained eligibility recheck. An older snapshot cannot bypass those changes.",409);
      }
      const currentBuyer = late?historical!.buyer:buyerRow?buyerRecord(buyerRow,now):null;
      if (currentBuyer?.destinationKind!=="BUYER") throw new DomainError("Closing requires a current qualified acquisition buyer, not a deal-finder/guru destination.",409);
      const match = currentBuyer?{...matchBuyer(currentBuyer,detail,contract,eventTime,contract.agreedBuyerPrice??undefined,
        late?historical!.reservedCount:reservations.count,late?historical!.reservedFunds:reservations.funds),status:recorded?.payload.status as "COMMITTED"}:undefined;
      const blockers = closingBlockers(contract,match);
      if (blockers.length) throw new DomainError(blockers.join("; "),409);
      if (parsed.assignmentFeeReceived==null || parsed.closingCosts==null) throw new DomainError("Record actual received assignment fee and actual closing costs.");
      wholeDollars(parsed.assignmentFeeReceived,"Received fee"); wholeDollars(parsed.closingCosts,"Closing costs");
      const expectedFee = Math.round(((contract.agreedBuyerPrice??0)-contract.purchasePrice)*100)/100;
      if (parsed.assignmentFeeReceived!==expectedFee) throw new DomainError("Received assignment fee must reconcile to the frozen committed price minus acquisition price.");
      Object.assign(contract,{status:"CLOSED",assignmentFeeReceived:parsed.assignmentFeeReceived,closingCosts:parsed.closingCosts,
        netProceeds:Math.round((parsed.assignmentFeeReceived-parsed.closingCosts)*100)/100,closedAt:eventTime.toISOString()});
      await move(tx,lead,"CLOSED","Owner recorded evidenced settlement and reconciled proceeds","Preserve settlement evidence and review deal outcome.",actor.id,now);
    } else {
      if (contract.committedBuyerId) {
        if (contract.buyerCommittedAt&&eventAt<Date.parse(contract.buyerCommittedAt)) throw new DomainError("Cancellation cannot precede the committed buyer event.");
        if (!parsed.buyerReleaseEvidenceUrl) throw new DomainError("Cancellation with a committed buyer requires separately reviewed external buyer release evidence.");
        evidenceUrl(parsed.buyerReleaseEvidenceUrl);
      }
      contract.status = "CANCELLED"; contract.cancelledAt = eventTime.toISOString();
      if (contract.committedBuyerId) contract.history = [...(contract.history??[]),{kind:"RELEASE_BUYER",effectiveAt:eventTime.toISOString(),recordedAt:now.toISOString(),recordedBy:actor.id,
        evidenceUrl:parsed.buyerReleaseEvidenceUrl!,note:parsed.note,previousState:{committedBuyerId:contract.committedBuyerId,agreedBuyerPrice:contract.agreedBuyerPrice,milestones:contract.milestones}}];
      await move(tx,lead,"DEAD_DEAL","Owner attested externally documented cancellation", "Preserve cancellation and prior negotiation/commitment history.",actor.id,now);
    }
    contract.outcomeNote = parsed.note; contract.outcomeEvidenceUrl = parsed.evidenceUrl; contract.outcomeRecordedAt = now.toISOString();
    await save(tx,row,contract,now); await saveLead(tx,lead,now);
    await audit(tx,actor.id,`TRANSACTION_${parsed.outcome}`,id,`${parsed.note}. Documented external outcome; system did not transfer funds or void legal obligations.`);
  });
  return dealOperations(id,now);
}