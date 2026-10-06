/**
 * Real Philadelphia OPA discovery through PostgreSQL and qualification services.
 * Synthetic evidence is clearly labeled and runs only inside the isolated exercise schema.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool, jobsTable, leadsTable, intelligenceTable, propertySourceObservationsTable } from "@workspace/db";
import { DomainError } from "@workspace/deal-domain";
import { logger } from "../lib/logger";
import { commandCenter } from "./command-center";
import {
  addPropertyRelevanceSignal, disqualifyPropertyDiscovery, listPropertyDiscoveries,
  promotePropertyDiscovery, recordPropertyObservation, recordPublicPropertyDiscovery,
} from "./property-discovery-store";
import { addSourceComps, getSourceResearch, importPublicProperty, refreshSourceResearch, searchPublicProperties } from "./property-source-store";
import { callQueue, createLead, leadDetail } from "./deal-store";
import { runWorkerOnce, submitWorkerJob } from "./workers";

const actor = { id: `synthetic-source:${randomUUID()}`, role: "OWNER" };
const now = new Date();
try {
  await assert.rejects(() => submitWorkerJob({
    kind: "DISCOVER_PROPERTIES", idempotencyKey: "synthetic-property-no-terms",
  }, actor), /reviewed source terms/i);
  const discoveryJob = await submitWorkerJob({
    kind: "DISCOVER_PROPERTIES", idempotencyKey: "synthetic-property-source-worker",
    termsReviewed: true, recurringPropertyDiscovery: true,
  }, actor);
  const discoveryRun = await runWorkerOnce(now, false, discoveryJob.id);
  assert.equal(discoveryRun?.state, "SUCCEEDED", "The durable seller discovery job must complete from the official source.");
  assert.match(discoveryRun?.message ?? "", /no active leads were created/i);
  assert.ok((await db.select().from(propertySourceObservationsTable)).length > 0, "The worker must persist raw source observations.");
  assert.equal((await db.select().from(leadsTable)).length, 0, "Raw property discovery must never create active leads.");

  await runWorkerOnce(new Date(now.getTime() + 1), true);
  const scheduledPropertyJobs = await db.select().from(jobsTable).where(eq(jobsTable.kind, "DISCOVER_PROPERTIES"));
  assert.equal(
    scheduledPropertyJobs.filter((job) => job.idempotencyKey.startsWith("scheduled:property-discovery:")).length,
    1,
    "A reviewed recurring seller-discovery policy must enqueue one six-hour schedule job.",
  );

  const search = await searchPublicProperties();
  assert.ok(search.records.length > 0, "Official provider must return actual records; no fixture fallback.");
  const property = search.records.find((record) =>
    record.propertyType === "TOWNHOUSE" && record.sqft !== null && record.sqft >= 700 && record.sqft <= 1800 &&
    record.beds !== null && record.beds >= 2 && record.beds <= 4 && record.baths !== null && record.baths > 0 && record.baths <= 3,
  );
  assert.ok(property, "A complete public-record property is required for the isolated workflow exercise.");
  await assert.rejects(() => recordPublicPropertyDiscovery(property.id, false, actor, now), /terms|permitted/i);
  await assert.rejects(() => recordPublicPropertyDiscovery(property.id, true, { ...actor, role: "VIEWER" }, now), /role|only/i);

  const first = await recordPublicPropertyDiscovery(property.id, true, actor, now);
  assert.ok(["DISCOVERED_PROPERTY", "RELEVANT_CANDIDATE"].includes(first.status));
  assert.equal(first.leadId, null);
  assert.equal(first.canPromote, false, "An OPA record alone must not become a qualified lead.");
  assert.match(first.reason, /not a lead|signal/i);
  const matchedLeads = await db.select().from(leadsTable).where(sql`${leadsTable.payload}->>'address' = ${property.address}`);
  assert.equal(matchedLeads.length, 0, "Saving the source observation must not create a lead row.");

  const repeated = await recordPublicPropertyDiscovery(property.id, true, actor, now);
  assert.equal(repeated.id, first.id, "Repeated OPA parcel imports must deduplicate by property identity.");
  assert.equal(repeated.sourceObservationCount, 1, "The same source record is updated in place rather than duplicated.");
  const [repeatRow] = await db.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.sourceKey, `phila-opa:${property.id}`));
  assert.equal(repeatRow?.seenCount, 3, "The worker capture and two manual imports update one deduplicated source observation.");
  const secondary = await recordPropertyObservation(
    { ...property, provider: "SYNTHETIC_SECONDARY_SOURCE", sourceUrl: "https://example.com/synthetic-record" },
    `synthetic-secondary:${property.id}`, actor.id, now,
  );
  assert.equal(secondary.id, first.id, "A second source with the same normalized property identity must attach to one discovery.");
  assert.equal(secondary.sourceObservationCount, 2);
  assert.equal(secondary.leadId, null);

  const beforeHypothesisScore = secondary.score;
  let discovery = await addPropertyRelevanceSignal(secondary.id, {
    version: secondary.version,
    key: "STALE_LISTING",
    group: "LISTING_PRESSURE",
    classification: "AI_HYPOTHESIS",
    sourceType: "MODEL",
    statement: "Synthetic test hypothesis only; no listing evidence was observed.",
    source: "SYNTHETIC exercise model",
    sourceUrl: "https://example.com/synthetic",
    evidenceRef: "synthetic:hypothesis",
    capturedAt: now.toISOString(),
    confidence: 0.9,
  }, actor, now);
  assert.equal(discovery.score, beforeHypothesisScore, "AI hypotheses must contribute zero qualification points.");
  assert.equal(discovery.canPromote, false);

  const addSignal = async (signal: Record<string, unknown>) => {
    discovery = await addPropertyRelevanceSignal(discovery.id, { version: discovery.version, ...signal }, actor, now);
  };
  await addSignal({
    key: "SELLER_MOTIVATION", group: "MOTIVATION", classification: "INDICATED", sourceType: "SELLER",
    statement: "SYNTHETIC fixture: seller asked about an as-is sale; not a real owner statement.",
    source: "SYNTHETIC isolated qualification fixture", sourceUrl: "https://example.com/synthetic-seller-note",
    evidenceRef: "synthetic:seller-motivation", capturedAt: now.toISOString(), confidence: 0.9,
  });
  await addSignal({
    key: "TAX_DELINQUENCY", group: "DISTRESS", classification: "OBSERVED", sourceType: "ANALYST",
    statement: "SYNTHETIC fixture: a test record indicates delinquency; not a real parcel fact.",
    source: "SYNTHETIC isolated qualification fixture", sourceUrl: "https://example.com/synthetic-tax-record",
    evidenceRef: "synthetic:tax-delinquency", capturedAt: now.toISOString(), confidence: 0.9,
  });
  await addSignal({
    key: "REPORTED_POOR_CONDITION", group: "CONDITION", classification: "OBSERVED", sourceType: "ANALYST",
    statement: "SYNTHETIC fixture: inspection note indicates repair needs; not a real parcel fact.",
    source: "SYNTHETIC isolated qualification fixture", sourceUrl: "https://example.com/synthetic-inspection",
    evidenceRef: "synthetic:condition", capturedAt: now.toISOString(), confidence: 0.9,
  });
  assert.equal(discovery.status, "RELEVANT_CANDIDATE");
  assert.equal(discovery.canPromote, true, "Strong synthetic, independently referenced evidence should pass the market gate.");
  assert.ok(discovery.score >= 35);
  assert.ok(discovery.signals.every((signal) => signal.source && signal.capturedAt && signal.classification));

  const promoted = await promotePropertyDiscovery(discovery.id, {
    version: discovery.version,
    reviewReason: "SYNTHETIC exercise only: evidence threshold and independent source groups were deliberately supplied.",
  }, actor, now);
  assert.equal(promoted.discovery.status, "QUALIFIED_LEAD");
  assert.equal(promoted.discovery.leadId, promoted.leadId);
  assert.equal(promoted.discovery.canPromote, false);
  assert.equal(promoted.discovery.nextAction, "Verify seller identity and contact permission, then establish condition and underwriting inputs before any offer.");
  assert.ok(promoted.discovery.missingInformation.some((item) => /seller identity/i.test(item)));
  let detail = await leadDetail(promoted.leadId);
  assert.equal(detail.lead.stage, "ENRICHING");
  assert.equal(detail.lead.propertyQualification?.status, "QUALIFIED_LEAD");
  assert.equal(detail.lead.propertyQualification?.score, promoted.discovery.score);
  assert.ok(detail.lead.propertyQualification?.reason);
  assert.ok((detail.lead.propertyQualification?.signals.length ?? 0) >= 3);
  assert.equal(detail.lead.propertyQualification?.nextAction, detail.lead.nextAction);
  const center = await commandCenter("OWNER", now);
  const qualifiedOpportunity = center.propertyDiscoveries.records.find((item) => item.id === first.id);
  assert.equal(qualifiedOpportunity?.status, "QUALIFIED_LEAD");
  assert.equal(qualifiedOpportunity?.reason, promoted.discovery.reason);
  assert.equal(qualifiedOpportunity?.nextAction, detail.lead.nextAction);
  assert.equal(detail.lead.askingPrice, null);
  assert.equal(detail.lead.sellerName, "Seller not yet identified");
  assert.equal(detail.analysis, null);
  assert.equal(detail.offers.length, 0);
  assert.ok(detail.intelligence.some((entry) => entry.source === "SYNTHETIC isolated qualification fixture"));
  assert.ok(!(await callQueue(now)).some((brief) => brief.lead.id === promoted.leadId));
  await assert.rejects(() => importPublicProperty(property.id, true, actor, now), /Direct property-to-lead import is disabled/);

  // The existing public-source research/comparable workflow remains attached to the promoted lead.
  await refreshSourceResearch(promoted.leadId, detail.lead.version, true, actor, now);
  const saved = (await getSourceResearch(promoted.leadId)).research!;
  assert.equal(saved.subject.id, property.id);
  assert.ok(saved.candidates.every((candidate) => candidate.comp.verified === false && candidate.comp.condition === "UNKNOWN"));
  detail = await leadDetail(promoted.leadId);
  await assert.rejects(() => addSourceComps(promoted.leadId, { version: detail.lead.version, recordIds: ["not-a-source-id"] }, actor), /not supplied/);
  const selected = saved.candidates.slice(0, 3).map((candidate) => candidate.record.id);
  detail = await addSourceComps(promoted.leadId, { version: detail.lead.version, recordIds: selected }, actor);
  assert.equal(detail.underwriting!.comps.length, selected.length);
  assert.equal(detail.analysis!.classification, "INCOMPLETE");
  assert.ok(detail.analysis!.blockers.some((reason) => reason.includes("renovated")));
  assert.equal(detail.analysis!.maximumApprovedAcquisitionPrice, null);
  const snapshot = detail.analysisSnapshotId;
  const underwriting = detail.underwriting;
  await refreshSourceResearch(promoted.leadId, detail.lead.version, true, actor, now);
  detail = await leadDetail(promoted.leadId);
  assert.equal(detail.analysisSnapshotId, snapshot);
  assert.deepEqual(detail.underwriting, underwriting);
  assert.equal(detail.offers.length, 0);

  const unsupported = await createLead({
    address: "123 Synthetic Test Street", city: "Test", state: "FL", county: "Test", zip: "33101",
    propertyType: "SINGLE_FAMILY", sqft: 1000, beds: 3, baths: 2, units: 1,
    sellerName: "SYNTHETIC", source: "Isolated unsupported-source fixture; NOT a real seller.",
  }, actor.id, now);
  await assert.rejects(() => refreshSourceResearch(unsupported.id, unsupported.version, true, actor, now), /jurisdiction/);
  const weakProperty = search.records.find((record) => record.id !== property.id);
  assert.ok(weakProperty, "A second parcel is needed to verify the pass workflow.");
  const rawRecord = await recordPublicPropertyDiscovery(weakProperty.id, true, actor, now);
  const passed = await disqualifyPropertyDiscovery(rawRecord.id, {
    version: rawRecord.version,
    reason: "SYNTHETIC exercise verifies that a weak unrelated property can be passed without deleting its raw source observation.",
  }, actor, now);
  assert.equal(passed.status, "DISQUALIFIED");
  assert.equal(passed.sourceObservationCount, 1);
  assert.equal(passed.leadId, null);

  const buyerResearch = await searchPublicProperties(undefined, "buyer_candidates");
  assert.ok(buyerResearch.records.length > 0);
  assert.ok(buyerResearch.records.every((record) => record.entityCandidate && record.classification === "OBSERVED"));
  logger.info({
    records: search.records.length,
    savedDiscoveryId: first.id,
    repeatedSourceObservationCount: repeated.sourceObservationCount,
    crossSourceObservationCount: secondary.sourceObservationCount,
    qualifiedLeadId: promoted.leadId,
    buyerResearchCandidates: buyerResearch.records.length,
    checks: "real OPA observation persistence; no lead on discovery; same-source and cross-source dedupe; AI hypothesis exclusion; synthetic provenance-backed qualification; human promotion; not call ready; source research/comps; passed observations retained",
  }, "Selective property qualification exercise PASSED (isolated schema; actual public source row; synthetic qualification evidence only)");
} finally {
  await pool.end();
}
