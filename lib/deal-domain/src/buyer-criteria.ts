import type { Buyer, DealContract } from "./buyers";
import type { LeadDetail } from "./types";

/** Versioned observable fit; missing rental/cap-rate/repair-band evidence never passes. */
export function extendedCriteriaChecks(b: Buyer, detail: LeadDetail, price: number|null, reservations = 0) {
  const c = b.criteria;
  if (!c) return [{ok:false,yes:"",no:"Buying criteria are unknown."}];
  const {lead,analysis} = detail;
  const norm = (s:string)=>s.trim().toLowerCase();
  const county = norm(lead.county), city = norm(lead.city), zip = lead.zip.slice(0,5);
  const checks = [
    {ok:!c.counties?.length || c.counties.some(v=>norm(v)===county),yes:"County fits.",no:"County is outside the buy box."},
    {ok:!c.excludedCounties?.some(v=>norm(v)===county)&&!c.excludedCities?.some(v=>norm(v)===city)&&!c.excludedZipCodes?.includes(zip),yes:"No geographic exclusion applies.",no:"An explicit geographic exclusion applies."},
    {ok:lead.units>=(c.minUnits??0)&&lead.units<=(c.maxUnits??0),yes:"Unit count fits.",no:"Unit count does not fit."},
    {ok:price!==null&&price>=(c.minPurchasePrice??0),yes:"Price clears the minimum purchase range.",no:"Price is below the minimum purchase range."},
    {ok:lead.baths>=(c.minBaths??0)&&(c.maxBaths==null||lead.baths<=c.maxBaths)&&(c.maxBeds==null||lead.beds<=c.maxBeds),yes:"Baths and maximum bedrooms fit.",no:"Baths or maximum bedrooms do not fit."},
    {ok:!!analysis&&(c.minArv==null||analysis.arv.low>=c.minArv)&&(c.maxArv==null||analysis.arv.high<=c.maxArv),yes:"Conservative ARV range fits the requested bounds.",no:"ARV range is missing or outside the requested bounds."},
    {ok:reservations<(c.maxConcurrentDeals??0),yes:"An available concurrent closing slot remains.",no:"Concurrent closing capacity is exhausted."},
    {ok:c.strategies?.some(s=>s==="FLIP"||s==="WHOLESALE")??false,yes:"A flip/wholesale strategy fits the current valuation adapter.",no:"Requested strategy needs rental/development evidence not provided by the current valuation adapter."},
    {ok:c.minCapRate==null,yes:"No unverified cap-rate condition is assumed.",no:"Cap-rate requirement cannot be satisfied without a verified income/operating-expense valuation adapter."},
    {ok:c.minSpread==null||(!!analysis&&price!==null&&analysis.mao+analysis.assumptions.assignmentTarget-price>=c.minSpread),
      yes:"Minimum conservative policy headroom fits (buyer ceiling minus buyer price).",no:"Minimum conservative policy headroom is missing or insufficient."},
  ];
  const ratio = analysis && analysis.arv.low>0 ? analysis.repairs.high/analysis.arv.low : Infinity;
  const bands = {NONE:0,LIGHT:0.05,MODERATE:0.15,HEAVY:Infinity,ANY:Infinity};
  checks.push({ok:!!analysis && !!detail.underwriting?.repairsComplete &&
    !!c.rehabTolerance && ratio<=bands[c.rehabTolerance],
    yes:"Sourced high-case repair ratio fits the declared rehab tolerance (NONE 0%, LIGHT ≤5%, MODERATE ≤15%, HEAVY/ANY uncapped).",
    no:"Repair scope is missing or exceeds the declared rehab tolerance."});
  return checks;
}