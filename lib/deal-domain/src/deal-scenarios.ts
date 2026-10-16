import type { Analysis } from "./types";

export type ScenarioName = "LOW" | "BASE" | "HIGH";
export type DealScenario = {
  name: ScenarioName;
  arv: number;
  repairs: number;
  buyerMarginReserve: number;
  holdingAndClosingCosts: number;
  assignmentFee: number;
  mao: number;
};
export type ScenarioSensitivity = { input: string; lowMao: number; baseMao: number; highMao: number; source: string };
export type DealScenarioResult = {
  scenarios: DealScenario[];
  sensitivities: ScenarioSensitivity[];
  uncertaintyPct: number;
  calculationAvailable: boolean;
  arvAvailable: boolean;
  repairsAvailable: boolean;
  warnings: string[];
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const finiteNonnegative = (value: number) => Number.isFinite(value) && value >= 0;

/** Read-only scenario math. It never changes an underwriting input or persisted snapshot. */
export function analyzeDealScenarios(analysis: Analysis, uncertaintyPct = 20): DealScenarioResult {
  if (!Number.isFinite(uncertaintyPct) || uncertaintyPct < 0 || uncertaintyPct > 100) {
    throw new Error("Scenario uncertainty must be between 0 and 100 percent.");
  }
  const { arv, repairs, assumptions } = analysis;
  const costs = assumptions.acquisitionCost + assumptions.holdingMonthly * assumptions.holdingMonths;
  const values = [arv.low,arv.expected,arv.high,repairs.low,repairs.expected,repairs.high,costs,assumptions.assignmentTarget];
  if (!values.every(finiteNonnegative)) throw new Error("Scenario inputs must be finite and nonnegative.");
  const hasARV = arv.low > 0 && arv.expected > 0 && arv.high > 0;
  const hasRepairEvidence = repairs.confidence > 0 && analysis.repairEstimate.status !== "BLOCKED";
  const warnings = [...analysis.blockers];
  if (!hasARV) warnings.push("ARV range is missing; provide eligible verified comps.");
  if (!hasRepairEvidence) warnings.push("Repair range is missing or blocked; obtain reviewed, sourced repair scope.");
  const usable = hasARV && hasRepairEvidence;
  const spread = uncertaintyPct / 100;
  const buyerMargin = (value: number) => roundMoney(value * (1 - assumptions.arvMultiplier));
  const mao = (value: number, repair: number, cost: number, assignment: number) =>
    usable ? Math.max(0, roundMoney(value * assumptions.arvMultiplier -
      value * assumptions.sellingCostPct - repair * (1 + assumptions.contingencyPct) - cost - assignment)) : 0;
  const scenario = (name: ScenarioName, value: number, repair: number, cost: number, assignment: number): DealScenario => ({
    name, arv:value, repairs:repair, buyerMarginReserve:buyerMargin(value),
    holdingAndClosingCosts:roundMoney(cost), assignmentFee:roundMoney(assignment),
    mao:mao(value,repair,cost,assignment),
  });
  const baseCost = costs;
  const baseAssignment = assumptions.assignmentTarget;
  const scenarios = [
    scenario("LOW",arv.low,repairs.high,baseCost*(1+spread),baseAssignment*(1+spread)),
    scenario("BASE",arv.expected,repairs.expected,baseCost,baseAssignment),
    scenario("HIGH",arv.high,repairs.low,Math.max(0,baseCost*(1-spread)),Math.max(0,baseAssignment*(1-spread))),
  ];
  const sensitivities: ScenarioSensitivity[] = [
    {input:"ARV",lowMao:mao(arv.low,repairs.expected,baseCost,baseAssignment),baseMao:mao(arv.expected,repairs.expected,baseCost,baseAssignment),highMao:mao(arv.high,repairs.expected,baseCost,baseAssignment),source:"Comp-derived underwriting range"},
    {input:"Repairs",lowMao:mao(arv.expected,repairs.high,baseCost,baseAssignment),baseMao:mao(arv.expected,repairs.expected,baseCost,baseAssignment),highMao:mao(arv.expected,repairs.low,baseCost,baseAssignment),source:"Reviewed repair range"},
    {input:"Holding + closing costs",lowMao:mao(arv.expected,repairs.expected,baseCost*(1+spread),baseAssignment),baseMao:mao(arv.expected,repairs.expected,baseCost,baseAssignment),highMao:mao(arv.expected,repairs.expected,Math.max(0,baseCost*(1-spread)),baseAssignment),source:`Configured cost base ±${uncertaintyPct}% scenario envelope`},
    {input:"Assignment fee",lowMao:mao(arv.expected,repairs.expected,baseCost,baseAssignment*(1+spread)),baseMao:mao(arv.expected,repairs.expected,baseCost,baseAssignment),highMao:mao(arv.expected,repairs.expected,baseCost,Math.max(0,baseAssignment*(1-spread))),source:`Configured target ±${uncertaintyPct}% scenario envelope`},
  ];
  return {scenarios,sensitivities,uncertaintyPct,calculationAvailable:usable,
    arvAvailable:hasARV,repairsAvailable:hasRepairEvidence,warnings:[...new Set(warnings)]};
}
