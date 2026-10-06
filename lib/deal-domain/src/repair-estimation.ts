import type {
  Assumptions, Intelligence, Lead, Repair, RepairEstimate, RepairEstimateLine,
  RepairObservation, RepairRateCard,
} from "./types";
import { DomainError } from "./types";

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const normalized = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const marketToken = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

export function repairMarketKey(city: string, state: string): string {
  return `${marketToken(city)}-${marketToken(state)}`;
}

function observationEvidence(
  observation: RepairObservation,
  lead: Lead,
  entries: Intelligence[],
  now: Date,
): Intelligence | null {
  const evidence = entries.find(entry => entry.id === observation.evidenceId && entry.leadId === lead.id);
  if (!evidence) return null;
  const age = now.getTime() - Date.parse(evidence.capturedAt);
  const expectedCategory = `repair_scope:${observation.category.trim().toLowerCase()}`;
  if (evidence.category.trim().toLowerCase() !== expectedCategory) return null;
  if (evidence.sourceType !== "INSPECTION" || evidence.classification !== "VERIFIED_FACTS") return null;
  if (!evidence.verificationNote?.trim() || !/^https?:\/\//i.test(evidence.sourceUrl ?? "")) return null;
  if (!Number.isFinite(age) || age < 0 || age >= 30 * 86_400_000) return null;
  return evidence;
}

function rateFor(
  observation: RepairObservation,
  marketKey: string,
  rates: RepairRateCard[],
  today: string,
): RepairRateCard | null {
  const matches = rates.filter(rate =>
    rate.active &&
    normalized(rate.marketKey) === normalized(marketKey) &&
    normalized(rate.category) === normalized(observation.category) &&
    rate.severity === observation.severity &&
    rate.unit === observation.unit &&
    rate.capturedOn <= today &&
    rate.validThrough >= today,
  );
  if (matches.length > 1) throw new DomainError(`Repair rate catalog has conflicting active cards for ${observation.category} / ${observation.severity} / ${observation.unit}.`, 409);
  return matches[0] ?? null;
}

function lineFor(
  observation: RepairObservation,
  evidence: Intelligence,
  rate: RepairRateCard | null,
): RepairEstimateLine {
  if (observation.severity === "NO_REPAIR") {
    return {
      category: observation.category,
      severity: observation.severity,
      quantity: 0,
      unit: observation.unit,
      evidenceId: observation.evidenceId,
      low: 0,
      expected: 0,
      high: 0,
      confidence: evidence.confidence,
      source: `Inspection verified: ${evidence.source}`,
      sourceUrl: evidence.sourceUrl!,
    };
  }
  if (!rate) throw new Error("A sourced active rate card is required for repair work.");
  const low = roundMoney(observation.quantity * rate.lowRate);
  const expected = roundMoney(observation.quantity * rate.expectedRate);
  const high = roundMoney(observation.quantity * rate.highRate);
  return {
    category: observation.category,
    severity: observation.severity,
    quantity: observation.quantity,
    unit: observation.unit,
    evidenceId: observation.evidenceId,
    rateCardId: rate.id,
    rateCardVersion: rate.version,
    low,
    expected,
    high,
    confidence: Math.min(evidence.confidence, rate.confidence),
    source: `Cost catalog ${rate.id} v${rate.version}: ${rate.source}`,
    sourceUrl: rate.sourceUrl,
  };
}

export function estimateRepairScope(
  lead: Lead,
  observations: RepairObservation[],
  assumptions: Assumptions,
  entries: Intelligence[],
  now: Date,
): RepairEstimate {
  const marketKey = repairMarketKey(lead.city, lead.state);
  const base: RepairEstimate = {
    status: "NOT_USED",
    marketKey,
    catalogVersion: assumptions.repairRateCatalogVersion,
    calculatedAt: now.toISOString(),
    lines: [],
    total: null,
    blockers: [],
  };
  if (!observations.length) return base;

  const blockers: string[] = [];
  const lines: RepairEstimateLine[] = [];
  const seenCategories = new Set<string>();
  const today = now.toISOString().slice(0, 10);
  for (const observation of observations) {
    const categoryKey = normalized(observation.category);
    if (seenCategories.has(categoryKey)) {
      blockers.push(`Record one consolidated condition observation per repair category (${observation.category}).`);
      continue;
    }
    seenCategories.add(categoryKey);
    if (observation.severity === "NO_REPAIR" && observation.quantity !== 0) {
      blockers.push(`${observation.category}: NO_REPAIR must use quantity 0 and an inspection evidence link.`);
      continue;
    }
    if (observation.severity !== "NO_REPAIR" && observation.quantity <= 0) {
      blockers.push(`${observation.category}: a positive measured quantity is required for a repair estimate.`);
      continue;
    }
    if (observation.unit === "LUMP_SUM" && observation.severity !== "NO_REPAIR" && observation.quantity !== 1) {
      blockers.push(`${observation.category}: LUMP_SUM quantity must be exactly 1.`);
      continue;
    }
    const evidence = observationEvidence(observation, lead, entries, now);
    if (!evidence) {
      blockers.push(`${observation.category}: link current, reviewed INSPECTION evidence for this category; assessor condition clues and model output cannot establish repair scope.`);
      continue;
    }
    const rate = observation.severity === "NO_REPAIR"
      ? null
      : rateFor(observation, marketKey, assumptions.repairRates, today);
    if (observation.severity !== "NO_REPAIR" && !rate) {
      blockers.push(`${observation.category}: no active, source-backed ${marketKey} rate exists for ${observation.severity} / ${observation.unit}. Add a current cost card; no default cost is assumed.`);
      continue;
    }
    lines.push(lineFor(observation, evidence, rate));
  }

  if (blockers.length) return { ...base, status: "BLOCKED", lines, blockers };
  const confidence = lines.length ? Math.min(...lines.map(line => line.confidence)) : 0;
  return {
    ...base,
    status: "CALCULATED",
    lines,
    total: {
      low: roundMoney(lines.reduce((sum, line) => sum + line.low, 0)),
      expected: roundMoney(lines.reduce((sum, line) => sum + line.expected, 0)),
      high: roundMoney(lines.reduce((sum, line) => sum + line.high, 0)),
      confidence,
    },
  };
}

export function repairsFromEstimate(estimate: RepairEstimate): Repair[] {
  if (estimate.status !== "CALCULATED") return [];
  return estimate.lines.map(line => ({
    category: line.category,
    low: line.low,
    expected: line.expected,
    high: line.high,
    confidence: line.confidence,
    source: line.source,
    evidenceId: line.evidenceId,
  }));
}

export function validateRepairRateCards(rates: RepairRateCard[], now = new Date()): void {
  const activeKeys = new Set<string>();
  const ids = new Set<string>();
  const today = now.toISOString().slice(0, 10);
  for (const rate of rates) {
    if (ids.has(rate.id)) throw new DomainError(`Duplicate repair rate card id: ${rate.id}.`);
    ids.add(rate.id);
    if (rate.lowRate > rate.expectedRate || rate.expectedRate > rate.highRate) {
      throw new DomainError(`Repair rate card ${rate.id}: require low ≤ expected ≤ high.`);
    }
    if (rate.validThrough < rate.capturedOn) throw new DomainError(`Repair rate card ${rate.id}: validity cannot end before its source date.`);
    if (rate.capturedOn > today) throw new DomainError(`Repair rate card ${rate.id}: source date cannot be in the future.`);
    if (!/^https?:\/\//i.test(rate.sourceUrl)) throw new DomainError(`Repair rate card ${rate.id}: use the actual http(s) source URL.`);
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/i.test(rate.marketKey.trim())) throw new DomainError(`Repair rate card ${rate.id}: use a normalized market key such as PHILADELPHIA-PA.`);
    if (rate.active) {
      const key = [normalized(rate.marketKey), normalized(rate.category), rate.severity, rate.unit].join("|");
      if (activeKeys.has(key)) throw new DomainError(`Only one active rate card may exist for ${rate.marketKey} / ${rate.category} / ${rate.severity} / ${rate.unit}.`);
      activeKeys.add(key);
    }
  }
}
