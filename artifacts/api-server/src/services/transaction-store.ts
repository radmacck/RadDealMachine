import { eq, and, lte, gt, desc, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import {
  db, contractsTable, leadsTable, buyersTable, matchesTable, offersTable, analysesTable,
  intelligenceTable, distributionPacketsTable, distributionRecipientsTable,
} from "@workspace/db";
import type { z } from "zod";
import {
  CreateContractBody, PreparePurchaseReviewDocumentBody, RecordDestinationActivityBody as DestinationActivityBody, ExecuteContractBody, RecordBuyerResponseBody, RecordClosingMilestoneBody, RecordDealOutcomeBody,
  type DestinationActivityEvent,
} from "@workspace/api-zod";
import {
  assertOperationsRole, buyerReservations, evidenceUrl, pastInstant, wholeDollars, closingBlockers, matchBuyer, DomainError, DAY,
  type OfferActor, type DealContract, type LeadDetail,
  evidenceReviewedAnalysis, type Analysis, type Lead, type UnderwritingInput, type Intelligence,
} from "@workspace/deal-domain";
import { lockedLead, leadDetail, move, audit } from "./deal-store";
import { contractRecord, buyerRecord, queueJob, type Tx } from "./operations-records";
import { dealOperations, refreshMatches } from "./matching-store";
import { buildPurchaseReviewPdf, purchaseReviewSnapshotHash, type PurchaseReviewSnapshot } from "./transaction-documents";

export async function lockedContract(tx: Tx, id: string, version: number) {
  const [row] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId,id)).for("update");
  if (!row) throw new DomainError("Prepare the contract first.",409);
  if (row.version!==version) throw new DomainError("Transaction changed. Reload before saving.",409);
  const contract = contractRecord(row);
  if (["CLOSED","CANCELLED"].includes(contract.status)) throw new DomainError("This transaction is terminal; its history is read-only.",409);
  return {row,contract};
}
export async function save(tx: Tx,row: typeof contractsTable.$inferSelect, contract: DealContract, now: Date) {
  const {id:_,leadId:__,version:___,createdAt:____,documents:_____,...payload} = contract;
  await tx.update(contractsTable).set({
    payload:{...payload,documentArtifacts:Array.isArray(row.payload.documentArtifacts)?row.payload.documentArtifacts:[]},
    version:row.version+1,updatedAt:now,
  }).where(eq(contractsTable.id,row.id));
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
      destinationActivityHistory:Array.isArray(exists?.payload.destinationActivityHistory)?exists.payload.destinationActivityHistory:[],
      documentArtifacts:Array.isArray(exists?.payload.documentArtifacts)?exists.payload.documentArtifacts:[],
    };
    if (exists) {
      const responses = await tx.select().from(matchesTable).where(eq(matchesTable.leadId,id));
      const {history:_,documentArtifacts:_____,...previousState} = exists.payload;
      payload.history = [...(Array.isArray(exists.payload.history)?exists.payload.history:[]),{
        kind:"CANCELLED_ATTEMPT",recordedAt:now.toISOString(),effectiveAt:now.toISOString(),recordedBy:actor.id,
        evidenceUrl:String(exists.payload.outcomeEvidenceUrl??(Array.isArray(exists.payload.history)?exists.payload.history.at(-1)?.evidenceUrl:"")),
        note:"New exact approved terms begin a distinct attempt; prior cancelled agreement and buyer responses retained. For an unexecuted abandoned draft, the link records owner-reviewed restart rather than claiming a signed cancellation.",
        previousState:{...previousState,buyerResponses:responses.map(r=>({buyerId:r.buyerId,...r.payload}))},
      }];
      await tx.update(contractsTable).set({payload,version:exists.version+1,updatedAt:now}).where(eq(contractsTable.id,exists.id));
      // Clear only derived CURRENT response state; originals remain in the cancelled-attempt history.
      for (const r of responses) {
        const legacy = r.payload.destinationKind!=="BUYER" && ["INTERESTED","COMMITTED","DECLINED"].includes(String(r.payload.status))
          ? r.payload.legacyDestinationResponse??{status:r.payload.status,evidence:typeof r.payload.evidence==="string"?r.payload.evidence:null}
          : r.payload.legacyDestinationResponse;
        await tx.update(matchesTable).set({payload:{...r.payload,status:"MATCHED",agreedPrice:null,
          commitmentEvidenceUrl:null,evidence:null,eligible:false,mismatches:["New attempt is not externally executed yet."],
          ...(legacy?{legacyDestinationResponse:legacy}:{})},updatedAt:now}).where(eq(matchesTable.id,r.id));
      }
    } else await tx.insert(contractsTable).values({leadId:id,payload});
    await move(tx,lead,"CONTRACT_PENDING","Prepared frozen terms from the exact communicated proposal","Review external contract against frozen terms, then record both signatures.",actor.id,now);
    await saveLead(tx,lead,now);
    await audit(tx,actor.id,"CONTRACT_PREPARED",id,`Exact approved purchase $${offer.amount}; no document signed or generated by the system.`);
  });
  return dealOperations(id,now);
}

