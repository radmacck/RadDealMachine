import type {
  Assumptions, ConditionRepairHypothesis, Intelligence, Lead,
  PreliminaryRepairEstimate, PreliminaryRepairLine, RepairRateCard,
} from "./types";
import { repairMarketKey } from "./repair-estimation";

const DAY = 86_400_000;
const MAX_SOURCE_AGE = 30 * DAY;
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const roundConfidence = (value: number) => Math.round(value * 1000) / 1000;
const normalized = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const RULES = [
  { id: "roof-replacement", category: "Roof", severity: "REPLACEMENT" as const, pattern: /\b(?:roof replacement|replace(?:ment)? of (?:the )?roof|needs? (?:a )?new roof|new roof (?:needed|required))\b/i },
  { id: "roof-leak", category: "Roof", severity: "MODERATE" as const, pattern: /\b(?:roof leaks?|leaking roof)\b/i },
  { id: "foundation-distress", category: "Foundation", severity: "MAJOR" as const, pattern: /\b(?:foundation (?:crack|movement|settling|bowing)|structural (?:crack|movement))\b/i },
  { id: "water-damage", category: "Water intrusion", severity: "MAJOR" as const, pattern: /\b(?:water damage|flood damage|water intrusion)\b/i },
  { id: "hvac-failure", category: "HVAC", severity: "MODERATE" as const, pattern: /\b(?:hvac (?:not working|failed|needs? replacement)|furnace (?:not working|failed)|no heat|no air conditioning)\b/i },
  { id: "plumbing-leak", category: "Plumbing", severity: "MODERATE" as const, pattern: /\b(?:plumbing leak|pipe (?:leak|burst)|burst pipe)\b/i },
  { id: "electrical-upgrade", category: "Electrical", severity: "MAJOR" as const, pattern: /\b(?:rewire|knob[- ]and[- ]tube|outdated electrical|electrical panel (?:replacement|needs? replacement))\b/i },
  { id: "interior-finishes", category: "Interior finishes", severity: "COSMETIC" as const, pattern: /\b(?:cosmetic (?:updates?|repairs?)|dated (?:kitchen|bathroom|interior)|needs? updating)\b/i },
] as const;

const severityRank = { COSMETIC: 1, MODERATE: 2, MAJOR: 3, REPLACEMENT: 4 } as const;

function isConditionEvidence(entry: Intelligence): boolean {
  return /condition|listing[ _-]?(?:remarks|description)|repair[ _-]?(?:clue|condition)|property[ _-]?observation/i.test(entry.category);
}

