import type { Buyer } from '@workspace/api-client-react';

export type BuyerPropertyFacts = {
  address?: string | null;
  state: string | null;
  city: string | null;
  county: string | null;
  zip: string | null;
  propertyType: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  askingPrice?: number | null;
  units?: number | null;
  rehabCondition?: 'NONE' | 'LIGHT' | 'MODERATE' | 'HEAVY' | null;
  assessedValue?: number | null;
  lastSalePrice?: number | null;
  provenanceUsed?: string[];
};

export type BuyerPropertyFit = {
  matched: string[];
  unmet: string[];
  unknown: string[];
  criteriaUsed: string[];
};
export type BuyerEvidenceContext = Pick<Buyer, 'version' | 'criteriaEvidenceUrl' | 'buyingEvidenceAt' | 'validUntil' | 'verificationStatus' | 'approvalStatus' | 'updatedAt'>;

const norm = (value: string) => value.trim().toLowerCase();

export function hasIncompleteCorePropertyFacts(property: BuyerPropertyFacts) {
  return !property.state?.trim() || !property.propertyType ||
    (!property.city?.trim() && !property.zip?.trim()) ||
    property.sqft == null || property.beds == null || property.baths == null;
}

export function describeBuyerPropertyFacts(property: BuyerPropertyFacts) {
  return [
    `Address: ${property.address || 'unknown'}`,
    `City: ${property.city || 'unknown'}`,
    `County: ${property.county || 'unknown'}`,
    `State: ${property.state || 'unknown'}`,
    `ZIP: ${property.zip || 'unknown'}`,
    `Property type: ${property.propertyType || 'unknown'}`,
    `Beds: ${property.beds ?? 'unknown'}`,
    `Baths: ${property.baths ?? 'unknown'}`,
    `Square feet: ${property.sqft ?? 'unknown'}`,
    `Assessed value: ${property.assessedValue ?? 'unknown'} (not used as asking price)`,
    `Prior sale price: ${property.lastSalePrice ?? 'unknown'} (not used as asking price)`,
  ];
}

export function buyerEvidenceStatus(buyer: BuyerEvidenceContext, now: Date) {
  const evidenceAt = Date.parse(buyer.buyingEvidenceAt ?? '');
  const until = Date.parse(buyer.validUntil ?? '');
  const stale = buyer.verificationStatus === 'STALE' || buyer.approvalStatus === 'REVERIFICATION_REQUIRED' ||
    (Number.isFinite(evidenceAt) && (evidenceAt > now.getTime() || now.getTime() - evidenceAt > 30 * 86_400_000)) ||
    (Number.isFinite(until) && until <= now.getTime());
  const unknown = [
    ...(!buyer.criteriaEvidenceUrl ? ['Buyer criteria evidence reference is missing.'] : []),
    ...(!Number.isFinite(evidenceAt) ? ['Dated buyer evidence is missing or invalid; no current intent is inferred.'] : []),
    ...(!Number.isFinite(until) ? ['Buyer evidence validity date is missing or invalid.'] : []),
    ...(stale ? ['Buyer evidence is stale or requires re-review; refresh before relying on this fit.'] : []),
  ];
  return { stale, unknown };
}

