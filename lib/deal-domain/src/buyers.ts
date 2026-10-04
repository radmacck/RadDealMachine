import type { z } from "zod";
import type { ListBuyersResponse, GetDealOperationsResponse } from "@workspace/api-zod";
import { DomainError, type LeadDetail } from "./types";
import type { OfferActor } from "./offers";
import { buyerQualification } from "./buyer-qualification";
import { extendedCriteriaChecks } from "./buyer-criteria";

export type Buyer = z.infer<typeof ListBuyersResponse>[number];
export type DealContract = NonNullable<z.infer<typeof GetDealOperationsResponse>["contract"]>;
export type BuyerMatch = z.infer<typeof GetDealOperationsResponse>["matches"][number];
export const DAY = 86_400_000;
export function assertOperationsRole(actor: OfferActor, allowed: string[]) {
  if (!allowed.includes(actor.role)) throw new DomainError("Your role cannot perform this operation.",403);
}
export function evidenceUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new DomainError("Evidence needs a valid HTTP(S) document reference."); }
  if (!["https:","http:"].includes(url.protocol) || url.username || url.password) throw new DomainError("Evidence must be an HTTP(S) reference without embedded credentials.");
  return url.toString();
}
export function pastInstant(value: string, now: Date, label: string) {
  const date = Date.parse(value);
  if (!Number.isFinite(date) || date > now.getTime()) throw new DomainError(`${label} must be a valid timestamp, not in the future.`);
  return date;
}
export function verificationStatus(buyer: Pick<Buyer,"verifiedBy"|"verifiedAt"|"evidenceAt"|"validUntil">, now: Date): Buyer["verificationStatus"] {
  if (!buyer.verifiedBy || !buyer.verifiedAt || !buyer.evidenceAt || !buyer.validUntil) return "UNVERIFIED";
  const at = Date.parse(buyer.evidenceAt), until = Date.parse(buyer.validUntil), reviewed = Date.parse(buyer.verifiedAt);
  if (!Number.isFinite(at) || !Number.isFinite(until) || !Number.isFinite(reviewed) || reviewed<at || reviewed>now.getTime() ||
    at > now.getTime() || until <= now.getTime() || until>at+30*DAY || at+30*DAY <= now.getTime()) return "STALE";
  return "VERIFIED";
}
/** Deterministic criteria fit. Score is checklist coverage, NOT probability or confidence. */
export function matchBuyer(buyer: Buyer, detail: LeadDetail, contract: DealContract|null, now: Date, priceOverride?: number, reservations = 0, reservedFunds = 0): BuyerMatch {
  const {lead,analysis} = detail;
  const c = buyer.criteria;
  const price = priceOverride ?? (contract ? contract.purchasePrice+contract.assignmentTarget : null);
  const reasons: string[] = [], mismatches: string[] = [];
  let passed = 0, count = 0;
  const check = (ok: boolean, yes: string, no: string) => { count++; if (ok) { passed++; reasons.push(yes); } else mismatches.push(no); };
  const qualified = buyerQualification(buyer,now);
  check(qualified.approvalStatus==="APPROVED","Approved, currently buying destination with reviewed criteria.",qualified.qualificationBlockers.join("; "));
  if (!c) return {buyerId:buyer.id,leadId:lead.id,buyerName:buyer.name,destinationKind:buyer.destinationKind??"BUYER",
    eligible:false,score:0,reasons,mismatches,status:"MATCHED",buyerVersion:buyer.version,agreedPrice:null,evidence:null,updatedAt:now.toISOString()};
  check(buyer.status==="ACTIVE","Buyer is accepting opportunities.","Buyer is paused.");
  check(verificationStatus(buyer,now)==="VERIFIED",buyer.destinationKind&&buyer.destinationKind!=="BUYER"?"Destination identity/current-criteria review is current; no funding assurance.":"Identity and funding review is current.","Required identity/evidence review is missing or stale.");
  check(c.states.some(s=>s.toUpperCase()===lead.state.toUpperCase()),"State matches the buy box.","State is outside the buy box.");
  const norm = (s:string) => s.trim().toLowerCase();
  check(!c.cities.length&&!c.zipCodes.length || c.cities.some(city=>norm(city)===norm(lead.city)) || c.zipCodes.includes(lead.zip.slice(0,5)),
    "City/ZIP fits the requested market.","City/ZIP is outside the requested markets.");
  check(c.propertyTypes.includes(lead.propertyType),"Property type fits.","Property type does not fit.");
  check(price!=null && price<=c.maxPurchasePrice,`Acquisition plus target assignment fits the $${c.maxPurchasePrice.toLocaleString()} budget.`,
    price==null?"An executed acquisition contract is needed to establish the buyer price.":"Buyer price exceeds the stated budget.");
  const channel = buyer.destinationKind==="DEAL_FINDER" || buyer.destinationKind==="GURU";
  check(channel || (price!=null && (buyer.availableFunds ?? 0)-reservedFunds>=price),channel?"Approved destination routing only; an end buyer is still required.":"Reviewed available funds after active commitments cover the buyer price.","Reviewed available funds after active commitments do not cover the buyer price.");
  check(!!analysis && analysis.repairs.high<=c.maxRepairs,"High-case repairs fit the rehab capacity.","Research is missing or high-case repairs exceed the rehab capacity.");
  check(lead.beds>=c.minBeds && lead.sqft>=c.minSqft && lead.sqft<=c.maxSqft,"Beds and size fit.","Beds or square footage do not fit.");
  check(!!contract && !["DRAFT","CANCELLED","CLOSED"].includes(contract.status),"Deal is under an executed acquisition contract.","Deal is not available under an executed acquisition contract.");
  check(!!contract?.assignmentAllowed,"Approved terms permit assignment.","Assignment is not permitted by the recorded terms.");
  check(!!contract && Date.parse(contract.closingAt)-now.getTime()>=(contract.committedBuyerId===buyer.id?0:c.closingDays*DAY),"Buyer can close within the remaining deadline.","Buyer closing capacity cannot meet the remaining deadline.");
  check(!!analysis && !analysis.blockers.length && now.getTime()-Date.parse(analysis.calculatedAt)>=0 && now.getTime()-Date.parse(analysis.calculatedAt)<7*DAY,
    "Current underwriting passes completeness and freshness gates.","Underwriting is incomplete or at least seven days old; review current sources and refresh it.");
  for (const item of extendedCriteriaChecks(buyer,detail,price,reservations)) check(item.ok,item.yes,item.no);
  return {buyerId:buyer.id,leadId:lead.id,buyerName:buyer.name,destinationKind:buyer.destinationKind??"BUYER",eligible:!mismatches.length,
    score:Math.round(100*passed/count),reasons,mismatches,status:"MATCHED",buyerVersion:buyer.version,
    agreedPrice:null,evidence:null,updatedAt:now.toISOString()};
}
export function buyerReservations(contracts:DealContract[],buyerId:string,excludedContractId?:string) {
  const active = contracts.filter(c=>c.id!==excludedContractId&&c.committedBuyerId===buyerId&&!["CLOSED","CANCELLED"].includes(c.status));
  return {count:active.length,funds:active.reduce((sum,c)=>sum+(c.agreedBuyerPrice??c.purchasePrice+c.assignmentTarget),0)};
}