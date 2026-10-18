import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, auditTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as seller from "./deal-store";
import { createClauseReviewRequest, listClauseReviewRequests } from "./transaction-clause-requests";

const actor = { id: `synthetic-clause-review:${randomUUID()}`, role: "OWNER" };
const now = new Date();
try {
  const lead = await seller.createLead({
    address: "SYNTHETIC CLAUSE REVIEW PROPERTY", city: "Synthetic City", state: "PA",
    county: "Synthetic County", zip: "00000", propertyType: "SINGLE_FAMILY",
    sqft: 1000, beds: 3, baths: 2, units: 1, askingPrice: 100000,
    source: "Synthetic clause workflow exercise only", sellerName: "SYNTHETIC ONLY",
  }, actor.id, now);
  const request = {
    idempotencyKey: `synthetic-clause-${randomUUID()}`, category: "ASSIGNMENT",
    purpose: "Synthetic request to clarify assignment disclosure and consent requirements.",
    jurisdiction: "US/PA/SYNTHETIC-COUNTY", partyScope: "INTERNAL_REVIEW",
    proposedText: "SYNTHETIC OWNER-SUPPLIED WORDING — UNREVIEWED", affectedTerms: ["ASSIGNMENT"],
  };
  const created = await createClauseReviewRequest(lead.id, request, actor);
  assert.equal(created.status, "BLOCKED_MISSING_APPROVED_TEMPLATE");
  assert.equal(created.proposedTextStatus, "OWNER_SUPPLIED_UNREVIEWED");
  assert.equal(created.qualifiedReviewStatus, "NOT_REVIEWED");
  assert.match(String(created.blocker), /No approved legal template/);
  const replay = await createClauseReviewRequest(lead.id, request, actor);
  assert.equal(replay.id, created.id, "idempotent replay must not create another request");
  await assert.rejects(createClauseReviewRequest(lead.id, {
    ...request, proposedText: "Changed wording must not reuse the original idempotency key.",
  }, actor), /already used for different clause content/);
  await assert.rejects(createClauseReviewRequest(lead.id, request, {
    id: `synthetic-other-owner:${randomUUID()}`, role: "OWNER",
  }), /belongs to another clause request/);
  const rows = await listClauseReviewRequests(lead.id, actor);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, created.id);
  await assert.rejects(createClauseReviewRequest(lead.id, request, { ...actor, role: "OPERATOR" }));
  await assert.rejects(createClauseReviewRequest(lead.id, { ...request, idempotencyKey: `synthetic-mismatch-${randomUUID()}`, jurisdiction: "US/NY/OTHER" }, actor));
  const [leadAfter] = await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id));
  assert.equal(leadAfter?.version, lead.version, "clause request must not mutate lead economics/state");
  const events = await db.select().from(auditTable).where(eq(auditTable.entityId, `transaction-clause:${created.id}`));
  assert.equal(events.length, 1, "request creation must be audited exactly once");
  console.info(JSON.stringify({ exercise: "synthetic-only", status: "passed", idempotentReplay: true,
    requestStatus: created.status, templateMissing: true, qualifiedReview: "NOT_REVIEWED", autoInsertion: false,
    ownerOnly: true, jurisdictionMismatchRejected: true, auditEvents: events.length, leadUnchanged: true }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
