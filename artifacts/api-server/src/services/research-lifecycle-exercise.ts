/**
 * Isolated persistence regression: delayed research must not write after a
 * terminal transition. Provider responses are MOCKED, not verified source data.
 * The active controls prove that the mocked responses are otherwise usable.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, leadsTable, intelligenceTable, jobsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { createLead, leadDetail } from "./deal-store";
import { submitWorkerJob, runWorkerOnce } from "./workers";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const originalFetch = globalThis.fetch;
const actor = { id: `synthetic-lifecycle:${randomUUID()}`, role: "OWNER" };
let response: unknown;
let started = deferred();
let released = deferred();
let requests = 0;
globalThis.fetch = async () => {
  requests++;
  started.resolve();
  await released.promise;
  return new Response(JSON.stringify(response), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

try {
  let cases = 0;
  for (const kind of ["ENRICH_PROPERTY", "PREPARE_BRIEF"] as const) {
    for (const terminal of [null, "CLOSED", "DEAD_DEAL"] as const) {
      const lead = await createLead({
        address: "123 Synthetic Test Street", city: "Washington", state: "DC",
        county: "District of Columbia", zip: "20500", propertyType: "OTHER",
        sqft: 0, beds: 0, baths: 0, units: 1, sellerName: "SYNTHETIC NON-SELLER",
        source: "Isolated race regression. Mocked sources only. NOT a real property or seller.",
        sellerDescription: "Synthetic lifecycle fixture; no facts are verified.",
      }, actor.id);
      const before = await leadDetail(lead.id);
      const originalRow = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)))[0]!;
      started = deferred(); released = deferred(); requests = 0;
      response = kind === "ENRICH_PROPERTY" ? {
        result: { addressMatches: [{
          matchedAddress: "123 SYNTHETIC TEST STREET", coordinates: { x: 0, y: 0 },
        }] },
      } : {
        id: "synthetic-completion", object: "chat.completion", created: 0,
        model: "synthetic-mocked-model",
        choices: [{ index: 0, finish_reason: "stop", message: {
          role: "assistant", content: JSON.stringify({ hypotheses: [{
            statement: "The supplied property details may require confirmation.",
            question: "Which property details should we confirm before proceeding?",
            action: "Ask a human reviewer to verify the supplied property details.",
            confidence: 0.2, evidenceIds: [`subject:${lead.id}`],
          }] }),
        } }],
      };
      const job = await submitWorkerJob({
        kind, leadId: lead.id, idempotencyKey: `synthetic-race:${randomUUID()}`,
      }, actor);
      const running = runWorkerOnce(new Date(), false, job.id);
      // The response cannot finish until this test releases it. Fail rather
      // than hanging if an executor never reaches its mocked provider.
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([started.promise, new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Executor never reached the mocked provider.")), 10000);
        })]);
      } finally { if (timeout) clearTimeout(timeout); }
      if (terminal) {
        // Test-only race fixture, not evidence of an actual closed transaction.
        await db.update(leadsTable).set({
          stage: terminal, version: before.lead.version + 1, updatedAt: new Date(),
        }).where(eq(leadsTable.id, lead.id));
      }
      released.resolve();
      const result = await running;
      assert.equal(requests, 1, "No provider request should be repeated.");
      const after = await leadDetail(lead.id);
      const row = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)))[0]!;
      const intelligence = await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId, lead.id));
      if (terminal) {
        assert.equal(result?.state, "FAILED");
        assert.match(result!.message, /terminal/i);
        assert.equal(after.lead.stage, terminal);
        assert.equal(after.lead.version, before.lead.version + 1);
        assert.equal(intelligence.length, before.intelligence.length);
      } else {
        assert.equal(result?.state, "SUCCEEDED", result?.message);
        assert.equal(after.lead.stage, before.lead.stage);
        assert.equal(after.lead.version, before.lead.version + 1);
        assert.equal(intelligence.length, before.intelligence.length + 1);
      }
      assert.deepEqual(row.underwriting, originalRow.underwriting);
      assert.deepEqual(row.analysis, originalRow.analysis);
      assert.equal(row.analysisSnapshotId, originalRow.analysisSnapshotId);
      assert.deepEqual(after.offers, before.offers);
      cases++;
    }
  }
  const recoveryLead = await createLead({
    address:"456 Synthetic Recovery Street",city:"Washington",state:"DC",county:"District of Columbia",
    zip:"20500",propertyType:"OTHER",sqft:0,beds:0,baths:0,units:1,sellerName:"SYNTHETIC NON-SELLER",
    source:"Synthetic partial-persistence recovery fixture. No real subject or seller.",
    sellerDescription:"Synthetic lifecycle fixture; no facts are verified.",
  },actor.id);
  response = {
    id:"synthetic-recovery-completion",object:"chat.completion",created:0,model:"synthetic-mocked-model",
    choices:[{index:0,finish_reason:"stop",message:{role:"assistant",content:JSON.stringify({hypotheses:[{
      statement:"The supplied property details may require confirmation.",
      question:"Which property details should we confirm before proceeding?",
      action:"Ask a human reviewer to verify the supplied property details.",
      confidence:0.2,evidenceIds:[`subject:${recoveryLead.id}`],
    }]})}}],
  };
  requests=0;
  released=deferred();
  released.resolve();
  const recoveryJob=await submitWorkerJob({kind:"PREPARE_BRIEF",leadId:recoveryLead.id,
    idempotencyKey:`synthetic-partial-persistence:${randomUUID()}`},actor);
  const beforeRecoveryIntelligence=await db.select().from(intelligenceTable)
    .where(eq(intelligenceTable.leadId,recoveryLead.id));
  const completed=await runWorkerOnce(new Date(),false,recoveryJob.id);
  assert.equal(completed?.state,"SUCCEEDED");
  assert.equal(requests,1);
  const interruptedAt=new Date(Date.now()-4*60_000);
  await db.update(jobsTable).set({state:"RUNNING",updatedAt:interruptedAt}).where(eq(jobsTable.id,recoveryJob.id));
  const leaseRecoveryAt=new Date(interruptedAt.getTime()+4*60_000+1);
  assert.equal(await runWorkerOnce(leaseRecoveryAt,false,recoveryJob.id),null,
    "An interrupted job must respect its persisted backoff before retry.");
  const recovered=await runWorkerOnce(new Date(leaseRecoveryAt.getTime()+16_000),false,recoveryJob.id);
  assert.equal(recovered?.state,"SUCCEEDED","A worker crash after the business write must recover without false failure.");
  assert.equal(recovered?.attempts,2);
  assert.equal(requests,1,"The persisted job marker prevents repeating the external model request after a post-write interruption.");
  const recoveryHypotheses=await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,recoveryLead.id));
  assert.equal(recoveryHypotheses.length,beforeRecoveryIntelligence.length+1,
    "Recovery after partial persistence must not duplicate the already committed business effect.");
  assert.equal(recoveryHypotheses.filter(item=>item.payload.workerMarker===`ai:${recoveryJob.id}`).length,1,
    "Exactly one append-only hypothesis event is retained for the completed work identity.");
  cases++;
  logger.info({ cases, providers: "mocked; no real source verification or paid model requests" },
    "Research lifecycle persistence regression PASSED: active controls and terminal-race rejection");
} finally {
  released.resolve();
  globalThis.fetch = originalFetch;
  await pool.end();
}