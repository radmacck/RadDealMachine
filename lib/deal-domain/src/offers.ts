import {
  CreateOfferDraftBody, AuthorizeOfferBody, CommunicateOfferBody, WithdrawOfferBody,
} from "@workspace/api-zod";
import {
  DomainError, type Lead, type Analysis, type Assumptions, type Intelligence,
  type Offer, type StoredOffer, type OfferDraftInput, type OfferApprovalInput,
  type OfferCommunicationInput, type OfferWithdrawalInput,
} from "./types";
import { callReadyBlockers } from "./workflow";

export const ANALYSIS_LIFETIME_MS = 7 * 86_400_000;
export const OFFER_STAGES = ["CONVERSATION","OFFER_READY","OFFER_SENT","NEGOTIATING","CONTRACT_PENDING"];
export interface OfferContext {
  lead: Lead;
  analysis: Analysis | null;
  analysisSnapshotId: string | null;
  currentPolicy: Assumptions;
  intelligence: Intelligence[];
  conversationLogged: boolean;
  now: Date;
}
export interface OfferActor { id: string; role: string }
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
      .map(([key,item])=>`${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
export type OfferReviewTerms = Pick<OfferDraftInput,"amount"|"earnestMoney"|"closingDays"|"contingencies"|"assignmentIntent"|"draftExpiresAt"|"reason"|"parentOfferId"|"sellerResponseSource"|"sellerResponseEventKey"|"sellerResponseEvidence">;
export function offerReviewSnapshotJson(terms: OfferReviewTerms, ctx: OfferContext): string {
  const a = ctx.analysis!;
  const assumptions = a.assumptions;
  const evidence = ctx.intelligence.filter(i => i.classification === "VERIFIED_FACTS")
    .map(i => ({id:i.id,category:i.category,statement:i.statement,sourceType:i.sourceType,source:i.source,capturedAt:i.capturedAt,verificationNote:i.verificationNote}))
    .sort((x,y) => x.id.localeCompare(y.id));
  return canonicalJson({
    version:1, analysisSnapshotId:ctx.analysisSnapshotId, calculatedAt:a.calculatedAt,
     subject:{sellerName:ctx.lead.sellerName,address:ctx.lead.address,city:ctx.lead.city,state:ctx.lead.state,propertyType:ctx.lead.propertyType,sqft:ctx.lead.sqft,askingPrice:ctx.lead.askingPrice},
    purchasePrice:terms.amount,reason:terms.reason,terms:{earnestMoney:terms.earnestMoney,closingDays:terms.closingDays,contingencies:terms.contingencies},
    assignment:{intended:terms.assignmentIntent,strategy:terms.assignmentIntent?"Potential contractual assignment only after local-law and contract review":"No assignment intended",legalStatus:"NOT_ASSESSED"},
    draftExpiresAt:terms.draftExpiresAt,
     negotiationLineage:terms.parentOfferId?{parentOfferId:terms.parentOfferId,responseSource:terms.sellerResponseSource,
       ...(terms.sellerResponseEventKey?{responseEventKey:terms.sellerResponseEventKey}:{}),
       responseEvidence:terms.sellerResponseEvidence}:null,
    underwriting:{engineVersion:a.engineVersion,classification:a.classification,arv:a.arv,repairs:a.repairs,mao:a.mao,openingLow:a.openingLow,openingHigh:a.openingHigh,formula:a.formula,compDecisions:a.compDecisions},
    costs:{sellingCostLow:a.arv.low*assumptions.sellingCostPct,sellingCostExpected:a.arv.expected*assumptions.sellingCostPct,
      repairsExpected:a.repairs.expected,repairContingency:a.repairs.high*assumptions.contingencyPct,
      acquisitionCost:assumptions.acquisitionCost,holdingCost:assumptions.holdingMonthly*assumptions.holdingMonths,
      assignmentTarget:terms.assignmentIntent?assumptions.assignmentTarget:0},
    assumptions,risks:a.risks,verifiedEvidence:evidence,
    compEvidenceIds:a.compDecisions.filter(c=>c.included).map(c=>c.id).sort(),
    sellerReports:ctx.intelligence.filter(i=>i.classification==="INDICATED"&&i.category.startsWith("seller_call_")).map(i=>({id:i.id,category:i.category,statement:i.statement,sourceRecordId:i.sourceRecordId})).sort((x,y)=>x.id.localeCompare(y.id)),
  });
}
export function assertOfferPermission(action: "DRAFT"|"AUTHORIZE"|"COMMUNICATE"|"WITHDRAW", role: string, offer?: StoredOffer): void {
  const allowed = action === "DRAFT" ? ["OWNER","ANALYST"]
    : action === "COMMUNICATE" ? ["OWNER","OPERATOR"]
    : action === "WITHDRAW" && offer?.status === "DRAFT" ? ["OWNER","ANALYST"] : ["OWNER"];
  if (!allowed.includes(role)) throw new DomainError(`Your role cannot ${action.toLowerCase()} this offer.`,403);
}
const samePolicy = (a: Assumptions,b: Assumptions) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const cents = (n: number) => Number.isFinite(n) && Math.round(n*100)/100 === n;
function future(value: string, now: Date, label: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time <= now.getTime()) throw new DomainError(`${label} must be a valid future timestamp.`);
  return time;
}
export function offerResearchBlockers(ctx: OfferContext): string[] {
  const blockers = callReadyBlockers(ctx.lead,ctx.analysis,ctx.now);
  if (!ctx.analysisSnapshotId) blockers.push("Refresh underwriting to create an identifiable immutable analysis snapshot.");
  if (!OFFER_STAGES.includes(ctx.lead.stage)) blockers.push("Offers require an active seller conversation.");
  if (!ctx.conversationLogged) blockers.push("Log a connected seller conversation before creating or authorizing an offer.");
  if (ctx.analysis && !samePolicy(ctx.analysis.assumptions,ctx.currentPolicy)) blockers.push("Underwriting uses an older workspace policy; refresh it before authorizing an offer.");
  if (ctx.analysis && ctx.analysis.mao <= 0) blockers.push("The current conservative acquisition ceiling is not positive.");
  return [...new Set(blockers)];
}
export function authorityEvidence(ctx: OfferContext, id: string): Intelligence | undefined {
  const entry = ctx.intelligence.find(i => i.id === id);
  if (!entry || entry.classification !== "VERIFIED_FACTS" || entry.sourceType !== "PUBLIC_RECORD"
    || !["ownership","owner_authority","seller_authority"].includes(entry.category.trim().toLowerCase())
    || !entry.verificationNote?.trim()) return undefined;
  const age = ctx.now.getTime()-Date.parse(entry.capturedAt);
  if (!Number.isFinite(age) || age < 0 || age > 30*86_400_000) return undefined;
  return entry;
}
export function evaluateOffer(offer: StoredOffer, ctx: OfferContext): Offer {
  let effectiveStatus = offer.status;
  const blockers: string[] = [];
  if (["DRAFT","AUTHORIZED","COMMUNICATED"].includes(offer.status)) {
    blockers.push(...offerResearchBlockers(ctx));
    if (offer.analysisSnapshotId !== ctx.analysisSnapshotId) blockers.push("Offer is bound to a different underwriting snapshot.");
    if (offer.reviewSnapshotJson && offerReviewSnapshotJson(offer,ctx) !== offer.reviewSnapshotJson) blockers.push("Verified evidence, economics, assumptions, or exact terms changed after this review packet was prepared.");
    if (offer.status === "DRAFT" && offer.draftExpiresAt && Date.parse(offer.draftExpiresAt) <= ctx.now.getTime()) {
      blockers.push("Internal proposal draft expired; prepare a new version.");
    }
    if (offer.status !== "DRAFT" && (!offer.authorityEvidenceId || !authorityEvidence(ctx,offer.authorityEvidenceId))) {
      blockers.push("Current verified public-record seller authority evidence is missing or over 30 days old.");
    }
    if (blockers.length) effectiveStatus = "INVALIDATED";
    else if (offer.status !== "DRAFT" && (!offer.expiresAt || !Number.isFinite(Date.parse(offer.expiresAt)) || Date.parse(offer.expiresAt) <= ctx.now.getTime())) {
      effectiveStatus = "EXPIRED";
      blockers.push("Owner approval expired; renew using a new draft and current underwriting.");
    }
  } else if (offer.withdrawalReason) blockers.push(offer.withdrawalReason);
  return {...offer,effectiveStatus,blockers:[...new Set(blockers)]};
}
export function validateOfferDraft(input: OfferDraftInput, ctx: OfferContext): void {
  const parsed = CreateOfferDraftBody.safeParse(input);
  if (!parsed.success) throw new DomainError(`Invalid offer draft: ${parsed.error.message}`);
  const blockers = offerResearchBlockers(ctx);
  if (blockers.length) throw new DomainError(blockers.join("; "));
  if (!cents(input.amount) || !cents(input.earnestMoney)) throw new DomainError("Offer amounts must use whole cents.");
  if (input.earnestMoney > input.amount) throw new DomainError("Earnest money cannot exceed the proposed purchase amount.");
  if (input.amount > ctx.analysis!.mao) throw new DomainError("Proposed purchase price exceeds the current deterministic MAO.");
  if (input.draftExpiresAt) future(input.draftExpiresAt,ctx.now,"Draft expiry");
  if (input.parentOfferId) {
    if (!input.idempotencyKey||!input.sellerResponseSource||!input.sellerResponseEvidence?.trim())
      throw new DomainError("Counteroffer versions require an idempotency key and explicit human/provider-backed seller-response evidence.");
    if (input.sellerResponseSource==="SELLER_PORTAL"&&!input.sellerResponseEventKey)
      throw new DomainError("Portal-backed counteroffers must reference the recorded seller response event.");
    if (input.sellerResponseSource==="HUMAN_ENTERED"&&input.sellerResponseEventKey)
      throw new DomainError("Human-entered responses cannot claim a provider portal event.");
  }
}
export function validateOfferApproval(offer: StoredOffer, input: OfferApprovalInput, ctx: OfferContext): void {
  const parsed = AuthorizeOfferBody.safeParse(input);
  if (!parsed.success) throw new DomainError(`Invalid approval: ${parsed.error.message}`);
  const evaluated = evaluateOffer(offer,ctx);
  if (evaluated.effectiveStatus !== "DRAFT") throw new DomainError(evaluated.blockers.join("; ") || "Only a current draft may be approved.",409);
  if (!cents(input.maximumApprovedAcquisitionPrice)) throw new DomainError("Approval ceiling must use whole cents.");
  if (input.maximumApprovedAcquisitionPrice > ctx.analysis!.mao) throw new DomainError("Approved acquisition ceiling cannot exceed the conservative calculated MAO.");
  if (offer.amount > input.maximumApprovedAcquisitionPrice) throw new DomainError("Draft amount exceeds the owner's approved acquisition ceiling.");
  if (!authorityEvidence(ctx,input.authorityEvidenceId)) throw new DomainError("Select current VERIFIED FACTS public-record ownership or seller-authority evidence with a verification note. Title and signatory clearance are still separate diligence.");
  if (offer.reviewSnapshotHash && input.reviewSnapshotHash !== offer.reviewSnapshotHash) throw new DomainError("Approval must confirm the exact current review packet version.",409);
  const expiry = future(input.expiresAt,ctx.now,"Approval expiry");
  if (expiry > Date.parse(ctx.analysis!.calculatedAt)+ANALYSIS_LIFETIME_MS) throw new DomainError("Approval cannot outlive the underwriting's seven-day freshness window.");
  if (future(input.followUpAt,ctx.now,"Follow-up") > expiry) throw new DomainError("Schedule the next action before the approval expires.");
  if (offer.draftExpiresAt && expiry > Date.parse(offer.draftExpiresAt)) throw new DomainError("Approval expiry cannot outlive the proposal draft expiry.");
}
export function validateOfferCommunication(offer: StoredOffer, input: OfferCommunicationInput, ctx: OfferContext): void {
  const parsed = CommunicateOfferBody.safeParse(input);
  if (!parsed.success) throw new DomainError(`Invalid communication record: ${parsed.error.message}`);
  const evaluated = evaluateOffer(offer,ctx);
  if (evaluated.effectiveStatus !== "AUTHORIZED") throw new DomainError(evaluated.blockers.join("; ") || "This offer is not currently authorized or has already been communicated.",409);
  if (!cents(input.amount) || input.amount !== offer.amount || input.amount > (offer.maximumApprovedAcquisitionPrice ?? 0)) {
    throw new DomainError("Communicate only the exact approved draft amount and terms; changed terms require a new owner-approved draft.");
  }
  future(input.followUpAt,ctx.now,"Follow-up");
}
export function validateOfferWithdrawal(offer: StoredOffer, input: OfferWithdrawalInput, now: Date): void {
  const parsed = WithdrawOfferBody.safeParse(input);
  if (!parsed.success) throw new DomainError(`Invalid withdrawal: ${parsed.error.message}`);
  if (!["DRAFT","AUTHORIZED","COMMUNICATED"].includes(offer.status)) throw new DomainError("This offer is already withdrawn or invalidated.",409);
  future(input.followUpAt,now,"Follow-up");
}