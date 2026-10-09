import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, lte } from "drizzle-orm";
import {
  db,
  dealDecisionEvaluationsTable,
  dealDecisionWorkItemsTable,
  leadsTable,
} from "@workspace/db";
import { DomainError } from "@workspace/deal-domain";
import {
  recordDecisionWorkEvent,
  transitionDecisionWorkItem,
  type DecisionWorkRow,
  type DecisionWorkStatus,
} from "./decision-work-state";
import type { Store } from "./operations-records";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

export class DecisionWorkExecutionError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly failureCode = "EXECUTOR_FAILURE") {
    super(message);
    this.name = "DecisionWorkExecutionError";
  }
}

export type DecisionWorkClaim = {
  workItem: DecisionWorkRow;
  leaseToken: string;
  leaseExpiresAt: Date;
  evaluationId: string;
  evidenceSnapshotHash: string;
};

export function decisionWorkRetryDelayMs(attempt: number) {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

async function latestEvaluationMatches(
  tx: Store,
  item: DecisionWorkRow,
  currentEvaluationId: string,
  currentSnapshotHash: string,
) {
  const [latest] = await tx.select().from(dealDecisionEvaluationsTable).where(and(
    eq(dealDecisionEvaluationsTable.subjectType, item.subjectType),
    eq(dealDecisionEvaluationsTable.subjectId, item.subjectId),
  )).orderBy(desc(dealDecisionEvaluationsTable.createdAt)).limit(1);
  return latest?.id === currentEvaluationId
    && latest.snapshotHash === currentSnapshotHash
    && item.evaluationId === currentEvaluationId
    && item.evidenceSnapshotHash === currentSnapshotHash;
}

async function currentLeadVersionMatches(tx: Store, item: DecisionWorkRow) {
  if (item.subjectType !== "LEAD" || !item.leadId) return item.subjectVersion === 0;
  const [lead] = await tx.select({ version: leadsTable.version }).from(leadsTable)
    .where(eq(leadsTable.id, item.leadId)).for("update");
  return lead?.version === item.subjectVersion;
}

async function refreshCurrentDecision(item: DecisionWorkRow, actor: string, now: Date) {
  if (item.subjectType !== "LEAD" || !item.leadId) return null;
  const { evaluateLeadDecision } = await import("./intelligence-decision-store");
  return evaluateLeadDecision(item.leadId, actor, now);
}

async function blockStaleWork(
  tx: Store,
  item: DecisionWorkRow,
  actor: string,
  reason: string,
  now: Date,
) {
  if (item.status === "IN_PROGRESS" || item.status === "READY") {
    return transitionDecisionWorkItem(tx, item, "BLOCKED", {
      eventType: "STALE_SNAPSHOT",
      actor,
      reason,
      metadata: { staleSnapshot: true },
    }, now, {
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      retryable: false,
    });
  }
  await recordDecisionWorkEvent(tx, item, {
    eventType: "STALE_SNAPSHOT",
    actor,
    reason,
    metadata: { staleSnapshot: true },
  }, now);
  return item;
}

/**
 * Claims only autonomous work explicitly enabled by its caller. Human-authorized
 * actions are left available for the operator and are never claimed by a worker.
 */
export async function claimDecisionWorkItem(
  workItemId: string,
  workerId: string,
  allowedActionCodes: readonly string[],
  now = new Date(),
  leaseMs = DEFAULT_LEASE_MS,
): Promise<DecisionWorkClaim | null> {
  const [before] = await db.select().from(dealDecisionWorkItemsTable)
    .where(eq(dealDecisionWorkItemsTable.id, workItemId)).limit(1);
  if (!before) throw new DomainError("Decision work item not found.", 404);
  if (before.status === "READY" && before.payload.requiresHumanAuthorization === true) {
    return db.transaction(async tx => {
      const [locked] = await tx.select().from(dealDecisionWorkItemsTable)
        .where(eq(dealDecisionWorkItemsTable.id, workItemId))
        .for("update", { skipLocked: true }).limit(1);
      if (!locked || locked.status !== "READY") return null;
      await recordDecisionWorkEvent(tx, locked, {
        eventType: "CLAIM_DENIED_AUTHORIZATION",
        actor: workerId,
        reason: "This action requires human authorization. The worker did not claim or perform it.",
      }, now);
      return null;
    });
  }

  const decision = await refreshCurrentDecision(before, `worker:${workerId}:pre-claim`, now);
  const leaseToken = randomUUID();
  return db.transaction(async tx => {
    const [item] = await tx.select().from(dealDecisionWorkItemsTable)
      .where(eq(dealDecisionWorkItemsTable.id, workItemId))
      .for("update", { skipLocked: true }).limit(1);
    if (!item) return null;

    if (item.status !== "READY") {
      if (item.status === "FAILED" && item.retryable && item.attempts < item.maxAttempts
        && item.nextAttemptAt && item.nextAttemptAt.getTime() <= now.getTime()) {
        const ready = await transitionDecisionWorkItem(tx, item, "READY", {
          eventType: "RETRY_DUE",
          actor: workerId,
          reason: "The bounded retry delay elapsed; this item is eligible for another attempt.",
        }, now, { nextAttemptAt: null });
        return claimReadyItem(tx, ready, decision, leaseToken, workerId, now, leaseMs, allowedActionCodes);
      }
      return null;
    }
    return claimReadyItem(tx, item, decision, leaseToken, workerId, now, leaseMs, allowedActionCodes);
  });
}

async function claimReadyItem(
  tx: Store,
  item: DecisionWorkRow,
  decision: Awaited<ReturnType<typeof refreshCurrentDecision>>,
  leaseToken: string,
  workerId: string,
  now: Date,
  leaseMs: number,
  allowedActionCodes: readonly string[],
): Promise<DecisionWorkClaim | null> {
  const action = item.payload;
  if (action.requiresHumanAuthorization === true) {
    await recordDecisionWorkEvent(tx, item, {
      eventType: "CLAIM_DENIED_AUTHORIZATION",
      actor: workerId,
      reason: "This action requires human authorization. The worker did not claim or perform it.",
    }, now);
    return null;
  }
  if (!allowedActionCodes.includes(item.actionCode)) {
    await recordDecisionWorkEvent(tx, item, {
      eventType: "CLAIM_DENIED_NO_EXECUTOR",
      actor: workerId,
      reason: `No autonomous executor is registered for ${item.actionCode}; work remains READY for the responsible operator.`,
    }, now);
    return null;
  }
  if (!decision || decision.evaluationId !== item.evaluationId
    || decision.snapshotHash !== item.evidenceSnapshotHash) {
    await blockStaleWork(tx, item, workerId,
      "The persisted decision/evidence snapshot changed before execution; the item was blocked for reevaluation.", now);
    return null;
  }
  if (!await latestEvaluationMatches(tx, item, decision.evaluationId, decision.snapshotHash)
    || !await currentLeadVersionMatches(tx, item)) {
    await blockStaleWork(tx, item, workerId,
      "Current evidence or subject version no longer matches the work snapshot; the item was blocked before execution.", now);
    return null;
  }
  const leaseExpiresAt = new Date(now.getTime() + Math.max(1_000, Math.min(leaseMs, 10 * 60 * 1000)));
  const claimed = await transitionDecisionWorkItem(tx, item, "IN_PROGRESS", {
    eventType: "CLAIMED",
    actor: workerId,
    reason: `Claimed under a bounded lease until ${leaseExpiresAt.toISOString()}.`,
    evaluationId: decision.evaluationId,
    evidenceSnapshotHash: decision.snapshotHash,
  }, now, {
    attempts: item.attempts + 1,
    maxAttempts: item.maxAttempts || DEFAULT_MAX_ATTEMPTS,
    retryable: false,
    nextAttemptAt: null,
    leaseOwner: workerId,
    leaseToken,
    leaseExpiresAt,
    completionKey: null,
    completedAt: null,
  });
  return {
    workItem: claimed,
    leaseToken,
    leaseExpiresAt,
    evaluationId: decision.evaluationId,
    evidenceSnapshotHash: decision.snapshotHash,
  };
}

async function validateCurrentExecution(
  item: DecisionWorkRow,
  workerId: string,
  now: Date,
) {
  const decision = await refreshCurrentDecision(item, `worker:${workerId}:pre-completion`, now);
  return db.transaction(async tx => {
    const [locked] = await tx.select().from(dealDecisionWorkItemsTable)
      .where(eq(dealDecisionWorkItemsTable.id, item.id)).for("update").limit(1);
    if (!locked) throw new DomainError("Decision work item not found.", 404);
    if (locked.status !== "IN_PROGRESS") {
      return { item: locked, stale: ["BLOCKED", "EXPIRED"].includes(locked.status) };
    }
    const fresh = !!decision
      && decision.evaluationId === locked.evaluationId
      && decision.snapshotHash === locked.evidenceSnapshotHash
      && await latestEvaluationMatches(tx, locked, decision.evaluationId, decision.snapshotHash)
      && await currentLeadVersionMatches(tx, locked);
    if (fresh) return { item: locked, stale: false };
    const blocked = await blockStaleWork(tx, locked, workerId,
      "The evidence or decision version changed during execution; no completion was recorded.", now);
    return { item: blocked, stale: true };
  });
}

export async function completeDecisionWorkItem(
  workItemId: string,
  leaseToken: string,
  completionKey: string,
  workerId: string,
  result: { reason: string; evidenceRefs?: string[]; metadata?: Record<string, unknown> },
  now = new Date(),
) {
  if (!completionKey.trim()) throw new DomainError("Completion requires an idempotency key.", 400);
  const [initial] = await db.select().from(dealDecisionWorkItemsTable)
    .where(eq(dealDecisionWorkItemsTable.id, workItemId)).limit(1);
  if (!initial) throw new DomainError("Decision work item not found.", 404);
  if (initial.status === "COMPLETED") {
    if (initial.completionKey === completionKey) return { item: initial, idempotentReplay: true };
    throw new DomainError("This decision work item was already completed by a different completion command.", 409);
  }
  const check = await validateCurrentExecution(initial, workerId, now);
  if (check.stale) return { item: check.item, idempotentReplay: false, stale: true };
  return db.transaction(async tx => {
    const [item] = await tx.select().from(dealDecisionWorkItemsTable)
      .where(eq(dealDecisionWorkItemsTable.id, workItemId)).for("update").limit(1);
    if (!item) throw new DomainError("Decision work item not found.", 404);
    if (item.status === "COMPLETED" && item.completionKey === completionKey) {
      return { item, idempotentReplay: true };
    }
    if (item.status !== "IN_PROGRESS" || item.leaseToken !== leaseToken) {
      throw new DomainError("The decision-work lease is no longer valid.", 409);
    }
    if (!item.leaseExpiresAt || item.leaseExpiresAt.getTime() <= now.getTime()) {
      throw new DomainError("The decision-work lease expired before completion.", 409);
    }
    const latestStillMatches = await latestEvaluationMatches(tx, item, item.evaluationId, item.evidenceSnapshotHash);
    const leadStillMatches = await currentLeadVersionMatches(tx, item);
    if (!latestStillMatches || !leadStillMatches) {
      const blocked = await transitionDecisionWorkItem(tx, item, "BLOCKED", {
        eventType: "STALE_AT_COMPLETION",
        actor: workerId,
        reason: "Evidence changed immediately before completion; no completion was recorded.",
      }, now, {
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        retryable: false,
        nextAttemptAt: null,
      });
      return { item: blocked, idempotentReplay: false, stale: true };
    }
    const completed = await transitionDecisionWorkItem(tx, item, "COMPLETED", {
      eventType: "COMPLETED",
      actor: workerId,
      reason: result.reason,
      evaluationId: item.evaluationId,
      evidenceSnapshotHash: item.evidenceSnapshotHash,
      metadata: { ...(result.metadata ?? {}), evidenceRefs: result.evidenceRefs ?? [] },
    }, now, {
      completionKey,
      completedAt: now,
      retryable: false,
      nextAttemptAt: null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    return { item: completed, idempotentReplay: false };
  });
}

export async function failDecisionWorkItem(
  workItemId: string,
  leaseToken: string,
  workerId: string,
  failure: { reason: string; retryable: boolean; failureCode?: string; metadata?: Record<string, unknown> },
  now = new Date(),
) {
  const [item] = await db.select().from(dealDecisionWorkItemsTable)
    .where(eq(dealDecisionWorkItemsTable.id, workItemId)).limit(1);
  if (!item) throw new DomainError("Decision work item not found.", 404);
  if (item.status !== "IN_PROGRESS" || item.leaseToken !== leaseToken) {
    throw new DomainError("The decision-work lease is no longer valid.", 409);
  }
  const canRetry = failure.retryable && item.attempts < item.maxAttempts;
  const nextAttemptAt = canRetry
    ? new Date(now.getTime() + decisionWorkRetryDelayMs(item.attempts))
    : null;
  return db.transaction(async tx => {
    const [locked] = await tx.select().from(dealDecisionWorkItemsTable)
      .where(eq(dealDecisionWorkItemsTable.id, workItemId)).for("update").limit(1);
    if (!locked || locked.status !== "IN_PROGRESS" || locked.leaseToken !== leaseToken) {
      throw new DomainError("The decision-work lease changed before failure was recorded.", 409);
    }
    return transitionDecisionWorkItem(tx, locked, "FAILED", {
      eventType: canRetry ? "RETRYABLE_FAILURE" : "TERMINAL_FAILURE",
      actor: workerId,
      reason: canRetry
        ? `${failure.reason} Retry ${locked.attempts + 1} is scheduled at ${nextAttemptAt?.toISOString()}.`
        : `${failure.reason} No further retry is permitted (${locked.attempts}/${locked.maxAttempts} attempts).`,
      metadata: { failureCode: failure.failureCode ?? "UNSPECIFIED", ...(failure.metadata ?? {}) },
    }, now, {
      retryable: canRetry,
      nextAttemptAt,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
  });
}

export async function expireDecisionWorkItem(
  workItemId: string,
  actor: string,
  reason: string,
  now = new Date(),
) {
  return db.transaction(async tx => {
    const [item] = await tx.select().from(dealDecisionWorkItemsTable)
      .where(eq(dealDecisionWorkItemsTable.id, workItemId)).for("update").limit(1);
    if (!item) throw new DomainError("Decision work item not found.", 404);
    if (item.status === "EXPIRED") return { item, idempotentReplay: true };
    if (item.status === "COMPLETED") throw new DomainError("Completed decision work cannot be expired.", 409);
    const expired = await transitionDecisionWorkItem(tx, item, "EXPIRED", {
      eventType: "EXPIRED",
      actor,
      reason,
    }, now, {
      retryable: false,
      nextAttemptAt: null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    return { item: expired, idempotentReplay: false };
  });
}

export async function maintainDecisionWorkLifecycle(now = new Date()) {
  let leasesRecovered = 0;
  let retriesReleased = 0;
  const expiredLeases = await db.select().from(dealDecisionWorkItemsTable).where(and(
    eq(dealDecisionWorkItemsTable.status, "IN_PROGRESS"),
    isNotNull(dealDecisionWorkItemsTable.leaseExpiresAt),
    lte(dealDecisionWorkItemsTable.leaseExpiresAt, now),
  )).limit(100);
  for (const candidate of expiredLeases) {
    await db.transaction(async tx => {
      const [item] = await tx.select().from(dealDecisionWorkItemsTable)
        .where(eq(dealDecisionWorkItemsTable.id, candidate.id)).for("update", { skipLocked: true }).limit(1);
      if (!item || item.status !== "IN_PROGRESS" || !item.leaseExpiresAt
        || item.leaseExpiresAt.getTime() > now.getTime()) return;
      const retryable = item.attempts < item.maxAttempts;
      const nextAttemptAt = retryable
        ? new Date(now.getTime() + decisionWorkRetryDelayMs(item.attempts))
        : null;
      await transitionDecisionWorkItem(tx, item, "FAILED", {
        eventType: retryable ? "LEASE_EXPIRED_RETRYABLE" : "LEASE_EXPIRED_TERMINAL",
        actor: "system:decision-work-recovery",
        reason: retryable
          ? `Execution lease expired; bounded retry scheduled at ${nextAttemptAt?.toISOString()}.`
          : `Execution lease expired after ${item.attempts}/${item.maxAttempts} attempts; manual review is required.`,
      }, now, {
        retryable,
        nextAttemptAt,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
      });
      leasesRecovered++;
    });
  }

  const dueRetries = await db.select().from(dealDecisionWorkItemsTable).where(and(
    eq(dealDecisionWorkItemsTable.status, "FAILED"),
    eq(dealDecisionWorkItemsTable.retryable, true),
    lte(dealDecisionWorkItemsTable.nextAttemptAt, now),
  )).limit(100);
  for (const candidate of dueRetries) {
    await db.transaction(async tx => {
      const [item] = await tx.select().from(dealDecisionWorkItemsTable)
        .where(eq(dealDecisionWorkItemsTable.id, candidate.id)).for("update", { skipLocked: true }).limit(1);
      if (!item || item.status !== "FAILED" || !item.retryable
        || !item.nextAttemptAt || item.nextAttemptAt.getTime() > now.getTime()) return;
      if (item.attempts >= item.maxAttempts) {
        await transitionDecisionWorkItem(tx, item, "EXPIRED", {
          eventType: "RETRY_BUDGET_EXHAUSTED",
          actor: "system:decision-work-recovery",
          reason: `Retry budget exhausted (${item.attempts}/${item.maxAttempts}); no further automatic attempt will be made.`,
        }, now, { retryable: false, nextAttemptAt: null });
        return;
      }
      await transitionDecisionWorkItem(tx, item, "READY", {
        eventType: "RETRY_READY",
        actor: "system:decision-work-recovery",
        reason: "The bounded retry delay elapsed; item returned to READY.",
      }, now, { retryable: false, nextAttemptAt: null });
      retriesReleased++;
    });
  }
  return { leasesRecovered, retriesReleased };
}

export type DecisionWorkExecutor = (
  claim: DecisionWorkClaim,
) => Promise<{ reason: string; evidenceRefs?: string[]; metadata?: Record<string, unknown> }>;

export const decisionWorkExecutors = new Map<string, DecisionWorkExecutor>();

export function registerDecisionWorkExecutor(actionCode: string, executor: DecisionWorkExecutor) {
  const key = actionCode.trim();
  if (!key) throw new Error("Decision-work executor requires an action code.");
  if (decisionWorkExecutors.has(key)) throw new Error(`Decision-work executor already registered for ${key}.`);
  decisionWorkExecutors.set(key, executor);
  return () => {
    if (decisionWorkExecutors.get(key) === executor) decisionWorkExecutors.delete(key);
  };
}

/**
 * Replaceable executor registry. No executor is registered by default; unconfigured
 * work stays READY for the responsible human rather than being falsely completed.
 */
export async function runDecisionWorkOnce(
  executors: ReadonlyMap<string, DecisionWorkExecutor> = decisionWorkExecutors,
  now = new Date(),
  workerId = "system:decision-work-worker",
) {
  const maintenance = await maintainDecisionWorkLifecycle(now);
  const candidates = await db.select().from(dealDecisionWorkItemsTable)
    .where(eq(dealDecisionWorkItemsTable.status, "READY"))
    .orderBy(asc(dealDecisionWorkItemsTable.createdAt))
    .limit(100);
  let claimed = 0;
  let completed = 0;
  let failed = 0;
  let stale = 0;
  for (const candidate of candidates) {
    if (candidate.payload.requiresHumanAuthorization === true) continue;
    const executor = executors.get(candidate.actionCode);
    if (!executor) continue;
    const claim = await claimDecisionWorkItem(candidate.id, workerId, [candidate.actionCode], now);
    if (!claim) continue;
    claimed++;
    try {
      const result = await executor(claim);
      const outcome = await completeDecisionWorkItem(
        candidate.id,
        claim.leaseToken,
        `decision-work-complete:${candidate.id}:${claim.evidenceSnapshotHash}`,
        workerId,
        result,
        now,
      );
      if (outcome.stale) stale++;
      else if (outcome.item.status === "COMPLETED") completed++;
    } catch (error) {
      const retryable = error instanceof DecisionWorkExecutionError && error.retryable;
      const failureCode = error instanceof DecisionWorkExecutionError ? error.failureCode : "UNCLASSIFIED_EXECUTOR_ERROR";
      const reason = error instanceof Error ? error.message : "Unknown executor failure.";
      const [current] = await db.select().from(dealDecisionWorkItemsTable)
        .where(eq(dealDecisionWorkItemsTable.id, candidate.id)).limit(1);
      if (current?.status === "IN_PROGRESS" && current.leaseToken === claim.leaseToken) {
        await failDecisionWorkItem(candidate.id, claim.leaseToken, workerId, {
          reason,
          retryable,
          failureCode,
        }, now);
        failed++;
      } else {
        stale++;
      }
    }
  }
  return { ...maintenance, claimed, completed, failed, stale };
}

