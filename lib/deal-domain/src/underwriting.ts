import { DomainError, type Analysis, type Assumptions, type Lead, type UnderwritingInput } from "./types";
import { CreateLeadResponse, SaveUnderwritingBody, UpdateAssumptionsBody } from "@workspace/api-zod";
import type { Intelligence } from "./types";
import { estimateRepairScope, repairsFromEstimate, validateRepairRateCards } from "./repair-estimation";
import { estimateConditionRepairHypotheses } from "./repair-hypotheses";

export const ENGINE_VERSION = "deterministic-underwriting/1.1";
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  arvMultiplier: 0.7,
  sellingCostPct: 0.06,
  acquisitionCost: 2500,
  holdingMonthly: 1200,
  holdingMonths: 3,
  assignmentTarget: 15000,
  contingencyPct: 0.15,
  strongMargin: 10000,
  openingLowPct: 0.8,
  openingHighPct: 0.9,
  maxCompAgeDays: 180,
  maxDistanceMiles: 1,
  maxSqftDifferencePct: 0.2,
  minComps: 3,
  minConfidence: 0.65,
  approvalRequired: true,
  repairRateCatalogVersion: 0,
  repairRates: [],
};

const money = (n: number) => Math.round(n * 100) / 100;
const confidence = (n: number) => Math.round(n * 1000) / 1000;
const median = (values: number[]) => {
  const sorted = [...values].sort((a,b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const normalize = (address: string) => address.toLowerCase().replace(/[^a-z0-9]/g, "");

export function validateAssumptions(a: Assumptions, now = new Date()): void {
  const parsed = UpdateAssumptionsBody.safeParse(a);
  if (!parsed.success) throw new DomainError(`Invalid calculation assumptions: ${parsed.error.message}`);
  if (a.openingLowPct > a.openingHighPct) throw new DomainError("Opening range low cannot exceed high.");
  if (!a.approvalRequired) throw new DomainError("Offer authorization cannot be disabled. Every seller offer requires explicit owner approval.");
  validateRepairRateCards(a.repairRates,now);
}

/** All numeric inputs are supplied with source records. No LLM, fetch or database dependency. */
export function analyzeDeal(lead: Lead, input: UnderwritingInput, assumptions: Assumptions, now: Date, intelligence: Intelligence[] = []): Analysis {
  const validLead = CreateLeadResponse.safeParse(lead);
  const validInput = SaveUnderwritingBody.safeParse(input);
  if (!validLead.success || !validInput.success || !Number.isFinite(now.getTime())) throw new DomainError("Invalid lead, underwriting input or calculation date.");
  validateAssumptions(assumptions,now);
  const seenIds = new Set<string>();
  const seenAddresses = new Set<string>();
  const repairEstimate = estimateRepairScope(lead,input.repairObservations ?? [],assumptions,intelligence,now);
  const preliminaryRepairEstimate = estimateConditionRepairHypotheses(lead,intelligence,assumptions,now);
  const resolvedRepairs = (input.repairObservations?.length ?? 0) > 0
    ? repairsFromEstimate(repairEstimate)
    : input.repairs;
  const repairCategories = new Set<string>();
  for (const r of resolvedRepairs) {
    if (r.low > r.expected || r.expected > r.high) throw new DomainError(`Repair ${r.category}: require low ≤ expected ≤ high.`);
    const key = r.category.trim().toLowerCase();
    if (repairCategories.has(key)) throw new DomainError(`Duplicate repair category: ${r.category}.`);
    repairCategories.add(key);
  }
  const compDecisions = input.comps.map(comp => {
    const reasons: string[] = [];
    const age = (now.getTime() - Date.parse(`${comp.soldAt}T00:00:00Z`)) / 86_400_000;
    if (!Number.isFinite(age) || age < 0) reasons.push("Invalid or future sale date");
    if (age > assumptions.maxCompAgeDays) reasons.push("Sale older than configured maximum");
    if (comp.distanceMiles > assumptions.maxDistanceMiles) reasons.push("Outside configured radius");
    if (comp.propertyType !== lead.propertyType) reasons.push("Different property type");
    if (!comp.verified) reasons.push("Sale not source-verified");
    if (comp.condition !== "RENOVATED") reasons.push("ARV requires renovated comparable");
    if (lead.sqft <= 0 || Math.abs(comp.sqft - lead.sqft) / lead.sqft > assumptions.maxSqftDifferencePct) reasons.push("Outside configured size tolerance");
    if (seenIds.has(comp.id) || seenAddresses.has(normalize(comp.address))) reasons.push("Duplicate comparable");
    if (normalize(comp.address) === normalize(lead.address)) reasons.push("Subject property is not a comparable");
    seenIds.add(comp.id);
    seenAddresses.add(normalize(comp.address));
    return { id: comp.id, included: reasons.length === 0, reasons };
  });
  // Fixed, versioned outlier rule: exclude price/sqft >30% away from eligible median.
  const eligible = input.comps.filter((_, i) => compDecisions[i]!.included);
  const center = eligible.length ? median(eligible.map(c => c.salePrice / c.sqft)) : 0;
  if (eligible.length >= 3) {
    input.comps.forEach((c,i) => {
      if (compDecisions[i]!.included && Math.abs(c.salePrice / c.sqft - center) / center > 0.3) {
        compDecisions[i]!.included = false;
        compDecisions[i]!.reasons.push("Price/sqft differs >30% from eligible median (engine rule)");
      }
    });
  }
  const selected = input.comps.filter((_, i) => compDecisions[i]!.included);
  const ppsf = selected.map(c => c.salePrice / c.sqft);
  const arv = {
    low: ppsf.length ? money(Math.min(...ppsf) * lead.sqft) : 0,
    expected: ppsf.length ? money(median(ppsf) * lead.sqft) : 0,
    high: ppsf.length ? money(Math.max(...ppsf) * lead.sqft) : 0,
    confidence: confidence(selected.length < assumptions.minComps ? 0.3 * selected.length / assumptions.minComps : Math.min(0.9, 0.65 + 0.05 * (selected.length - assumptions.minComps))),
  };
  const estimateBlocked = repairEstimate.status === "BLOCKED";
  const repairs = {
    low: estimateBlocked ? 0 : money(resolvedRepairs.reduce((s,r) => s + r.low, 0)),
    expected: estimateBlocked ? 0 : money(resolvedRepairs.reduce((s,r) => s + r.expected, 0)),
    high: estimateBlocked ? 0 : money(resolvedRepairs.reduce((s,r) => s + r.high, 0)),
    confidence: estimateBlocked ? 0 : resolvedRepairs.length ? confidence(Math.min(...resolvedRepairs.map(r => r.confidence))) : 0,
  };
  const risks: string[] = [];
  const blockers: string[] = [...repairEstimate.blockers];
  if (!lead.sqft) blockers.push("Subject square footage must be sourced and greater than zero");
  if (!["SINGLE_FAMILY", "CONDO", "TOWNHOUSE"].includes(lead.propertyType)) blockers.push("This engine supports residential 1-unit underwriting only; this property needs a dedicated valuation adapter");
  if (lead.units !== 1) blockers.push("Multi-unit valuation is not supported by this underwriting engine");
  if (selected.length < assumptions.minComps) blockers.push(`Need at least ${assumptions.minComps} eligible, verified, renovated comps; found ${selected.length}`);
  if (!input.repairsComplete || !resolvedRepairs.length) blockers.push("Complete a sourced repair scope, including explicit zero-cost assessment if appropriate");
  if (!input.conditionConfirmed) blockers.push("Property condition must be confirmed before underwriting is call-ready");
  if (Math.min(arv.confidence, repairs.confidence) < assumptions.minConfidence) blockers.push("ARV or repair confidence is below the configured threshold");
  if (arv.expected && (arv.high - arv.low) / arv.expected > 0.25) risks.push("Wide comp dispersion: ARV spread exceeds 25%");
  if (compDecisions.some(c => !c.included)) risks.push("One or more comps were rejected; review comp decisions");
  if (compDecisions.some(c => c.reasons.some(reason => reason.includes("differs >30% from eligible median")))) {
    blockers.push("Comparable sales contain a material price/sqft conflict; resolve the outlier before offer readiness");
  }
  if (arv.expected && (arv.high - arv.low) / arv.expected > 0.25) {
    blockers.push("ARV dispersion exceeds the 25% risk limit; review the comp set before offer readiness");
  }
  if (preliminaryRepairEstimate.hypotheses.length) {
    risks.push("Current source remarks produced AI HYPOTHESIS condition signals. Preliminary rate scenarios are not verified scope and never feed repairs, MAO or authorization.");
  }
  if (preliminaryRepairEstimate.sourceWarnings.length) {
    risks.push("Some condition remarks were excluded from preliminary repair scenarios because their provenance or freshness was insufficient.");
  }
  if (lead.askingPrice == null) risks.push("Asking price unknown: establish seller expectation during the conversation");
  if (now.getTime() - Date.parse(lead.createdAt) > 30 * 86_400_000) risks.push("Lead is over 30 days old; reconfirm motivation and availability");
  const costs = assumptions.acquisitionCost + assumptions.holdingMonthly * assumptions.holdingMonths;
  const buyerCeiling = (arvValue: number, repairValue: number) =>
    arvValue * assumptions.arvMultiplier - arvValue * assumptions.sellingCostPct - repairValue * (1 + assumptions.contingencyPct) - costs;
  // Conservative acquisition ceiling: low ARV, high repairs, all explicit costs, target assignment.
  const rawMao = estimateBlocked ? 0 : money(buyerCeiling(arv.low, repairs.high) - assumptions.assignmentTarget);
  const mao = Math.max(0, rawMao);
  const expectedMao = estimateBlocked ? 0 : money(buyerCeiling(arv.expected, repairs.expected) - assumptions.assignmentTarget);
  if (rawMao <= 0 && selected.length) risks.push("Conservative economics do not support a positive acquisition price");
  let classification: Analysis["classification"] = "INCOMPLETE";
  if (!blockers.length) {
    classification = rawMao <= 0 ? "PASS"
      : lead.askingPrice == null ? "NEGOTIABLE"
      : lead.askingPrice <= mao - assumptions.strongMargin ? "STRONG"
      : lead.askingPrice <= Math.max(mao, expectedMao) ? "NEGOTIABLE" : "PASS";
  }
  return {
    engineVersion: ENGINE_VERSION,
    calculatedAt: now.toISOString(),
    classification, arv, repairs, repairEstimate, preliminaryRepairEstimate, mao,
    openingLow: money(mao * assumptions.openingLowPct),
    openingHigh: money(mao * assumptions.openingHighPct),
    maximumApprovedAcquisitionPrice: null,
    spreadAtAsking: ppsf.length && lead.askingPrice != null && !estimateBlocked ? money(buyerCeiling(arv.low, repairs.high) - lead.askingPrice) : null,
    assumptions: structuredClone(assumptions), risks, blockers, compDecisions,
    formula: "MAO = low ARV × ARV multiplier − low ARV × selling cost % − high repairs × (1 + contingency %) − acquisition cost − monthly holding × months − target assignment. ARV = subject sqft × verified renovated comp $/sqft (min/median/max). STRONG: asking ≤ MAO − strong margin; NEGOTIABLE: asking unknown or ≤ expected-case MAO; otherwise PASS. Ranges are scenario bounds, not statistical confidence intervals. Calculated ceiling is NOT offer authorization.",
  };
}