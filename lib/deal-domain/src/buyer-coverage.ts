import type { Buyer } from "./buyers";
import { verificationStatus } from "./buyers";
import { buyerQualification } from "./buyer-qualification";

const PRICE_BANDS = [
  {key:"0-150k",min:0,max:150_000},{key:"150-300k",min:150_000,max:300_000},
  {key:"300-500k",min:300_000,max:500_000},{key:"500k+",min:500_000,max:1_000_000_000},
];
const CONDITIONS = ["LIGHT","MODERATE","HEAVY"] as const;
const REHAB_RANK: Record<string,number> = {NONE:0,LIGHT:1,MODERATE:2,HEAVY:3,ANY:4};
const marketKeys = (b: Buyer) => {
  const c=b.criteria;
  if (!c) return [];
  return [...new Set([
    ...c.states.map(x=>`STATE:${x.toUpperCase()}`),
    ...c.cities.map(x=>`CITY:${x.trim().toLowerCase()}`),
    ...c.zipCodes.map(x=>`ZIP:${x}`),
  ])];
};
const normalizeContact=(s:string)=>s.trim().toLowerCase();
export type BuyerCoverageGap = {
  market:string;propertyType:string;priceBand:string;eligibleBuyerCount:number;prospectCount:number;
  staleProofCount:number;tasks:Array<{kind:"ACQUIRE"|"REVERIFY";action:string;buyerId?:string;reason:string}>;
  conditionCoverage:Record<string,number>;closingSpeedCoverage:Record<string,number>;
  blockers:string[];
};
export function buyerPoolCoverage(buyers:Buyer[],now:Date):BuyerCoverageGap[] {
  const realBuyers=buyers.filter(b=>!/^synthetic fixture:/i.test(b.source.trim()));
  const duplicateIds=new Set<string>();
  for(const keyOf of [(b:Buyer)=>normalizeContact(b.email),(b:Buyer)=>normalizeContact(b.phone)]) {
    const byKey=new Map<string,Buyer[]>();
    for(const b of buyers){const k=keyOf(b);if(k){byKey.set(k,[...(byKey.get(k)??[]),b]);}}
    for(const records of byKey.values()) if(records.length>1) records.forEach(b=>duplicateIds.add(b.id));
  }
  const markets=[...new Set(realBuyers.flatMap(marketKeys))].sort();
  const types=[...new Set(realBuyers.flatMap(b=>b.criteria?.propertyTypes??[]))].sort();
  const result:BuyerCoverageGap[]=[];
  for(const market of markets) for(const propertyType of types) for(const band of PRICE_BANDS){
    const candidates=realBuyers.filter(b=>marketKeys(b).includes(market)&&b.criteria?.propertyTypes.includes(propertyType)&&
      (b.criteria.minPurchasePrice??0)<=band.max&&b.criteria.maxPurchasePrice>=band.min);
    const eligible=candidates.filter(b=>b.approvalStatus==="APPROVED"&&b.verificationStatus==="VERIFIED"&&
      b.currentBuyingStatus==="BUYING"&&b.status==="ACTIVE"&&!/^synthetic fixture:/i.test(b.source.trim())&&
      !duplicateIds.has(b.id)&&b.criteria!=null&&b.availableFunds!=null&&
      (b.criteria.minPurchasePrice??0)<=band.min&&b.criteria.maxPurchasePrice>=band.max&&
      b.availableFunds-(b as Buyer & {reservedFunds?:number}).reservedFunds! >= band.max&&
      (b.criteria.maxConcurrentDeals??0)>(b as Buyer & {reservedDeals?:number}).reservedDeals!&&
      buyerQualification(b,now).approvalStatus==="APPROVED");
    const tasks:BuyerCoverageGap["tasks"]=[];
    const stale=candidates.filter(b=>b.approvalStatus==="REVERIFICATION_REQUIRED"||b.verificationStatus==="STALE");
    stale.forEach(b=>tasks.push({kind:"REVERIFY",buyerId:b.id,action:`Reverify ${b.name}`,reason:b.qualificationBlockers?.join("; ")||"Proof is stale."}));
    if(!eligible.length){
      const prospectCount=candidates.filter(b=>!/^synthetic fixture:/i.test(b.source.trim())&&
        ["DISCOVERED","QUALIFICATION_REQUIRED"].includes(b.approvalStatus??"")).length;
      tasks.push({kind:"ACQUIRE",action:`Find verified ${propertyType} buyers for ${market} · $${band.key}`,reason:
        candidates.length?`${candidates.length} prospect(s) overlap, but none pass current proof, capacity, identity, or buy-box gates.`:"No buyer records cover this combination."});
    }
    const conditionCoverage=Object.fromEntries(CONDITIONS.map(cond=>[cond,eligible.filter(b=>
      REHAB_RANK[b.criteria?.rehabTolerance??""]>=REHAB_RANK[cond]).length]));
    const closingSpeedCoverage=Object.fromEntries([14,30,60].map(days=>[`≤${days}d`,eligible.filter(b=>
      (b.criteria?.closingDays??Infinity)<=days).length]));
    const reasons=[...new Set(candidates.flatMap(b=>{
      if(eligible.includes(b))return [];
      if(/^synthetic fixture:/i.test(b.source.trim()))return ["Synthetic fixtures are excluded."];
      if(duplicateIds.has(b.id))return ["Conflicting duplicate identity must be resolved."];
      if(b.approvalStatus!=="APPROVED"||verificationStatus(b,now)!=="VERIFIED")return ["Current identity, proof, buying intent, and criteria review is missing or stale."];
      if((b.availableFunds??0)-(b as Buyer & {reservedFunds?:number}).reservedFunds!<band.max)return ["Verified funds after active commitments do not cover this price band."];
      if((b.criteria?.maxConcurrentDeals??0)<=(b as Buyer & {reservedDeals?:number}).reservedDeals!)return ["All verified concurrent-deal capacity is committed."];
      return b.qualificationBlockers ?? [];
    }))];
    result.push({market,propertyType,priceBand:band.key,eligibleBuyerCount:eligible.length,
      prospectCount:candidates.filter(b=>!/^synthetic fixture:/i.test(b.source.trim())&&
        ["DISCOVERED","QUALIFICATION_REQUIRED"].includes(b.approvalStatus??"")).length,
      staleProofCount:candidates.filter(b=>b.approvalStatus==="REVERIFICATION_REQUIRED"||b.verificationStatus==="STALE").length,
      tasks,conditionCoverage,closingSpeedCoverage,blockers:reasons});
  }
  return result;
}
