import type { z } from "zod";
import type { GetCommandCenterResponse } from "@workspace/api-zod";
import type { AcquisitionQueueItem, LeadDetail } from "./types";
import { classifyEvidenceFreshness, conflictingEvidence, evidenceResolutionAction, type EvidenceRecord } from "./evidence-integrity";

type CommandCenter = z.infer<typeof GetCommandCenterResponse>;
export type IntelligenceDecision = CommandCenter["decisions"][number];
export type DecisionAction = IntelligenceDecision["eligibleActions"][number];
export type DecisionActionDraft = Omit<DecisionAction, "workItemId" | "status">;
export type IntelligenceDecisionDraft = Omit<
  IntelligenceDecision,
  "evaluationId" | "snapshotHash" | "evaluatedAt" | "eligibleActions" | "blockedActions" | "recommendedAction"
> & {
  eligibleActions: DecisionActionDraft[];
  blockedActions: DecisionActionDraft[];
  recommendedAction: DecisionActionDraft | null;
};

export type DecisionOperations = {
  contract: { id: string; status: string; committedBuyerId: string | null; closingAt?: string | null } | null;
  matches: Array<{ buyerId: string; eligible: boolean }>;
  nextAction: string;
};

export type DecisionDiscovery = {
  id: string;
  status: string;
  leadId: string | null;
  address: string;
  reason: string;
  nextAction: string;
  observedAt: string | null;
  missingInformation: string[];
  signalRefs: string[];
};

export type IntelligenceLoopInput =
  | {
      subjectType: "LEAD";
      subjectId: string;
      leadId: string;
      discoveryId: string | null;
      detail: LeadDetail;
      acquisition: AcquisitionQueueItem | null;
      operations: DecisionOperations | null;
      synthetic?: boolean;
      now: Date;
    }
  | {
      subjectType: "DISCOVERY";
      subjectId: string;
      discoveryId: string;
      leadId: null;
      discovery: DecisionDiscovery;
      synthetic?: boolean;
      now: Date;
    };

const RULE_VERSION = "gap-aware-decision-v3-evidence-integrity";
const TERMINAL_STAGES = new Set(["CLOSED", "DEAD_DEAL", "PASS"]);
const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string =>
  typeof value === "string" && value.trim().length > 0).map(value => value.trim()))];
const ref = (prefix: string, id?: string | null) => id ? `${prefix}:${id}` : null;

function action(
  code: DecisionActionDraft["code"],
  gapKey: string,
  title: string,
  reason: string,
  href: string,
  responsibleRole: DecisionActionDraft["responsibleRole"],
  priority: number,
  requiresHumanAuthorization: boolean,
  evidenceRefs: string[],
  eligible = true,
): DecisionActionDraft {
  return {
    code, gapKey, title, reason, href, responsibleRole, priority,
    requiresHumanAuthorization, evidenceRefs: unique(evidenceRefs), eligible,
  };
}