function purchaseReviewSnapshot(lead: Lead,contract: DealContract,offer: LeadDetail["offers"][number]): PurchaseReviewSnapshot {
  return {
    leadId:lead.id,contractId:contract.id,offerId:offer.id,analysisSnapshotId:offer.analysisSnapshotId,
    attemptNumber:contract.attemptNumber??1,propertyAddress:lead.address,sellerReportedName:lead.sellerName??null,
    purchasePrice:contract.purchasePrice,earnestMoney:contract.earnestMoney,closingAt:contract.closingAt,
    contingencies:contract.contingencies,assignmentAllowed:contract.assignmentAllowed,
  };
}

function storedDocumentArtifacts(row: typeof contractsTable.$inferSelect): Array<Record<string,unknown>> {
  return Array.isArray(row.payload.documentArtifacts)
    ? row.payload.documentArtifacts.filter((item):item is Record<string,unknown> => !!item&&typeof item==="object"&&!Array.isArray(item))
    : [];
}

export async function preparePurchaseReviewDocument(
  id: string,input: z.infer<typeof PreparePurchaseReviewDocumentBody>,actor: OfferActor,now = new Date(),
) {
  assertOperationsRole(actor,["OWNER","OPERATOR"]);
  const parsed = PreparePurchaseReviewDocumentBody.parse(input);
  await db.transaction(async tx=>{
    await lockedLead(tx,id);
    const {row,contract} = await lockedContract(tx,id,parsed.version);
    if (contract.status!=="DRAFT") throw new DomainError("Prepare this purchase review copy before recording external signatures.",409);
    const detail = await leadDetail(id,tx,now);
    const offer = detail.offers.find(item=>item.id===contract.offerId&&item.effectiveStatus==="COMMUNICATED");
    if (!offer||!detail.analysis) throw new DomainError("A current, communicated owner-authorized offer is required to prepare transaction terms.",409);
    if (offer.amount!==contract.purchasePrice||offer.earnestMoney!==contract.earnestMoney||
      offer.contingencies!==contract.contingencies||offer.assignmentIntent!==contract.assignmentAllowed)
      throw new DomainError("Transaction terms no longer match the exact communicated offer. Reconcile the amendment before preparing a PDF.",409);
    const snapshot = purchaseReviewSnapshot(detail.lead,contract,offer);
    const snapshotHash = purchaseReviewSnapshotHash(snapshot);
    const previous = storedDocumentArtifacts(row);
    if (previous.some(item=>item.kind==="PURCHASE_TERMS_REVIEW"&&item.snapshotHash===snapshotHash&&typeof item.pdfBase64==="string")) return;

    const bytes = await buildPurchaseReviewPdf(snapshot,snapshotHash);
    const idForDocument = randomUUID();
    const fileName = `purchase-terms-review-${contract.attemptNumber??1}-${idForDocument.slice(0,8)}.pdf`;
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const artifact = {
      id:idForDocument,kind:"PURCHASE_TERMS_REVIEW",status:"PREPARED_FOR_REVIEW",
      attemptNumber:contract.attemptNumber??1,sourceContractVersion:row.version,sourceOfferId:offer.id,
      snapshotHash,contentHash,fileName,contentType:"application/pdf",sizeBytes:bytes.byteLength,
      generatedAt:now.toISOString(),generatedBy:actor.id,
      downloadUrl:`/api/deals/${id}/contract/documents/${idForDocument}/file`,
      pdfBase64:Buffer.from(bytes).toString("base64"),
    };
    await tx.update(contractsTable).set({
      payload:{...row.payload,documentArtifacts:[...previous,artifact]},
      version:row.version+1,updatedAt:now,
    }).where(eq(contractsTable.id,row.id));
    await audit(tx,actor.id,"TRANSACTION_REVIEW_PDF_PREPARED",id,
      `Prepared ${idForDocument} from communicated offer ${offer.id}; terms snapshot ${snapshotHash}, PDF content ${contentHash}. Review copy only; no legal agreement or signature was created.`);
  });
  return dealOperations(id,now);
}