function negated(statement: string, index: number, match: string): boolean {
  const before = statement.slice(Math.max(0, index - 48), index);
  const after = statement.slice(index + match.length, index + match.length + 40);
  return /\b(?:no|not|without|never|free of|free from|does not|doesn't)\b(?:[\W_]+\w+){0,4}[\W_]*$/i.test(before)
    || /^\s*(?:is\s+)?(?:not present|not needed|not required|not confirmed|not verified|not observed|absent)\b/i.test(after);
}

function rateFor(
  category: string,
  severity: ConditionRepairHypothesis["severity"],
  rates: RepairRateCard[],
  marketKey: string,
  today: string,
): RepairRateCard | null {
  const matches = rates.filter(rate =>
    rate.active && normalized(rate.marketKey) === normalized(marketKey) &&
    normalized(rate.category) === normalized(category) && rate.severity === severity &&
    rate.unit === "LUMP_SUM" && rate.capturedOn <= today && rate.validThrough >= today,
  );
  if (matches.length > 1) throw new Error(`Conflicting active preliminary repair cards for ${category} / ${severity}.`);
  return matches[0] ?? null;
}

/**
 * Produces a separate, explicitly hypothetical scenario from current source
 * remarks. It never populates the inspected scope used by MAO.
 */
export function estimateConditionRepairHypotheses(
  lead: Lead,
  entries: Intelligence[],
  assumptions: Assumptions,
  now: Date,
): PreliminaryRepairEstimate {
  const marketKey = repairMarketKey(lead.city, lead.state);
  const base: PreliminaryRepairEstimate = {
    status: "NOT_USED", marketKey, catalogVersion: assumptions.repairRateCatalogVersion,
    calculatedAt: now.toISOString(), hypotheses: [], lines: [], total: null, blockers: [], sourceWarnings: [],
  };
  const sourceWarnings: string[] = [];
  const hypotheses: ConditionRepairHypothesis[] = [];
  const allowedSources = new Set(["PERMITTED_LISTING", "PUBLIC_PAGE", "PUBLIC_RECORD", "SELLER", "ANALYST"]);

  for (const entry of entries) {
    if (entry.leadId !== lead.id || !isConditionEvidence(entry)) continue;
    if (entry.sourceType === "MODEL" || entry.classification === "AI_HYPOTHESIS") {
      sourceWarnings.push(`Ignored model hypothesis ${entry.id}; an AI hypothesis cannot be recycled as condition evidence.`);
      continue;
    }
    if (!allowedSources.has(entry.sourceType)) continue;
    const captured = Date.parse(entry.capturedAt);
    const age = now.getTime() - captured;
    if (!Number.isFinite(age) || age < 0 || age >= MAX_SOURCE_AGE) {
      sourceWarnings.push(`Ignored stale or invalid condition source ${entry.id}; listing/public remarks must be refreshed within 30 days.`);
      continue;
    }
    const linkedSellerCall = entry.sourceType === "SELLER" &&
      typeof entry.sourceRecordId === "string" &&
      /^[a-f0-9-]{36}$/i.test(entry.sourceRecordId);
    if (!/^https?:\/\//i.test(entry.sourceUrl ?? "") && !linkedSellerCall) {
      sourceWarnings.push(`Ignored condition source ${entry.id}; a permitted HTTP(S) source link or linked seller-call evidence record is required.`);
      continue;
    }
    for (const rule of RULES) {
      const match = rule.pattern.exec(entry.statement);
      if (!match || negated(entry.statement, match.index, match[0])) continue;
      hypotheses.push({
        id: `${entry.id}:${rule.id}`,
        evidenceId: entry.id,
        sourceRecordId: entry.sourceRecordId ?? null,
        category: rule.category,
        severity: rule.severity,
        statement: entry.statement,
        evidenceClassification: entry.classification,
        epistemicStatus: "AI_HYPOTHESIS",
        sourceConfidence: entry.confidence,
        confidence: roundConfidence(Math.min(0.5, entry.confidence * 0.5)),
        confidenceMethod: "EXPLICIT_PHRASE_RULE_UNCALIBRATED",
        source: entry.source,
        sourceUrl: entry.sourceUrl ?? null,
        ruleId: rule.id,
        question: `Does a current inspection confirm the reported ${rule.category.toLowerCase()} condition?`,
        action: `Ask for or order a qualified inspection and link reviewed repair_scope:${rule.category} evidence. This hypothesis does not feed MAO.`,
      });
    }
  }

  const deduped = new Map<string, ConditionRepairHypothesis>();
  for (const hypothesis of hypotheses) deduped.set(hypothesis.id, hypothesis);
  const uniqueHypotheses = [...deduped.values()];
  if (!uniqueHypotheses.length) {
    return { ...base, sourceWarnings: [...new Set(sourceWarnings)].slice(0, 30) };
  }

  const byCategory = new Map<string, ConditionRepairHypothesis[]>();
  for (const hypothesis of uniqueHypotheses) {
    const key = normalized(hypothesis.category);
    byCategory.set(key, [...(byCategory.get(key) ?? []), hypothesis]);
  }

  const today = now.toISOString().slice(0, 10);
  const lines: PreliminaryRepairLine[] = [];
  const blockers: string[] = [];
  for (const categoryHypotheses of byCategory.values()) {
    const selectedSeverity = categoryHypotheses.reduce((selected, current) =>
      severityRank[current.severity] > severityRank[selected] ? current.severity : selected,
    categoryHypotheses[0]!.severity);
    const category = categoryHypotheses[0]!.category;
    const rate = rateFor(category, selectedSeverity, assumptions.repairRates, marketKey, today);
    if (!rate) {
      blockers.push(`${category}: no current source-backed ${marketKey} LUMP_SUM rate exists for the indicated ${selectedSeverity} scenario. No default rate is assumed.`);
      continue;
    }
    lines.push({
      category, severity: selectedSeverity,
      low: roundMoney(rate.lowRate), expected: roundMoney(rate.expectedRate), high: roundMoney(rate.highRate),
      confidence: Math.min(0.5, rate.confidence, ...categoryHypotheses.map(item => item.confidence)),
      rateCardId: rate.id, rateCardVersion: rate.version,
      hypothesisIds: categoryHypotheses.map(item => item.id),
      source: rate.source, sourceUrl: rate.sourceUrl,
    });
  }

  if (blockers.length) {
    return {
      ...base, status: "BLOCKED", hypotheses: uniqueHypotheses, lines,
      blockers, sourceWarnings: [...new Set(sourceWarnings)].slice(0, 30),
    };
  }
  return {
    ...base, status: "CALCULATED", hypotheses: uniqueHypotheses, lines,
    total: {
      low: roundMoney(lines.reduce((sum, line) => sum + line.low, 0)),
      expected: roundMoney(lines.reduce((sum, line) => sum + line.expected, 0)),
      high: roundMoney(lines.reduce((sum, line) => sum + line.high, 0)),
      confidence: Math.min(...lines.map(line => line.confidence)),
    },
    sourceWarnings: [...new Set(sourceWarnings)].slice(0, 30),
  };
}