function epistemicStatus(value: unknown): "VERIFIED" | "OBSERVED" | "INDICATED" | "AI_HYPOTHESIS" | "UNKNOWN" {
  return value === "VERIFIED" || value === "OBSERVED" || value === "INDICATED" || value === "AI_HYPOTHESIS"
    ? value
    : "UNKNOWN";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reconciliationConflict(value: unknown) {
  const state = String(record(record(value).reconciliation).state ?? "");
  return state === "CONFLICT_REVIEW" || state === "CONFLICTING" || record(record(value).reconciliation).conflict === true;
}

function leadEvidence(detail: LeadDetail, acquisition: AcquisitionQueueItem | null, now: Date) {
  const known: IntelligenceDecision["known"] = [];
  const conflicts: IntelligenceDecision["conflicts"] = [];
  const staleEvidence: IntelligenceDecision["staleEvidence"] = [];
  const provenanceGaps: string[] = [];
  const comparable: EvidenceRecord[] = [];
  const evidenceRefs: string[] = [ref("lead", detail.lead.id)!];

  for (const item of detail.lead.propertyQualification?.signals ?? []) {
    const evidenceRef = item.evidenceRef ?? `signal:${item.id}`;
    const normalized: EvidenceRecord = {
      ref:evidenceRef, factKey:`property.${item.key}`, value:item.statement,
      source:item.source, evidenceRef, observedAt:item.capturedAt, evidenceClass:"OBSERVED",
      confidence:item.confidence,
    };
    comparable.push(normalized);
    const freshness = classifyEvidenceFreshness(normalized, now, 180 * 86_400_000);
    const itemEvidence = {
      ref: evidenceRef,
      summary: `Observed property evidence · ${item.classification} ${item.key}: ${item.statement} · source ${item.source}`,
      epistemicStatus: epistemicStatus(item.classification),
      observedAt: item.capturedAt,
      freshness,
    };
    known.push(itemEvidence);
    evidenceRefs.push(evidenceRef);
    if (freshness === "STALE") staleEvidence.push({...itemEvidence,summary:`${itemEvidence.summary} · expired; re-verify before relying on it.`});
    if (freshness === "UNKNOWN") provenanceGaps.push(`${evidenceRef} needs valid source provenance and observed time.`);
  }
  for (const item of detail.intelligence) {
    const evidenceRef = `intelligence:${item.id}`;
    const observedAt = item.capturedAt;
    const isSeller = /seller|call/i.test(item.sourceType);
    const isBuyer = /buyer/i.test(item.sourceType);
    const source = item.source;
    const evidenceClass = isSeller ? "SELLER_REPORTED" : isBuyer ? "BUYER_REPORTED"
      : item.classification === "AI_HYPOTHESIS" ? "INFERRED" : "OBSERVED";
    const normalized: EvidenceRecord = {
      ref:evidenceRef, factKey:item.category.trim().toLowerCase(), value:item.statement,
      source, evidenceRef:item.sourceRecordId ?? evidenceRef, observedAt, evidenceClass,
      confidence:item.confidence,
    };
    comparable.push(normalized);
    const freshness = classifyEvidenceFreshness(normalized, now,
      isSeller || isBuyer ? 30 * 86_400_000 : undefined);
    const evidence = {
      ref: evidenceRef,
      summary: `${isSeller ? "Seller-reported" : isBuyer ? "Buyer-reported" : evidenceClass === "INFERRED" ? "Inferred" : "Observed"} ${item.category} · ${item.statement} · source ${item.source} · confidence ${Math.round(item.confidence * 100)}%`,
      epistemicStatus: isSeller || isBuyer ? "INDICATED" as const
        : evidenceClass === "INFERRED" ? "AI_HYPOTHESIS" as const : epistemicStatus(item.classification),
      observedAt,
      freshness,
    };
    known.push(evidence);
    evidenceRefs.push(evidenceRef);
    if (reconciliationConflict(item)) conflicts.push(evidence);
    if (freshness === "STALE") staleEvidence.push({...evidence,summary:`${evidence.summary} · expired; re-verify before relying on it.`});
    if (freshness === "UNKNOWN") provenanceGaps.push(`${evidenceRef} needs valid source provenance and observed time.`);
  }
  for (const item of conflictingEvidence(comparable)) {
    const found = known.find(candidate => candidate.ref === item.ref);
    if (found && !conflicts.some(candidate => candidate.ref === found.ref)) conflicts.push(found);
  }
  for (const call of detail.calls) evidenceRefs.push(`call:${call.id}`);
  if (detail.analysisSnapshotId) {
    const analysisRef = `analysis:${detail.analysisSnapshotId}`;
    evidenceRefs.push(analysisRef);
    const parsedAt = detail.analysis ? Date.parse(detail.analysis.calculatedAt) : Number.NaN;
    const freshness = classifyEvidenceFreshness({
      source: "deterministic underwriting", evidenceRef: detail.analysisSnapshotId,
      observedAt: detail.analysis?.calculatedAt ?? null,
    }, now, 7 * 86_400_000);
    const isStale = freshness !== "CURRENT";
    if (isStale) staleEvidence.push({
      ref: analysisRef, summary: "Underwriting snapshot is stale or has an invalid calculation time.",
      epistemicStatus: "OBSERVED", observedAt: detail.analysis?.calculatedAt ?? null, freshness: "STALE",
    });
    else known.push({
      ref: analysisRef,
      summary: `Estimated deterministic underwriting snapshot · ${detail.analysis?.classification ?? "unknown"} · ARV, repairs and MAO are governed by saved inputs.`,
      epistemicStatus: "OBSERVED", observedAt: detail.analysis?.calculatedAt ?? null, freshness: "CURRENT",
    });
  }
  if (acquisition?.contactReadiness) {
    const readiness = acquisition.contactReadiness;
    for (const route of readiness.contactPaths ?? []) {
      const routeRef = `contact-route:${route.id}`;
      evidenceRefs.push(routeRef);
      const normalized: EvidenceRecord = {
        ref:routeRef,factKey:`contact.${route.channel}`,value:route.recipient ?? "unknown",
        source:route.sourceName,evidenceRef:route.sourceRecordId,observedAt:route.capturedAt,
        validUntil:route.freshUntilAt,confidence:route.confidence,evidenceClass:"OBSERVED",
      };
      comparable.push(normalized);
      const freshness = classifyEvidenceFreshness(normalized,now);
      const evidence = {
        ref: routeRef,
        summary: `Observed ${route.channel} contact evidence · recipient ${route.recipient ?? "unknown"} · ${route.routeVerificationStatus} · source ${route.sourceName} · confidence ${Math.round(route.confidence * 100)}%.`,
        epistemicStatus: epistemicStatus(route.classification),
        observedAt: route.capturedAt,
        freshness,
      } as IntelligenceDecision["known"][number];
      known.push(evidence);
      if (freshness === "STALE") staleEvidence.push({...evidence,summary:`${evidence.summary} · expired; re-verify before contacting.`});
      if (freshness === "UNKNOWN") provenanceGaps.push(`${routeRef} needs valid source provenance and observed time.`);
    }
    const selected = readiness.selectedPhonePath;
    if (selected?.id) evidenceRefs.push(`contact-route:${selected.id}`);
    if (readiness.directRouteStatus === "STALE_ROUTE") staleEvidence.push({
      ref: selected?.id ? `contact-route:${selected.id}` : "contact-route:stale",
      summary: "The selected seller contact route is stale.",
      epistemicStatus: "OBSERVED", observedAt: selected?.capturedAt ?? null, freshness: "STALE",
    });
  }
  const supersededStaleRefs = new Set<string>();
  for (const old of comparable) {
    const oldMaxAge = old.evidenceClass === "SELLER_REPORTED" || old.evidenceClass === "BUYER_REPORTED"
      ? 30 * 86_400_000 : undefined;
    if (classifyEvidenceFreshness(old, now, oldMaxAge) !== "STALE") continue;
    const oldAt = Date.parse(old.observedAt ?? "");
    const reverified = comparable.some(current => {
      const currentMaxAge = current.evidenceClass === "SELLER_REPORTED" || current.evidenceClass === "BUYER_REPORTED"
        ? 30 * 86_400_000 : undefined;
      return current.factKey === old.factKey
        && current.value.trim().toLocaleLowerCase() === old.value.trim().toLocaleLowerCase()
        && Date.parse(current.observedAt ?? "") > oldAt
        && classifyEvidenceFreshness(current, now, currentMaxAge) === "CURRENT";
    });
    if (reverified) supersededStaleRefs.add(old.ref);
  }
  for (const item of known) if (supersededStaleRefs.has(item.ref)) {
    item.summary += " · historical evidence retained; a later same-valued record re-verifies this fact.";
  }
  return {
    known: known.sort((a, b) => a.ref.localeCompare(b.ref)),
    conflicts: conflicts.sort((a, b) => a.ref.localeCompare(b.ref)),
    staleEvidence: staleEvidence.filter(item => !supersededStaleRefs.has(item.ref)).sort((a, b) => a.ref.localeCompare(b.ref)),
    provenanceGaps: [...new Set(provenanceGaps)].sort(),
    evidenceRefs: unique(evidenceRefs).sort(),
  };
}

function decideDiscovery(input: Extract<IntelligenceLoopInput, { subjectType: "DISCOVERY" }>): IntelligenceDecisionDraft {
  const { discovery } = input;
  const evidenceRefs = unique([`discovery:${discovery.id}`, ...discovery.signalRefs]).sort();
  const currentState = discovery.status;
  const terminal = ["DISQUALIFIED", "PASS"].includes(discovery.status);
  const next = terminal ? null : action(
    discovery.status === "DISCOVERED_PROPERTY" ? "QUALIFY_DISCOVERY" : "REVIEW_CANDIDATE",
    `${discovery.status}:review`,
    discovery.status === "DISCOVERED_PROPERTY" ? `Review discovery at ${discovery.address}` : `Review relevance at ${discovery.address}`,
    discovery.reason || "A public property record is a discovery, not an active acquisition lead.",
    `/sources?discovery=${encodeURIComponent(discovery.id)}`,
    "ANALYST", discovery.status === "DISCOVERED_PROPERTY" ? 45 : 65, false, evidenceRefs,
  );
  const unknowns = unique([
    ...discovery.missingInformation,
    "No seller identity or signing authority is established by property-source ownership evidence.",
    "No permitted direct seller contact route is attached to this discovery.",
  ]);
  const blockedCall = action(
    "CALL_NEXT", `discovery:${discovery.id}:not-call-ready`, "Call seller",
    "A raw discovery or relevance candidate is not a callable lead; direct contact, identity review and underwriting gates are not satisfied.",
    `/sources?discovery=${encodeURIComponent(discovery.id)}`, "OPERATOR", 0, true, evidenceRefs, false,
  );
  const outcomeRecord = terminal ? `${discovery.status} is retained as the discovery disposition; it is not promoted to a lead.` : null;
  return {
    subjectType: "DISCOVERY", subjectId: discovery.id, leadId: null, discoveryId: discovery.id,
    ruleVersion: RULE_VERSION, currentState,
    known: [{
      ref: `discovery:${discovery.id}`,
      summary: `${discovery.status} source record · ${discovery.address}. ${discovery.reason}`,
      epistemicStatus: "OBSERVED", observedAt: discovery.observedAt, freshness: "UNKNOWN",
    }],
    unknowns,
    conflicts: [],
    staleEvidence: [],
    eligibleActions: next ? [next] : [],
    blockedActions: [blockedCall],
    recommendedAction: next,
    humanAuthorizationRequired: next?.requiresHumanAuthorization ?? false,
    evidenceRefs,
    outcomeRecord,
  };
}

function newestSellerCategory(detail: LeadDetail, categoryPart: string) {
  return detail.intelligence.find(item =>
    /seller|call/i.test(item.sourceType) && item.category.toLowerCase().includes(categoryPart));
}

function chooseLeadAction(input: Extract<IntelligenceLoopInput, { subjectType: "LEAD" }>, common: ReturnType<typeof leadEvidence>) {
  const { detail, acquisition, operations } = input;
  const lead = detail.lead;
  const evidenceRefs = common.evidenceRefs;
  const conflicts = common.conflicts;
  if (TERMINAL_STAGES.has(lead.stage)) return null;

  if (conflicts.length || acquisition?.blockerCode === "CONTACT_CONFLICT") {
    const evidence = conflicts.map(item => item.ref);
    return action(
      "RECONCILE_EVIDENCE", `lead:${lead.id}:evidence-conflict`,
      "Resolve conflicting evidence",
      "Conflicting evidence is preserved; a reviewer must reconcile it before relying on the affected fact or contact route.",
      `/leads/${lead.id}`, "ANALYST", 118, true, [...evidenceRefs, ...evidence],
    );
  }
  if (common.provenanceGaps.length) return action(
    "RECONCILE_EVIDENCE", `lead:${lead.id}:evidence-provenance`,
    "Repair missing evidence provenance",
    evidenceResolutionAction(0,0,common.provenanceGaps.length) ?? "Add source provenance before relying on evidence.",
    `/leads/${lead.id}`, "ANALYST", 119, true, evidenceRefs,
  );
  if (common.staleEvidence.length) return action(
    "REFRESH_SOURCE_EVIDENCE", `lead:${lead.id}:stale-evidence:${common.staleEvidence.map(item=>item.ref).join(",")}`,
    "Re-verify expired evidence",
    evidenceResolutionAction(common.staleEvidence.length,0,0) ?? "Refresh expired evidence before dependent actions.",
    `/deals/${lead.id}?work=research`, "ANALYST", 120, false,
    [...evidenceRefs,...common.staleEvidence.map(item=>item.ref)],
  );

  const contract = operations?.contract;
  if (contract && !["CLOSED", "CANCELLED"].includes(contract.status)) {
    const contractRef = `contract:${contract.id}`;
    const refs = [...evidenceRefs, contractRef];
    const closingAt = contract.closingAt ? Date.parse(contract.closingAt) : Number.NaN;
    const timeToClose = closingAt - input.now.getTime();
    if (Number.isFinite(closingAt) && timeToClose <= 72 * 60 * 60_000) {
      const timing = timeToClose < 0 ? "The recorded closing deadline is overdue."
        : "The recorded closing deadline is within 72 hours.";
      return action(
        "TRANSACTION_NEXT", `contract:${contract.id}:closing-deadline:${contract.closingAt}`,
        "Resolve the closing deadline",
        `${timing} Review the current signed-document, funds, title and milestone evidence before changing transaction state.`,
        `/deals/${lead.id}?work=transaction`, "OWNER", 130, true, refs,
      );
    }
    if (contract.committedBuyerId) {
      return action(
        "TRANSACTION_NEXT", `contract:${contract.id}:transaction-progress`,
        operations?.nextAction || "Advance the recorded transaction milestone",
        "A committed buyer is recorded. Advance only the next transaction step supported by current signed-document, funds and closing evidence.",
        `/deals/${lead.id}?work=transaction`, "OWNER", 112, true, refs,
      );
    }
    if (!operations?.matches.some(match => match.eligible)) {
      return action(
        "BUYER_DEMAND", `contract:${contract.id}:no-current-match`,
        "Review current buyer demand",
        "No current eligible buyer match is recorded for this active transaction; interest and stale buyer records do not count as commitment.",
        `/buyers`, "OWNER", 105, false, refs,
      );
    }
    return action(
      "TRANSACTION_NEXT", `contract:${contract.id}:buyer-review`,
      operations.nextAction || "Review eligible buyers for this transaction",
      "Current eligible matches are recorded; owner review is still required before distribution or commitment.",
      `/deals/${lead.id}?work=transaction`, "OWNER", 100, true, refs,
    );
  }

  const draftOffer = detail.offers.find(offer => offer.effectiveStatus === "DRAFT");
  if (draftOffer) return action(
    "AUTHORIZE_OFFER", `offer:${draftOffer.id}:owner-review`,
    "Review exact offer terms",
    "An offer draft exists; only explicit owner approval of its current version can authorize communication.",
    `/deals/${lead.id}?work=offers`, "OWNER", 100, true, [...evidenceRefs, `offer:${draftOffer.id}`],
  );

  const blockerCode = acquisition?.blockerCode;
  if (["CONTACT_CONFLICT", "CONTACT_REVIEW"].includes(String(blockerCode))) {
    return action(
      "REVIEW_CONTACT_CONFLICT", `lead:${lead.id}:contact-review`,
      "Review seller contact evidence",
      acquisition?.blocker ?? "Recipient identity, permission or freshness requires review before seller contact.",
      `/deals/${lead.id}?work=intel`, "ANALYST", 110, true, evidenceRefs,
    );
  }
  if (blockerCode === "CONTACT_STALE") return action(
    "REFRESH_CONTACT", `lead:${lead.id}:stale-contact`,
    "Refresh the seller contact route",
    acquisition?.blocker ?? "The direct route is stale and cannot support CALL NEXT.",
    `/leads/${lead.id}`, "ANALYST", 105, false, evidenceRefs,
  );
  if (blockerCode?.startsWith("CONTACT_") || acquisition?.contactReadiness.directRouteStatus === "NO_DIRECT_ROUTE"
    || acquisition?.contactReadiness.directRouteStatus === "POSTAL_ONLY") {
    return action(
      "RESEARCH_CONTACT", `lead:${lead.id}:direct-contact`,
      "Find permitted direct seller contact evidence",
      acquisition?.blocker ?? "No permitted direct seller phone route is recorded; a mailing address is not a call route.",
      `/leads/${lead.id}`, "ANALYST", 100, false, evidenceRefs,
    );
  }

  if (acquisition?.decision === "CALL_NEXT") return action(
    "CALL_NEXT", `lead:${lead.id}:call-next`,
    `Call ${lead.sellerName}`,
    "The current qualification, direct-contact and underwriting gates pass; the operator must still place and record the call.",
    `/calls?lead=${encodeURIComponent(lead.id)}`, "OPERATOR", 110, true, evidenceRefs,
  );

  const sellerCondition = newestSellerCategory(detail, "condition") ?? newestSellerCategory(detail, "repair");
  const sellerPrice = newestSellerCategory(detail, "asking_price") ?? newestSellerCategory(detail, "price_expectation");
  if (sellerCondition && (!detail.analysis || Date.parse(sellerCondition.createdAt) > Date.parse(detail.analysis.calculatedAt))) {
    return action(
      "GATHER_REPAIR_EVIDENCE", `lead:${lead.id}:seller-condition:${sellerCondition.id}`,
      "Verify the seller-reported condition change",
      "A seller-reported condition statement is INDICATED evidence. Confirm it and refresh condition-based repair inputs before relying on prior economics.",
      `/leads/${lead.id}?work=research`, "ANALYST", 105, false, [...evidenceRefs, `intelligence:${sellerCondition.id}`],
    );
  }
  if (sellerPrice && (!detail.analysis || Date.parse(sellerPrice.createdAt) > Date.parse(detail.analysis.calculatedAt))) {
    return action(
      "RECALCULATE_UNDERWRITING", `lead:${lead.id}:seller-price:${sellerPrice.id}`,
      "Recalculate economics from the seller's stated price",
      "The seller's price statement is INDICATED intent, not an authorized term. Create a new deterministic analysis version before any new offer review.",
      `/deals/${lead.id}?work=research`, "ANALYST", 104, false, [...evidenceRefs, `intelligence:${sellerPrice.id}`],
    );
  }

  if (blockerCode === "UNDERWRITING_STALE" || common.staleEvidence.length > 0) return action(
    "REFRESH_SOURCE_EVIDENCE", `lead:${lead.id}:stale-underwriting`,
    "Refresh stale evidence and underwriting",
    acquisition?.blocker ?? "A stale or invalid evidence snapshot cannot support current offer or call decisions.",
    `/deals/${lead.id}?work=research`, "ANALYST", 100, false, evidenceRefs,
  );

  if (!detail.analysis || blockerCode === "UNDERWRITING_MISSING" || blockerCode === "UNDERWRITING_BLOCKED") {
    const currentUnderwriting = record(detail.underwriting);
    const comps = Array.isArray(currentUnderwriting.comps) ? currentUnderwriting.comps : [];
    const repairs = Array.isArray(currentUnderwriting.repairs) ? currentUnderwriting.repairs : [];
    const repairObservations = Array.isArray(currentUnderwriting.repairObservations) ? currentUnderwriting.repairObservations : [];
    const nextText = `${lead.nextAction} ${(detail.analysis?.blockers ?? []).join(" ")}`.toLowerCase();
    if (nextText.includes("comp") || (!comps.length && !detail.analysis)) return action(
      "RESEARCH_COMPS", `lead:${lead.id}:comps`,
      "Research supported comparable sales",
      "ARV needs source-backed comparable sales with applicable geography, recency, size and condition support.",
      `/deals/${lead.id}?work=research`, "ANALYST", 95, false, evidenceRefs,
    );
    if (nextText.includes("rate") || nextText.includes("repair") || (!repairs.length && !repairObservations.length)) return action(
      "GATHER_REPAIR_EVIDENCE", `lead:${lead.id}:repairs`,
      "Complete condition-backed repair inputs",
      "Repair totals require current condition evidence and configured rates; missing inputs remain unknown rather than being invented.",
      `/deals/${lead.id}?work=research`, "ANALYST", 95, false, evidenceRefs,
    );
    return action(
      "RECALCULATE_UNDERWRITING", `lead:${lead.id}:underwriting`,
      "Recalculate deterministic underwriting",
      acquisition?.blocker ?? "The current underwriting snapshot is incomplete or blocked.",
      `/deals/${lead.id}?work=research`, "ANALYST", 90, false, evidenceRefs,
    );
  }

  if (blockerCode === "FOLLOW_UP_NOT_DUE") return action(
    "REVIEW_FOLLOW_UP", `lead:${lead.id}:follow-up-not-due`,
    "Wait for the scheduled seller follow-up",
    acquisition?.blocker ?? "The saved follow-up time has not arrived; do not call early.",
    `/leads/${lead.id}`, "OPERATOR", 40, true, evidenceRefs,
  );
  if (detail.workGuidance?.category === "NEGOTIATION") return action(
    "REVIEW_SELLER_RESPONSE", `lead:${lead.id}:seller-response`,
    detail.workGuidance.title, detail.workGuidance.why, detail.workGuidance.href,
    "OWNER", detail.workGuidance.priority, true, evidenceRefs,
  );
  if (detail.workGuidance?.category === "CONTRACT" || detail.workGuidance?.category === "CLOSING") return action(
    "TRANSACTION_NEXT", `lead:${lead.id}:transaction-next`,
    detail.workGuidance.title, detail.workGuidance.why, detail.workGuidance.href,
    "OWNER", detail.workGuidance.priority, true, evidenceRefs,
  );
  const guidance = detail.workGuidance;
  return action(
    "RECONCILE_EVIDENCE", `lead:${lead.id}:review-state`,
    guidance?.title ?? lead.nextAction,
    guidance?.why ?? "Continue only from persisted state and evidence; no facts are inferred.",
    guidance?.href ?? `/leads/${lead.id}`, guidance?.responsibleRole ?? "ANALYST",
    guidance?.priority ?? 50, false, evidenceRefs,
  );
}

function decideLead(input: Extract<IntelligenceLoopInput, { subjectType: "LEAD" }>): IntelligenceDecisionDraft {
  const { detail, acquisition, operations, now } = input;
  const lead = detail.lead;
  const common = leadEvidence(detail, acquisition, now);
  const currentState = lead.stage;
  const terminal = TERMINAL_STAGES.has(lead.stage);
  const selected = chooseLeadAction(input, common);
  const evidenceRefs = unique([
    ...common.evidenceRefs,
    ...(operations?.contract ? [`contract:${operations.contract.id}`] : []),
    ...(operations?.matches ?? []).filter(match => match.eligible).map(match => `buyer-match:${lead.id}:${match.buyerId}`),
  ]).sort();
  const unknowns = unique([
    ...common.provenanceGaps,
    ...((acquisition?.blockerCode && acquisition.blocker) ? [acquisition.blocker] : []),
    ...(detail.workGuidance?.missingFacts ?? []),
    ...(detail.analysis?.blockers ?? []),
    ...(detail.lead.propertyQualification?.missingInformation ?? []),
  ]);
  if (operations?.contract && !operations.contract.committedBuyerId
    && !operations.matches.some(match => match.eligible)
    && !["CLOSED", "CANCELLED"].includes(operations.contract.status)) {
    unknowns.push("No current approved buyer match is recorded for the active contract.");
  }
  const blocked: DecisionActionDraft[] = [];
  if (!terminal && acquisition?.decision !== "CALL_NEXT") {
    blocked.push(action(
      "CALL_NEXT", `lead:${lead.id}:call-gate`,
      `Call ${lead.sellerName}`,
      acquisition?.blocker ?? "The lead does not currently pass the seller contact and underwriting gates.",
      `/leads/${lead.id}`, "OPERATOR", 0, true,
      [...evidenceRefs, ...(acquisition?.blockerCode ? [`blocker:${acquisition.blockerCode}`] : [])], false,
    ));
  }
  const outcomeRecord = terminal
    ? (() => {
        const transition = [...detail.transitions].reverse().find(item => item.to === lead.stage);
        return `${lead.stage} recorded${transition ? ` by ${transition.actor} at ${transition.createdAt}: ${transition.reason}` : ""}. Terminal work is closed; no stale action is kept active.`;
      })()
    : null;
  return {
    subjectType: "LEAD", subjectId: lead.id, leadId: lead.id,
    discoveryId: lead.propertyQualification?.discoveryId ?? null,
    ruleVersion: RULE_VERSION, currentState,
    known: common.known,
    unknowns: unique(unknowns),
    conflicts: common.conflicts,
    staleEvidence: common.staleEvidence,
    eligibleActions: selected && !terminal ? [selected] : [],
    blockedActions: blocked,
    recommendedAction: selected && !terminal ? selected : null,
    humanAuthorizationRequired: selected?.requiresHumanAuthorization ?? false,
    evidenceRefs,
    outcomeRecord,
  };
}

export function evaluateIntelligenceLoop(input: IntelligenceLoopInput): IntelligenceDecisionDraft {
  return input.subjectType === "DISCOVERY" ? decideDiscovery(input) : decideLead(input);
}

export const intelligenceDecisionRuleVersion = RULE_VERSION;
