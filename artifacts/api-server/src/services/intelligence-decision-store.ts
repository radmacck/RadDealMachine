import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  auditTable,
  db,
  dealDecisionEvaluationsTable,
  dealDecisionWorkItemsTable,
} from "@workspace/db";
import { GetCommandCenterResponse } from "@workspace/api-zod";
import {
  evaluateIntelligenceLoop,
  type DecisionActionDraft,
  type IntelligenceDecision,
  type IntelligenceLoopInput,
} from "@workspace/deal-domain";
import type { Store } from "./operations-records";

type WorkStatus = "READY" | "BLOCKED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "EXPIRED";

function hashSnapshot(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameJson(a: unknown, b: unknown) {
  return isDeepStrictEqual(a, b);
}

async function auditDecision(
  tx: Store,
  actor: string,
  action: string,
  subjectId: string,
  detail: string,
  now: Date,
) {
  await tx.insert(auditTable).values({ actor, action, entityId: subjectId, detail, createdAt: now });
}

function workKey(subjectType: string, subjectId: string, item: Pick<DecisionActionDraft, "code" | "gapKey">) {
  return `${subjectType}:${subjectId}:${item.code}:${item.gapKey}`;
}

function resolutionStatus(
  input: IntelligenceLoopInput,
  actionCode: string,
  updatedAt: Date,
): WorkStatus {
  if (input.subjectType !== "LEAD") return "EXPIRED";
  const { detail, acquisition } = input;
  if (["CLOSED", "DEAD_DEAL", "PASS"].includes(detail.lead.stage)) return "EXPIRED";
  if (["RESEARCH_CONTACT", "REFRESH_CONTACT"].includes(actionCode)) {
    return acquisition?.contactReadiness.directRouteStatus === "PHONE_ROUTE_AVAILABLE" ? "COMPLETED" : "EXPIRED";
  }
  if (["RESEARCH_COMPS", "GATHER_REPAIR_EVIDENCE", "RECALCULATE_UNDERWRITING", "REFRESH_SOURCE_EVIDENCE"].includes(actionCode)) {
    return detail.analysis && !["UNDERWRITING_MISSING", "UNDERWRITING_STALE", "UNDERWRITING_BLOCKED"].includes(String(acquisition?.blockerCode))
      ? "COMPLETED"
      : "EXPIRED";
  }
  if (actionCode === "CALL_NEXT") {
    return detail.calls.some(call => Date.parse(call.createdAt) > updatedAt.getTime()) ? "COMPLETED" : "EXPIRED";
  }
  return "EXPIRED";
}

async function ensureWorkItem(
  tx: Store,
  input: IntelligenceLoopInput,
  evaluationId: string,
  item: DecisionActionDraft,
  desiredStatus: WorkStatus,
  actor: string,
  now: Date,
) {
  const idempotencyKey = workKey(input.subjectType, input.subjectId, item);
  const [existing] = await tx.select().from(dealDecisionWorkItemsTable)
    .where(eq(dealDecisionWorkItemsTable.idempotencyKey, idempotencyKey)).limit(1);
  const payload = { ...item, synthetic: input.synthetic === true };
  if (!existing) {
    const [created] = await tx.insert(dealDecisionWorkItemsTable).values({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      leadId: input.leadId,
      discoveryId: input.discoveryId,
      evaluationId,
      actionCode: item.code,
      gapKey: item.gapKey,
      idempotencyKey,
      status: desiredStatus,
      reason: item.reason,
      evidenceRefs: item.evidenceRefs,
      payload,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!created) throw new Error("Decision work item insert failed.");
    await auditDecision(tx, actor, `DECISION_ACTION_${desiredStatus}`, input.subjectId,
      `${item.code}/${item.gapKey}: ${item.reason}`, now);
    return created;
  }
  const nextStatus: WorkStatus = existing.status === "IN_PROGRESS" && desiredStatus === "READY"
    ? "IN_PROGRESS" : desiredStatus;
  const changed = existing.status !== nextStatus
    || existing.evaluationId !== evaluationId
    || existing.reason !== item.reason
    || !sameJson(existing.payload, payload)
    || !sameJson(existing.evidenceRefs, item.evidenceRefs);
  if (!changed) return existing;
  const [updated] = await tx.update(dealDecisionWorkItemsTable).set({
    evaluationId,
    status: nextStatus,
    reason: item.reason,
    evidenceRefs: item.evidenceRefs,
    payload,
    updatedAt: now,
  }).where(eq(dealDecisionWorkItemsTable.id, existing.id)).returning();
  if (!updated) throw new Error("Decision work item update failed.");
  if (existing.status !== nextStatus) {
    await auditDecision(tx, actor, `DECISION_ACTION_${nextStatus}`, input.subjectId,
      `${item.code}/${item.gapKey}: ${existing.status} -> ${nextStatus}. ${item.reason}`, now);
  }
  return updated;
}

async function persist(input: IntelligenceLoopInput, actor: string, tx: Store, now: Date) {
  const draft = evaluateIntelligenceLoop(input);
  const snapshotHash = hashSnapshot({ decision: draft, synthetic: input.synthetic === true });
  let [evaluation] = await tx.select().from(dealDecisionEvaluationsTable).where(and(
    eq(dealDecisionEvaluationsTable.subjectType, input.subjectType),
    eq(dealDecisionEvaluationsTable.subjectId, input.subjectId),
    eq(dealDecisionEvaluationsTable.snapshotHash, snapshotHash),
  )).limit(1);
  if (!evaluation) {
    [evaluation] = await tx.insert(dealDecisionEvaluationsTable).values({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      leadId: input.leadId,
      discoveryId: input.discoveryId,
      snapshotHash,
      ruleVersion: draft.ruleVersion,
      evaluatedBy: actor,
      payload: { decision: draft, synthetic: input.synthetic === true },
      createdAt: now,
    }).onConflictDoNothing().returning();
    if (!evaluation) {
      [evaluation] = await tx.select().from(dealDecisionEvaluationsTable).where(and(
        eq(dealDecisionEvaluationsTable.subjectType, input.subjectType),
        eq(dealDecisionEvaluationsTable.subjectId, input.subjectId),
        eq(dealDecisionEvaluationsTable.snapshotHash, snapshotHash),
      )).limit(1);
    } else {
      await auditDecision(tx, actor, "INTELLIGENCE_DECISION_EVALUATED", input.subjectId,
        `${draft.ruleVersion} ${input.subjectType}: ${draft.currentState}; next=${draft.recommendedAction?.code ?? "NONE"}; evidence=${draft.evidenceRefs.length}.`,
        now);
    }
  }
  if (!evaluation) throw new Error("Decision evaluation could not be created or read.");

  const actions = [
    ...draft.eligibleActions.map(item => ({ item, status: "READY" as const })),
    ...draft.blockedActions.map(item => ({ item, status: "BLOCKED" as const })),
  ];
  const currentKeys = new Set(actions.map(({ item }) => workKey(input.subjectType, input.subjectId, item)));
  const persistedActions = new Map<string, Awaited<ReturnType<typeof ensureWorkItem>>>();
  for (const { item, status } of actions) {
    const row = await ensureWorkItem(tx, input, evaluation.id, item, status, actor, now);
    persistedActions.set(workKey(input.subjectType, input.subjectId, item), row);
  }

  if (draft.outcomeRecord) {
    const outcome: DecisionActionDraft = {
      code: "RECORD_OUTCOME",
      gapKey: `${input.subjectType}:${input.subjectId}:terminal-outcome`,
      eligible: false,
      priority: 0,
      title: "Terminal outcome retained",
      reason: draft.outcomeRecord,
      href: input.subjectType === "LEAD" ? `/leads/${input.subjectId}` : `/sources?discovery=${input.subjectId}`,
      responsibleRole: "OWNER",
      requiresHumanAuthorization: false,
      evidenceRefs: draft.evidenceRefs,
    };
    const outcomeRow = await ensureWorkItem(tx, input, evaluation.id, outcome, "COMPLETED", actor, now);
    persistedActions.set(workKey(input.subjectType, input.subjectId, outcome), outcomeRow);
    currentKeys.add(workKey(input.subjectType, input.subjectId, outcome));
  }

  const oldOpen = await tx.select().from(dealDecisionWorkItemsTable).where(and(
    eq(dealDecisionWorkItemsTable.subjectType, input.subjectType),
    eq(dealDecisionWorkItemsTable.subjectId, input.subjectId),
    inArray(dealDecisionWorkItemsTable.status, ["READY", "BLOCKED", "IN_PROGRESS"]),
  ));
  for (const old of oldOpen) {
    if (currentKeys.has(old.idempotencyKey)) continue;
    const nextStatus = resolutionStatus(input, old.actionCode, old.updatedAt);
    const [updated] = await tx.update(dealDecisionWorkItemsTable).set({
      status: nextStatus,
      updatedAt: now,
      payload: { ...old.payload, resolvedByEvaluation: evaluation.id },
    }).where(eq(dealDecisionWorkItemsTable.id, old.id)).returning();
    if (updated) await auditDecision(tx, actor, `DECISION_ACTION_${nextStatus}`, input.subjectId,
      `${old.actionCode}/${old.gapKey}: ${old.status} -> ${nextStatus}; superseded by evidence snapshot ${snapshotHash.slice(0, 12)}.`,
      now);
  }

  const workAction = (item: DecisionActionDraft) => {
    const row = persistedActions.get(workKey(input.subjectType, input.subjectId, item));
    if (!row) throw new Error(`Persisted decision action is missing: ${item.code}/${item.gapKey}`);
    return {
      ...item,
      workItemId: row.id,
      status: row.status as WorkStatus,
    };
  };
  const decision: IntelligenceDecision = {
    ...draft,
    evaluationId: evaluation.id,
    snapshotHash,
    evaluatedAt: evaluation.createdAt.toISOString(),
    eligibleActions: draft.eligibleActions.map(workAction),
    blockedActions: draft.blockedActions.map(workAction),
    recommendedAction: draft.recommendedAction ? workAction(draft.recommendedAction) : null,
  };
  return GetCommandCenterResponse.shape.decisions.element.parse(decision);
}

export async function persistIntelligenceDecision(input: IntelligenceLoopInput, actor: string, now = new Date()) {
  return db.transaction(tx => persist(input, actor, tx, now));
}

export async function latestIntelligenceDecision(subjectType: string, subjectId: string): Promise<IntelligenceDecision | null> {
  const [evaluation] = await db.select().from(dealDecisionEvaluationsTable).where(and(
    eq(dealDecisionEvaluationsTable.subjectType, subjectType),
    eq(dealDecisionEvaluationsTable.subjectId, subjectId),
  )).orderBy(desc(dealDecisionEvaluationsTable.createdAt)).limit(1);
  if (!evaluation) return null;
  const payload = evaluation.payload.decision as Record<string, unknown>;
  const work = await db.select().from(dealDecisionWorkItemsTable).where(and(
    eq(dealDecisionWorkItemsTable.subjectType, subjectType),
    eq(dealDecisionWorkItemsTable.subjectId, subjectId),
    eq(dealDecisionWorkItemsTable.evaluationId, evaluation.id),
  ));
  const byKey = new Map(work.map(row => [row.idempotencyKey, row]));
  const decorate = (value: unknown) => {
    const item = value as DecisionActionDraft;
    const row = byKey.get(workKey(subjectType, subjectId, item));
    return row ? { ...item, workItemId: row.id, status: row.status as WorkStatus } : null;
  };
  const eligibleActions = ((payload.eligibleActions ?? []) as DecisionActionDraft[]).map(decorate).filter(Boolean);
  const blockedActions = ((payload.blockedActions ?? []) as DecisionActionDraft[]).map(decorate).filter(Boolean);
  const recommendation = payload.recommendedAction ? decorate(payload.recommendedAction) : null;
  return GetCommandCenterResponse.shape.decisions.element.parse({
    ...payload,
    evaluationId: evaluation.id,
    snapshotHash: evaluation.snapshotHash,
    evaluatedAt: evaluation.createdAt.toISOString(),
    eligibleActions,
    blockedActions,
    recommendedAction: recommendation,
  });
}

export async function evaluateLeadDecision(leadId: string, actor = "system:decision-worker", now = new Date()) {
  const { leadDetail } = await import("./deal-store");
  const { acquisitionQueue } = await import("./acquisition-queue-store");
  const { dealOperations } = await import("./matching-store");
  const detail = await leadDetail(leadId, undefined, now);
  const queue = await acquisitionQueue("OWNER", now);
  const acquisition = queue.items.find(item => item.lead.id === leadId) ?? null;
  const operations = await dealOperations(leadId, now);
  const input: IntelligenceLoopInput = {
    subjectType: "LEAD",
    subjectId: leadId,
    leadId,
    discoveryId: detail.lead.propertyQualification?.discoveryId ?? null,
    detail,
    acquisition,
    operations: {
      contract: operations.contract ? {
        id: operations.contract.id,
        status: operations.contract.status,
        committedBuyerId: operations.contract.committedBuyerId ?? null,
        closingAt: operations.contract.closingAt,
      } : null,
      matches: operations.matches.map(match => ({ buyerId: match.buyerId, eligible: match.eligible })),
      nextAction: operations.nextAction,
    },
    now,
  };
  return persistIntelligenceDecision(input, actor, now);
}

export async function evaluateAllLeadDecisions(actor = "system:decision-worker", now = new Date()) {
  const { listLeads } = await import("./deal-store");
  const leads = await listLeads();
  const results: IntelligenceDecision[] = [];
  for (const lead of leads) results.push(await evaluateLeadDecision(lead.id, actor, now));
  return results;
}