export async function downloadPurchaseReviewDocument(
  id: string,documentId: string,actor: OfferActor,now = new Date(),
): Promise<{fileName:string;bytes:Buffer}> {
  assertOperationsRole(actor,["OWNER","OPERATOR"]);
  return db.transaction(async tx=>{
    const [row] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId,id));
    if (!row) throw new DomainError("Transaction not found.",404);
    const contract = contractRecord(row);
    const detail = await leadDetail(id,tx,now);
    const artifact = storedDocumentArtifacts(row).find(item=>item.id===documentId);
    if (!artifact||artifact.kind!=="PURCHASE_TERMS_REVIEW"||typeof artifact.pdfBase64!=="string")
      throw new DomainError("Transaction review document not found.",404);
    const offer = detail.offers.find(item=>item.id===String(artifact.sourceOfferId));
    if (!offer) throw new DomainError("The source authorized offer is missing; document cannot be validated.",409);
    if (contract.status==="DRAFT"&&offer.effectiveStatus!=="COMMUNICATED")
      throw new DomainError("The source offer is stale or revoked. Prepare a new review copy only after current terms are authorized.",409);
    if (offer.amount!==contract.purchasePrice||offer.earnestMoney!==contract.earnestMoney||
      offer.contingencies!==contract.contingencies||offer.assignmentIntent!==contract.assignmentAllowed)
      throw new DomainError("The source offer no longer matches the transaction terms. This review PDF is stale.",409);
    const snapshot = purchaseReviewSnapshot(detail.lead,contract,offer);
    if (purchaseReviewSnapshotHash(snapshot)!==artifact.snapshotHash)
      throw new DomainError("This review PDF no longer matches the current transaction terms. Prepare a new copy.",409);
    const bytes = Buffer.from(artifact.pdfBase64,"base64");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    if (contentHash!==artifact.contentHash||bytes.byteLength!==Number(artifact.sizeBytes))
      throw new DomainError("Stored transaction PDF failed its integrity check.",409);
    return {fileName:String(artifact.fileName),bytes};
  },{isolationLevel:"repeatable read",accessMode:"read only"});
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
    let currentPacket: typeof distributionPacketsTable.$inferSelect | undefined;
    if (contract.status==="DRAFT") throw new DomainError("Record the externally signed acquisition contract before buyer responses.",409);
    const [buyerRow] = await tx.select().from(buyersTable).where(eq(buyersTable.id,buyerId)).for("update");
    if (!buyerRow) throw new DomainError("Buyer not found.",404);
    if ((buyerRow.payload.destinationKind??"BUYER")!=="BUYER")
      throw new DomainError("Deal-finder/guru activity must use the separate destination history; it cannot change buyer interest, commitment, or closing.",409);
    if (buyerRow.version!==parsed.buyerVersion) throw new DomainError("Buyer criteria or evidence changed. Review the current match.",409);
    const buyer = buyerRecord(buyerRow,now), detail = await leadDetail(id,tx,now);
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
      const [packet] = await tx.select().from(distributionPacketsTable).where(and(
        eq(distributionPacketsTable.leadId,id),
        eq(distributionPacketsTable.attemptNumber,contract.attemptNumber??1),
      )).for("update");
      currentPacket=packet;
      if (packet && ["ACTIVE","FIRST_ACCEPTED"].includes(packet.status) && packet.expiresAt.getTime()<=now.getTime()) {
        throw new DomainError("The authorized buyer packet expired; renew it and refresh buyer eligibility before recording commitment.",409);
      }
      if (packet?.status==="FIRST_ACCEPTED" && packet.acceptedBuyerId!==buyerId) {
        throw new DomainError("A different qualified buyer accepted the current package first. Resolve or release that soft acceptance before committing another buyer.",409);
      }
      Object.assign(contract,{committedBuyerId:buyerId,agreedBuyerPrice:parsed.agreedPrice,buyerCommittedAt:now.toISOString(),
        commitmentSnapshot:{recordedAt:now.toISOString(),buyer,detail,reservedCount:reservations.count,reservedFunds:reservations.funds}});
      await save(tx,row,contract,now);
      await move(tx,lead,"BUYER_COMMITTED","Owner recorded buyer commitment with reviewed external evidence","Record title, earnest money, assignment and funds evidence before settlement.",actor.id,now);
      if (currentPacket && ["ACTIVE","FIRST_ACCEPTED"].includes(currentPacket.status)) {
        await tx.update(distributionPacketsTable).set({status:"CLOSED",version:currentPacket.version+1,updatedAt:now})
          .where(eq(distributionPacketsTable.id,currentPacket.id));
        const recipients=await tx.select().from(distributionRecipientsTable)
          .where(eq(distributionRecipientsTable.packetId,currentPacket.id)).for("update");
        for (const recipient of recipients) {
          const winner=recipient.buyerId===buyerId;
          await tx.update(distributionRecipientsTable).set({
            status:winner?"COMMITTED":"EXPIRED",
            payload:{
              ...recipient.payload,
              resolution:{kind:winner?"COMMITTED":"EXPIRED",at:now.toISOString(),committedBuyerId:buyerId,
                commitmentEvidenceUrl:winner?parsed.commitmentEvidenceUrl:null},
            },
            updatedAt:now,
          }).where(eq(distributionRecipientsTable.id,recipient.id));
        }
        const competingMatches=await tx.select().from(matchesTable).where(eq(matchesTable.leadId,id)).for("update");
        for (const match of competingMatches) {
          if (match.buyerId===buyerId || (match.payload.destinationKind??"BUYER")!=="BUYER" ||
            !["MATCHED","INTERESTED"].includes(String(match.payload.status))) continue;
          await tx.update(matchesTable).set({payload:{
            ...match.payload,status:"EXPIRED",eligible:false,
            mismatches:[...(Array.isArray(match.payload.mismatches)?match.payload.mismatches as string[]:[]),
              "The first qualified buyer completed commitment review; this opportunity is closed."],
          },updatedAt:now}).where(eq(matchesTable.id,match.id));
        }
      }
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