export function evaluateBuyerPropertyFit(criteria: NonNullable<Buyer['criteria']>, property: BuyerPropertyFacts): BuyerPropertyFit {
  const matched: string[] = [];
  const unmet: string[] = [];
  const unknown: string[] = [];
  const criteriaUsed = [
    `States: ${[...criteria.states].sort().join(', ') || 'missing'}`,
    `Property types: ${[...criteria.propertyTypes].sort().join(', ') || 'missing'}`,
    `Cities: ${[...criteria.cities].sort().join(', ') || 'any'}`,
    `ZIP codes: ${[...criteria.zipCodes].sort().join(', ') || 'any'}`,
    `Counties: ${[...(criteria.counties ?? [])].sort().join(', ') || 'any'}`,
    `Beds: ${criteria.minBeds}–${criteria.maxBeds ?? 'any'}`,
    `Baths: ${criteria.minBaths ?? 0}–${criteria.maxBaths ?? 'any'}`,
    `Square feet: ${criteria.minSqft}–${criteria.maxSqft}`,
    `Purchase price: ${criteria.minPurchasePrice ?? 0}–${criteria.maxPurchasePrice}`,
  ];

  if (!criteria.states.length) unknown.push('Buyer state criteria are missing.');
  else if (!property.state?.trim()) unknown.push('Property state is missing.');
  else if (criteria.states.some(value => norm(value) === norm(property.state!))) matched.push(`State ${property.state}`);
  else unmet.push(`State ${property.state} is outside saved states.`);

  if (!criteria.propertyTypes.length) unknown.push('Buyer property-type criteria are missing.');
  else if (!property.propertyType) unknown.push('Property type is missing.');
  else if (criteria.propertyTypes.some(value => String(value) === property.propertyType)) matched.push(`Type ${property.propertyType}`);
  else unmet.push(`Type ${property.propertyType} is outside saved property types.`);

  if (criteria.cities.length || criteria.zipCodes.length) {
    if (!property.city?.trim() && !property.zip?.trim()) unknown.push('Property city and ZIP are missing.');
    else if (criteria.cities.some(city => property.city && norm(city) === norm(property.city)) ||
      criteria.zipCodes.some(zip => property.zip && zip.slice(0, 5) === property.zip.slice(0, 5))) matched.push('City/ZIP fits saved markets');
    else unmet.push('Known city/ZIP is outside saved markets.');
  }
  if (criteria.counties?.length) {
    if (!property.county?.trim()) unknown.push('Property county is missing.');
    else if (criteria.counties.some(county => norm(county) === norm(property.county!))) matched.push(`County ${property.county}`);
    else unmet.push(`County ${property.county} is outside saved counties.`);
  }
  if ((criteria.excludedCounties ?? []).length) {
    if (!property.county?.trim()) unknown.push('Excluded-county fit is unknown; property county is missing.');
    else if (criteria.excludedCounties!.some(county => norm(county) === norm(property.county!))) unmet.push('Property county is on the buyer’s excluded list.');
    else matched.push('Property county is not on the excluded list');
  }
  if ((criteria.excludedCities ?? []).length) {
    if (!property.city?.trim()) unknown.push('Excluded-city fit is unknown; property city is missing.');
    else if (criteria.excludedCities!.some(city => norm(city) === norm(property.city!))) unmet.push('Property city is on the buyer’s excluded list.');
    else matched.push('Property city is not on the excluded list');
  }
  if ((criteria.excludedZipCodes ?? []).length) {
    if (!property.zip?.trim()) unknown.push('Excluded-ZIP fit is unknown; property ZIP is missing.');
    else if (criteria.excludedZipCodes!.some(zip => zip.slice(0, 5) === property.zip!.slice(0, 5))) unmet.push('Property ZIP is on the buyer’s excluded list.');
    else matched.push('Property ZIP is not on the excluded list');
  }
  if (property.sqft == null) unknown.push('Property square footage is unknown.');
  else if (property.sqft < criteria.minSqft || property.sqft > criteria.maxSqft) unmet.push(`Size ${property.sqft} sqft is outside saved range.`);
  else matched.push(`Size ${property.sqft} sqft fits saved range`);
  if (property.beds == null) unknown.push('Property bedroom count is unknown.');
  else if (property.beds < criteria.minBeds || (criteria.maxBeds != null && property.beds > criteria.maxBeds)) unmet.push(`Bedrooms ${property.beds} are outside saved range.`);
  else matched.push(`Bedrooms ${property.beds} fit saved range`);
  if (property.baths == null) unknown.push('Property bathroom count is unknown.');
  else if (property.baths < (criteria.minBaths ?? 0) || (criteria.maxBaths != null && property.baths > criteria.maxBaths)) unmet.push(`Bathrooms ${property.baths} are outside saved range.`);
  else matched.push(`Bathrooms ${property.baths} fit saved range`);

  if (property.askingPrice == null) unknown.push('Current asking/acquisition price is unavailable; budget fit is unknown.');
  else if (property.askingPrice > criteria.maxPurchasePrice || (criteria.minPurchasePrice != null && property.askingPrice < criteria.minPurchasePrice)) unmet.push('Known asking price is outside saved purchase range.');
  else matched.push('Known asking price fits saved purchase range');
  if (criteria.minUnits != null || criteria.maxUnits != null) {
    if (property.units == null) unknown.push('Property unit count is unavailable.');
    else if (property.units < (criteria.minUnits ?? 0) || property.units > (criteria.maxUnits ?? Number.POSITIVE_INFINITY)) unmet.push(`Unit count ${property.units} is outside saved range.`);
    else matched.push(`Unit count ${property.units} fits saved range`);
  }
  if (criteria.rehabTolerance && criteria.rehabTolerance !== 'ANY') {
    if (!property.rehabCondition) unknown.push('Property condition/repair scope is unavailable; rehab fit is unknown.');
    else {
      const rank = { NONE: 0, LIGHT: 1, MODERATE: 2, HEAVY: 3 };
      const tolerance = rank[criteria.rehabTolerance as keyof typeof rank];
      if (rank[property.rehabCondition] > tolerance) unmet.push(`Repair scope ${property.rehabCondition} exceeds saved rehab tolerance.`);
      else matched.push(`Repair scope ${property.rehabCondition} fits saved rehab tolerance`);
    }
  }
  return { matched, unmet, unknown, criteriaUsed };
}
