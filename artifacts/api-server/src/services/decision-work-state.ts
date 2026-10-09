import { and, eq } from "drizzle-orm";
import {
  auditTable,
  dealDecisionWorkEventsTable,
  dealDecisionWorkItemsTable,
} from "@workspace/db";
import type { Store } from "./operations-records";

export const DECISION_WORK_STATUSES = [
  "READY", "BLOCKED", "IN_PROGRESS", "COMPLETED", "FAILED", "EXPIRED",
] as const;
export type DecisionWorkStatus = typeof DECISION_WORK_STATUSES[number];
export type DecisionWorkRow = typeof dealDecisionWorkItemsTable.$inferSelect;
export type DecisionWorkEventInput = {
  eventType: string;
  actor: string;
  reason: string;
  evaluationId?: string | null;
  evidenceSnapshotHash?: string | null;
  attempt?: number;
  metadata?: Record<string, unknown>;
};

const allowedTransitions: Record<DecisionWorkStatus, ReadonlySet<DecisionWorkStatus>> = {
  READY: new Set(["BLOCKED", "IN_PROGRESS", "COMPLETED", "EXPIRED"]),
  BLOCKED: new Set(["READY", "COMPLETED", "EXPIRED"]),
  IN_PROGRESS: new Set(["BLOCKED", "COMPLETED", "FAILED", "EXPIRED"]),
  FAILED: new Set(["READY", "EXPIRED"]),
  COMPLETED: new Set(),
  EXPIRED: new Set(),
};

export function canTransitionDecisionWork(from: string, to: DecisionWorkStatus) {
  return DECISION_WORK_STATUSES.includes(from as DecisionWorkStatus)
    && allowedTransitions[from as DecisionWorkStatus].has(to);
}

export async function recordDecisionWorkEvent(
  tx: Store,
  item: Pick<DecisionWorkRow, "id" | "evaluationId" | "evidenceSnapshotHash" | "attempts" | "status">,
  input: DecisionWorkEventInput & { fromStatus?: string | null; toStatus?: string | null },
  now: Date,
) {
  await tx.insert(dealDecisionWorkEventsTable).values({
    workItemId: item.id,
    eventType: input.eventType,
    fromStatus: input.fromStatus ?? item.status,
    toStatus: input.toStatus ?? item.status,
    actor: input.actor,
    reason: input.reason,
    evaluationId: input.evaluationId === undefined ? item.evaluationId : input.evaluationId,
    evidenceSnapshotHash: input.evidenceSnapshotHash === undefined
      ? item.evidenceSnapshotHash
      : input.evidenceSnapshotHash,
    attempt: input.attempt ?? item.attempts,
    metadata: input.metadata ?? {},
    createdAt: now,
  });
  await tx.insert(auditTable).values({
    actor: input.actor,
    action: `DECISION_WORK_${input.eventType}`,
    entityId: item.id,
    detail: `${input.fromStatus ?? item.status} -> ${input.toStatus ?? item.status}: ${input.reason}`,
    createdAt: now,
  });
}

export async function transitionDecisionWorkItem(
  tx: Store,
  item: DecisionWorkRow,
  toStatus: DecisionWorkStatus,
  input: DecisionWorkEventInput,
  now: Date,
  patch: Partial<typeof dealDecisionWorkItemsTable.$inferInsert> = {},
) {
  if (!canTransitionDecisionWork(item.status, toStatus)) {
    throw new Error(`Illegal decision-work transition ${item.status} -> ${toStatus}.`);
  }
  const [updated] = await tx.update(dealDecisionWorkItemsTable).set({
    ...patch,
    status: toStatus,
    reason: input.reason,
    stateVersion: item.stateVersion + 1,
    updatedAt: now,
  }).where(and(
    eq(dealDecisionWorkItemsTable.id, item.id),
    eq(dealDecisionWorkItemsTable.status, item.status),
    eq(dealDecisionWorkItemsTable.stateVersion, item.stateVersion),
  )).returning();
  if (!updated) throw new Error("Decision work changed concurrently; reload its current state before retrying.");
  await recordDecisionWorkEvent(tx, updated, {
    ...input,
    fromStatus: item.status,
    toStatus,
  }, now);
  return updated;
}

