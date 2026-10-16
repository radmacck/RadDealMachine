import type { LeadDetail } from "./types";
import type { DealContract } from "./buyers";

export type TransactionChecklistItem = {
  key:string; label:string; status:"COMPLETE"|"NEEDS_EVIDENCE"|"REVIEW_REQUIRED"|"NOT_APPLICABLE";
  evidence:string[]; nextAction:string; qualifiedReviewRequired:boolean;
};

export function buildTransactionReadinessChecklist(detail:LeadDetail,contract:DealContract,now:Date):TransactionChecklistItem[] {
  const fact=detail.intelligence.filter(item=>item.classification==="VERIFIED_FACTS"&&!!item.verificationNote?.trim());
  const ownerIdentity=fact.filter(item=>["seller_authority","authorized_signer","signing_authority"].includes(item.category.toLowerCase()));
  const partyIdentity=fact.filter(item=>["seller_identity","owner_identity","party_identity"].includes(item.category.toLowerCase()));
  const offer=detail.offers.find(item=>item.id===contract.offerId);
  const validOffer=!!offer&&["AUTHORIZED","COMMUNICATED"].includes(offer.effectiveStatus)&&
    offer.amount===contract.purchasePrice&&offer.earnestMoney===contract.earnestMoney&&offer.assignmentIntent===contract.assignmentAllowed&&
    offer.contingencies===contract.contingencies&&
    offer.analysisSnapshotId===detail.analysisSnapshotId;
  const schedule=contract.deadlineSchedule;
  const dueDates=schedule?.items.filter(item=>item.disposition==="DUE_DATE")??[];
  const closingDate=contract.closingAt.slice(0,10);
  const scheduleValid=!!schedule&&schedule.items.length===5&&schedule.termsHash.length===64&&schedule.sourceEvidenceUrl.length>=8&&
    dueDates.every(item=>{
      if(!item.dueDate||!item.timeZone||item.dueDate>closingDate||!Number.isFinite(Date.parse(`${item.dueDate}T12:00:00Z`)))return false;
      try { new Intl.DateTimeFormat("en-US",{timeZone:item.timeZone}).format(new Date(`${item.dueDate}T12:00:00Z`)); return true; }
      catch { return false; }
    });
  const emd=contract.milestones.find(item=>item.kind==="EARNEST_MONEY_CONFIRMED");
  const signed=!!contract.executedDocumentUrl&&!!contract.sellerSignedAt&&!!contract.acquisitionSignedAt;
  const currentDoc=contract.documents?.some(item=>item.sourceContractVersion===contract.version&&
    item.status!=="VOID"&&item.status!=="REJECTED");
  const assignmentEvidence=contract.milestones.find(item=>item.kind==="ASSIGNMENT_SIGNED");
  const item=(key:string,label:string,status:TransactionChecklistItem["status"],evidence:string[],nextAction:string,qualifiedReviewRequired=false):TransactionChecklistItem=>
    ({key,label,status,evidence,nextAction,qualifiedReviewRequired});
  return [
    item("party_identity","Party identity",detail.lead.sellerName&&partyIdentity.length?"COMPLETE":"NEEDS_EVIDENCE",
      [...partyIdentity.map(i=>i.id),...(detail.lead.sellerName?["seller name on lead"]:[])],"Record independently supported legal identity for every signing party."),
    item("authorized_signers","Authorized signers",ownerIdentity.length?"COMPLETE":"NEEDS_EVIDENCE",
      ownerIdentity.map(i=>i.id),"Verify authority for every seller signer; ownership evidence alone is not title clearance."),
    item("approved_terms","Approved terms",validOffer?"COMPLETE":"NEEDS_EVIDENCE",
      validOffer?[offer!.id,offer!.analysisSnapshotId]:[],"Reconcile the current contract against the exact owner-approved offer and underwriting snapshot."),
    item("disclosures","Applicable disclosures","REVIEW_REQUIRED",[],
      "Have a qualified reviewer confirm required disclosures for the property's jurisdiction and transaction structure.",true),
    item("contract_version","Contract version",currentDoc?"COMPLETE":"NEEDS_EVIDENCE",
      currentDoc?contract.documents!.filter(d=>d.sourceContractVersion===contract.version).map(d=>d.id):[],
      "Prepare or review a document against the current contract version; stale documents do not count."),
    item("signatures","Signature status",signed?"COMPLETE":"NEEDS_EVIDENCE",
      signed?[contract.executedDocumentUrl!,contract.sellerSignedAt!,contract.acquisitionSignedAt!]:[],
      "Record actual signature evidence for both parties; prepared documents and clicks are not signatures."),
    item("title_contact","Title / closing contact","NEEDS_EVIDENCE",[],
      "Record a verified title or escrow contact and confirm who holds earnest money."),
    item("contingencies","Contingencies","NEEDS_EVIDENCE",
      contract.contingencies.trim()?[contract.offerId]:[],"Reconcile each contingency with the approved terms and evidenced resolution or deadline."),
    item("earnest_money","Earnest money",contract.earnestMoney===0?"NOT_APPLICABLE":emd&&emd.amount===contract.earnestMoney&&!!emd.evidenceUrl&&!!emd.evidenceKind&&!!emd.counterpartyName&&!!emd.effectiveAt?"COMPLETE":"NEEDS_EVIDENCE",
      emd?[contract.id,emd.evidenceUrl]:[],"Confirm the exact required amount against escrow receipt or other permitted evidence."),
    item("transaction_structure","Assignment / transaction structure",!contract.assignmentAllowed?"COMPLETE":assignmentEvidence?"COMPLETE":"NEEDS_EVIDENCE",
      !contract.assignmentAllowed?[offer?.id??contract.offerId]:assignmentEvidence?[contract.id,assignmentEvidence.evidenceUrl]:[],
      contract.assignmentAllowed?"Verify assignment authority, required buyer terms and the applicable approved form with qualified review.":"No assignment is authorized in the locked terms.",contract.assignmentAllowed),
    item("deadlines","Deadlines",scheduleValid?"COMPLETE":"NEEDS_EVIDENCE",
      scheduleValid?[schedule!.sourceEvidenceUrl,schedule!.termsHash,...dueDates.map(d=>`${d.kind}:${d.dueDate}:${d.timeZone}`)]:[],
      "Record and review timezone-aware dates from executed terms or explicit reviewed operator inputs."),
    item("audit_history","Audit history",contract.history?.some(event=>!!event.evidenceUrl&&!!event.note&&!!event.effectiveAt)?"COMPLETE":"NEEDS_EVIDENCE",
      contract.history?.filter(event=>!!event.evidenceUrl&&!!event.note&&!!event.effectiveAt).map(event=>event.evidenceUrl)??[],
      "Preserve each contract change with actor, effective time, recorded time, reason and source evidence."),
  ];
}
