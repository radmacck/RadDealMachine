import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { auditTable, callsTable, db, leadsTable, transitionsTable } from "@workspace/db";
import * as store from "./deal-store";

function assertExerciseSchema() {
  if (!/search_path=exercise_[a-f0-9]+/.test(process.env.PGOPTIONS ?? "")) {
    throw new Error("Post-gate synthetic fixtures require the isolated exercise schema.");
  }
}

export async function assertSyntheticCallReadyBlocked(
  leadId: string,
  actorId: string,
  now: Date,
  expectedMessage = "CALL_READY is blocked: Link this lead to a source-backed property discovery and complete ownership, seller identity, contact permission, and route review.",
) {
  assertExerciseSchema();
  const before = await store.leadDetail(leadId, undefined, now);
  const transitionCount = (await db.select().from(transitionsTable).where(eq(transitionsTable.leadId, leadId))).length;
  const auditCount = (await db.select().from(auditTable)
    .where(and(eq(auditTable.entityId, leadId), eq(auditTable.action, "DEAL_TRANSITION")))).length;
  const callCount = (await db.select().from(callsTable).where(eq(callsTable.leadId, leadId))).length;
  await assert.rejects(
    store.transitionLead(leadId, {
      version: before.lead.version, to: "CALL_READY",
      reason: "Synthetic fixture must not pass the seller evidence gate.",
      nextAction: "No call or external contact.",
    }, actorId, now),
    error => {
      assert.equal((error as { status?: number }).status, 409);
        assert.equal((error as Error).message, expectedMessage);
      return true;
    },
  );
  const after = await store.leadDetail(leadId, undefined, now);
  assert.equal(after.lead.stage, before.lead.stage);
  assert.equal(after.lead.version, before.lead.version);
  assert.equal((await db.select().from(transitionsTable).where(eq(transitionsTable.leadId, leadId))).length, transitionCount);
  assert.equal((await db.select().from(auditTable)
    .where(and(eq(auditTable.entityId, leadId), eq(auditTable.action, "DEAL_TRANSITION")))).length, auditCount);
  assert.equal((await db.select().from(callsTable).where(eq(callsTable.leadId, leadId))).length, callCount);
}

/**
 * Seeds downstream tests at an explicitly synthetic post-gate state. This does
 * not assert or simulate that synthetic evidence passed production authorization.
 */
export async function seedSyntheticPostGateContacted(leadId: string, actorId: string, now: Date) {
  assertExerciseSchema();
  await db.transaction(async tx => {
    const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id, leadId)).for("update");
    if (!lead || lead.stage === "CLOSED" || lead.stage === "DEAD_DEAL") {
      throw new Error("Post-gate fixture requires a nonterminal isolated synthetic lead.");
    }
    await tx.update(leadsTable).set({
      stage: "CONTACTED",
      version: lead.version + 1,
      nextAction: "SYNTHETIC POST-GATE FIXTURE ONLY; no real seller contact occurred.",
      updatedAt: now,
    }).where(eq(leadsTable.id, leadId));
    await tx.insert(auditTable).values({
      actor: actorId,
      action: "SYNTHETIC_POST_GATE_FIXTURE",
      entityId: leadId,
      detail: JSON.stringify({
        fixtureOnly: true,
        authorizationClaimed: false,
        priorStage: lead.stage,
        seededStage: "CONTACTED",
        note: "Downstream state seeded in an isolated exercise after the production CALL_READY gate was separately asserted blocked.",
      }),
      createdAt: now,
    });
  });
  return store.leadDetail(leadId, undefined, now);
}
