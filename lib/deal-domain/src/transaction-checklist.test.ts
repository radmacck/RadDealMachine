import test from "node:test";
import assert from "node:assert/strict";
import { buildTransactionReadinessChecklist } from "./transaction-checklist";
import type { LeadDetail } from "./types";
import type { DealContract } from "./buyers";

const now=new Date("2026-10-16T12:00:00Z");
const detail=(overrides:Record<string,unknown>={})=>({
  lead:{sellerName:"Seller"},intelligence:[],analysisSnapshotId:"analysis-1",offers:[],...overrides,
} as unknown as LeadDetail);
const contract=(overrides:Record<string,unknown>={})=>({
  id:"contract-1",leadId:"lead-1",offerId:"offer-1",version:2,status:"DRAFT",purchasePrice:100000,
  assignmentTarget:5000,earnestMoney:1000,assignmentAllowed:true,closingAt:"2026-11-15T12:00:00Z",
  contingencies:"Inspection and title review",milestones:[],documents:[],deadlineSchedule:null,...overrides,
} as unknown as DealContract);
const item=(detailValue:LeadDetail,contractValue:DealContract,key:string)=>buildTransactionReadinessChecklist(detailValue,contractValue,now).find(row=>row.key===key)!;
const validOffer={id:"offer-1",analysisSnapshotId:"analysis-1",effectiveStatus:"COMMUNICATED",amount:100000,earnestMoney:1000,assignmentIntent:true,contingencies:"Inspection and title review"};

test("missing party, signer, title, signature and deadline evidence stays visibly incomplete",()=>{
  const list=buildTransactionReadinessChecklist(detail(),contract(),now);
  assert.equal(list.find(i=>i.key==="party_identity")?.status,"NEEDS_EVIDENCE");
  assert.equal(list.find(i=>i.key==="authorized_signers")?.status,"NEEDS_EVIDENCE");
  assert.equal(list.find(i=>i.key==="title_contact")?.status,"NEEDS_EVIDENCE");
  assert.equal(list.find(i=>i.key==="signatures")?.status,"NEEDS_EVIDENCE");
  assert.equal(list.find(i=>i.key==="deadlines")?.status,"NEEDS_EVIDENCE");
  assert.equal(list.find(i=>i.key==="audit_history")?.status,"NEEDS_EVIDENCE");
  assert.equal(list.find(i=>i.key==="disclosures")?.status,"REVIEW_REQUIRED");
  assert.ok(list.find(i=>i.key==="disclosures")?.qualifiedReviewRequired);
});

test("changed offer terms and stale document versions cannot complete the checklist",()=>{
  const d=detail({offers:[{...validOffer,amount:99000}]});
  const c=contract({documents:[{id:"doc-old",sourceContractVersion:1,status:"PREPARED_FOR_REVIEW"}]});
  assert.equal(item(d,c,"approved_terms").status,"NEEDS_EVIDENCE");
  assert.equal(item(d,c,"contract_version").status,"NEEDS_EVIDENCE");
});

test("signature evidence, exact approved economics and timezone-aware recorded due dates drive completion",()=>{
  const d=detail({offers:[validOffer]});
  const due=["TITLE_CLEARED","INSPECTION_COMPLETED","EARNEST_MONEY_CONFIRMED","ASSIGNMENT_SIGNED","FUNDS_CONFIRMED"].map(kind=>({
    kind,disposition:"DUE_DATE",dueDate:"2026-11-02",timeZone:"America/New_York",basisNote:"Recorded from reviewed signed terms.",
  }));
  const c=contract({
    executedDocumentUrl:"https://example.test/executed.pdf",sellerSignedAt:"2026-10-14T12:00:00Z",acquisitionSignedAt:"2026-10-15T12:00:00Z",
    deadlineSchedule:{termsHash:"a".repeat(64),sourceEvidenceUrl:"https://example.test/terms",items:due},
  });
  assert.equal(item(d,c,"approved_terms").status,"COMPLETE");
  assert.equal(item(d,c,"signatures").status,"COMPLETE");
  assert.equal(item(d,c,"deadlines").status,"COMPLETE");
  const lateDue=due.map(i=>({...i,dueDate:"2026-11-30"}));
  assert.equal(item(d,contract({deadlineSchedule:{termsHash:"a".repeat(64),sourceEvidenceUrl:"https://example.test/terms",items:lateDue}}),"deadlines").status,"NEEDS_EVIDENCE");
  const withHistory=contract({history:[{effectiveAt:"2026-10-15T12:00:00Z",recordedAt:"2026-10-15T12:01:00Z",evidenceUrl:"https://example.test/amendment",note:"Synthetic reviewed amendment"}]});
  assert.equal(item(d,withHistory,"audit_history").status,"COMPLETE");
  assert.equal(item(d,contract({deadlineSchedule:{termsHash:"a".repeat(64),sourceEvidenceUrl:"https://example.test/terms",items:due.map(i=>({...i,timeZone:"Invalid/Zone"}))}}),"deadlines").status,"NEEDS_EVIDENCE");
  assert.equal(item(d,c,"transaction_structure").status,"NEEDS_EVIDENCE");
  assert.equal(item(d,contract({...c,assignmentAllowed:false}),"transaction_structure").status,"COMPLETE");
});