export async function recordDestinationActivity(id: string,buyerId: string,input: unknown,actor: OfferActor,now = new Date()) {
  assertOperationsRole(actor,["OWNER","ANALYST","OPERATOR"]);
  const parsed = DestinationActivityBody.parse(input);
  const ownerOnly = ["TERMS_REVIEWED","TERMS_ACCEPTED","FEE_RECEIVED","FEE_DISPUTED","FEE_WAIVED"].includes(parsed.kind);
  if (ownerOnly) assertOperationsRole(actor,["OWNER"]);
  const eventAt = pastInstant(parsed.occurredAt,now,"Actual destination event time");
  const occurredAt = new Date(eventAt).toISOString();
  const evidence = evidenceUrl(parsed.evidenceUrl);
  const termEvent = parsed.kind==="TERMS_REVIEWED"||parsed.kind==="TERMS_ACCEPTED";
  const feeEvent = ["FEE_RECEIVED","FEE_DISPUTED","FEE_WAIVED"].includes(parsed.kind);
  if (termEvent&&!parsed.exactTerms) throw new DomainError("Terms review and acceptance must record the exact evidenced terms.");
  if (!termEvent&&parsed.exactTerms) throw new DomainError("Exact commercial terms belong on a terms-review or terms-acceptance event.");
  if (feeEvent&&(parsed.feeAmount==null||!parsed.currency)) throw new DomainError("Fee outcomes need the exact evidenced amount and currency; no quoted fee is assumed.");
  if (!feeEvent&&(parsed.feeAmount!=null||parsed.currency)) throw new DomainError("Fee amount and currency belong on a fee outcome.");

  await db.transaction(async tx=>{
    const [lead] = await tx.select({id:leadsTable.id}).from(leadsTable).where(eq(leadsTable.id,id)).for("update");
    if (!lead) throw new DomainError("Deal not found.",404);
    const [row] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId,id)).for("update");
    if (!row) throw new DomainError("Prepare the acquisition contract before recording destination activity.",409);
    const contract = contractRecord(row);
    const history = contract.destinationActivityHistory??[];
    const existingKey = history.find(event=>event.eventKey===parsed.eventKey);
    const command = {
      eventKey:parsed.eventKey,destinationId:buyerId,kind:parsed.kind,occurredAt,evidenceUrl:evidence,note:parsed.note,
      exactTerms:parsed.exactTerms??null,feeAmount:parsed.feeAmount??null,currency:parsed.currency??null,relatedEventKey:parsed.relatedEventKey??null,
      recordedBy:actor.id,
    };
    if (existingKey) {
      const prior = {
        eventKey:existingKey.eventKey,destinationId:existingKey.destinationId,kind:existingKey.kind,occurredAt:existingKey.occurredAt,
        evidenceUrl:existingKey.evidenceUrl,note:existingKey.note,exactTerms:existingKey.exactTerms??null,
        feeAmount:existingKey.feeAmount??null,currency:existingKey.currency??null,relatedEventKey:existingKey.relatedEventKey??null,
        recordedBy:existingKey.recordedBy,
      };
      if (!isDeepStrictEqual(prior,command)) throw new DomainError("Event key already belongs to a different destination activity.",409);
      return;
    }
    if (row.version!==parsed.version) throw new DomainError("Transaction changed. Reload before recording destination activity.",409);
    if (contract.status==="DRAFT") throw new DomainError("Record the externally executed acquisition contract before destination activity.",409);
    const terminalAt=contract.status==="CLOSED"?contract.closedAt:contract.status==="CANCELLED"?contract.cancelledAt:null;
    if (terminalAt&&!feeEvent&&eventAt>Date.parse(terminalAt))
      throw new DomainError("Submission, reply, and terms events recorded after a terminal deal must have actually occurred before closing/cancellation; fee outcomes may be recorded later.",409);
    const [buyerRow] = await tx.select().from(buyersTable).where(eq(buyersTable.id,buyerId)).for("update");
    if (!buyerRow) throw new DomainError("Destination not found.",404);
    if (buyerRow.version!==parsed.buyerVersion) throw new DomainError("Destination profile changed. Reload before recording activity.",409);
    const destination = buyerRecord(buyerRow,now);
    if (destination.destinationKind==="BUYER") throw new DomainError("This history is only for deal-finder/guru destinations; acquisition buyers use buyer-response records.",409);
    const requireRelated = (kinds: DestinationActivityEvent["kind"][]) => {
      if (!parsed.relatedEventKey) throw new DomainError("Link this event to its prior destination activity.");
      const linked = history.find(event=>event.eventKey===parsed.relatedEventKey);
      if (!linked||linked.destinationId!==buyerId||!kinds.includes(linked.kind))
        throw new DomainError("The linked event must be a prior event of the same destination and the required type.",409);
      if (Date.parse(linked.occurredAt)>eventAt) throw new DomainError("A destination event cannot precede the event it references.",409);
      return linked;
    };
    if (parsed.kind==="ACKNOWLEDGED"||parsed.kind==="DECLINED") requireRelated(["SUBMITTED"]);
    if (parsed.kind==="TERMS_REVIEWED") requireRelated(["SUBMITTED","ACKNOWLEDGED"]);
    if (parsed.kind==="TERMS_ACCEPTED") {
      const reviewed = requireRelated(["TERMS_REVIEWED"]);
      if (reviewed.exactTerms!==parsed.exactTerms) throw new DomainError("Accepted terms must exactly match the linked owner-reviewed terms.",409);
    }
    if (parsed.kind==="FEE_RECEIVED") requireRelated(["TERMS_ACCEPTED"]);
    if (parsed.kind==="FEE_DISPUTED") requireRelated(["TERMS_ACCEPTED","FEE_RECEIVED"]);
    if (parsed.kind==="FEE_WAIVED") requireRelated(["TERMS_ACCEPTED","FEE_RECEIVED","FEE_DISPUTED"]);
    const event: DestinationActivityEvent = {
      ...command,destinationName:destination.name,destinationKind:destination.destinationKind,
      recordedAt:now.toISOString(),
    };
    contract.destinationActivityHistory=[...history,event];
    await save(tx,row,contract,now);
    await audit(tx,actor.id,`DESTINATION_${parsed.kind}`,id,
      `${destination.destinationKind} ${destination.name}; actual event ${occurredAt}; recorded ${now.toISOString()}; evidence ${evidence}. Referral activity only; no buyer commitment, fee receipt default, or closing state changed.`);
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
        const replyAt = Date.parse(String(buyerRow?.payload.lastOutreachReplyAt??""));
        if (Number.isFinite(replyAt)&&replyAt<=eventAt&&replyAt>Date.parse(historical!.buyer.buyingEvidenceAt??"1970-01-01"))
          throw new DomainError("An actual buyer reply predating settlement lacks a retained current-buying review. Late recording cannot hide earlier response evidence.",409);
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