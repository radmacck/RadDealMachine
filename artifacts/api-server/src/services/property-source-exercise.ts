/**
 * Real Philadelphia OPA discovery through PostgreSQL and qualification services.
 * Synthetic evidence is clearly labeled and runs only inside the isolated exercise schema.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db, pool, jobsTable, leadsTable, intelligenceTable, analysesTable, offersTable, contractsTable, propertySourceObservationsTable,
  unmatchedPropertySourceObservationsTable,
} from "@workspace/db";
import { ListPropertySourcesResponse } from "@workspace/api-zod";
import { DomainError } from "@workspace/deal-domain";
import type { PropertySourceRefresh } from "@workspace/property-sources";
import { logger } from "../lib/logger";
import { commandCenter } from "./command-center";
import {
  addPropertyRelevanceSignal, disqualifyPropertyDiscovery, listPropertyDiscoveries,
  linkUnmatchedPropertySourceObservations, persistUnmatchedPropertySourceObservations,
  promotePropertyDiscovery, recordPropertyObservation, recordPublicPropertyDiscovery,
  refreshPropertySourceEvidence, stalePropertySourceRefreshTargets,
} from "./property-discovery-store";
import { addSourceComps, getSourceResearch, importPublicProperty, listPropertySources, refreshSourceResearch, searchPublicProperties } from "./property-source-store";
import { addIntelligence, callQueue, createLead, leadDetail, updateLead, saveUnderwriting, transitionLead, recordCall } from "./deal-store";
import { createBuyer, verifyBuyer } from "./buyer-store";
import * as offers from "./offer-store";
import * as transactions from "./transaction-store";
import { dealOperations } from "./matching-store";
import { exerciseEvidence } from "./exercise-evidence";
import { runWorkerOnce, submitWorkerJob } from "./workers";
import {
  allPropertySourceConnectors,
  listPropertySourceDescriptors,
  runPropertyDiscoveryConnectors,
  runPropertyEvidenceRefresh,
} from "./property-source-connectors";

const actor = { id: `synthetic-source:${randomUUID()}`, role: "OWNER" };
const now = new Date();
try {
  const registeredConnectors = allPropertySourceConnectors();
  assert.ok(registeredConnectors.length >= 4, "The live system must register multiple real, replaceable source adapters.");
  const listedSources = ListPropertySourcesResponse.parse(listPropertySources());
  assert.equal(new Set(listedSources.map(source => source.id)).size,
    listedSources.length, "The public source catalog must deduplicate source descriptors and conform to the API contract.");
  assert.ok(listedSources.length >= 5, "The public catalog must enumerate the live OPA, L&I, unsafe-building, vacancy, and deed-record sources.");
  assert.ok(registeredConnectors.some(connector => connector.id === "phila-opa" &&
    connector.searchProperties && connector.propertyById && connector.discoverProperties));
  assert.ok(registeredConnectors.some(connector => connector.id === "phila-li-enforcement" &&
    connector.discoverProperties && connector.refreshEvidence));
  assert.ok(registeredConnectors.some(connector => connector.id === "phila-vacancy-indicators" &&
    connector.refreshEvidence));
  assert.ok(registeredConnectors.some(connector => connector.discoverBuyerActivity),
    "Current buyer activity research must also run through a registered source adapter.");
  const connectorFailureProbe = await runPropertyDiscoveryConnectors([
    {
      id: "exercise-source-success",
      sources: [{id:"exercise-source-success",name:"Synthetic source exercise",coverage:"Isolated exercise only",termsUrl:"https://example.com/terms",capabilities:["synthetic test"],limitations:["not a real feed"]}],
      discoverProperties: async () => ({properties:[],unmatchedObservations:[]}),
    },
    {
      id: "exercise-source-failure",
      sources: [{id:"exercise-source-failure",name:"Synthetic failing exercise",coverage:"Isolated exercise only",termsUrl:"https://example.com/terms",capabilities:["synthetic test"],limitations:["not a real feed"]}],
      discoverProperties: async () => { throw new Error("controlled connector failure"); },
    },
  ], now);
  assert.equal(connectorFailureProbe.batches.length, 1, "A failing source must not discard another source's results.");
  assert.equal(connectorFailureProbe.failures[0]?.connectorId, "exercise-source-failure");
  assert.equal(connectorFailureProbe.failures[0]?.operation, "DISCOVER");
  const refreshBatchSizes: number[] = [];
  const refreshFailureProbe = await runPropertyEvidenceRefresh([
    {
      id: "exercise-refresh-success",
      sources: [{id:"exercise-refresh-success",name:"Synthetic refresh exercise",coverage:"Isolated exercise only",termsUrl:"https://example.com/terms",capabilities:["synthetic test"],limitations:["not a real feed"]}],
      maxRefreshBatchSize: 2,
      refreshEvidence: async (ids) => { refreshBatchSizes.push(ids.length); return []; },
    },
    {
      id: "exercise-refresh-failure",
      sources: [{id:"exercise-refresh-failure",name:"Synthetic failing refresh",coverage:"Isolated exercise only",termsUrl:"https://example.com/terms",capabilities:["synthetic test"],limitations:["not a real feed"]}],
      refreshEvidence: async () => { throw new Error("controlled refresh failure"); },
    },
  ], ["parcel-1","parcel-2","parcel-3"], now);
  assert.deepEqual(refreshBatchSizes, [2,1], "Connector-specific refresh batch limits must work without imposing a global connector cap.");
  assert.equal(refreshFailureProbe.failures[0]?.connectorId, "exercise-refresh-failure");
  assert.equal(refreshFailureProbe.failures[0]?.operation, "REFRESH");
  await assert.rejects(() => submitWorkerJob({
    kind: "DISCOVER_PROPERTIES", idempotencyKey: "synthetic-property-no-terms",
  }, actor), /reviewed source terms/i);
  const discoveryJob = await submitWorkerJob({
    kind: "DISCOVER_PROPERTIES", idempotencyKey: "synthetic-property-source-worker",
    termsReviewed: true, recurringPropertyDiscovery: true,
  }, actor);
  const discoveryRun = await runWorkerOnce(now, false, discoveryJob.id);
  assert.equal(discoveryRun?.state, "SUCCEEDED", "The durable seller discovery job must complete from the official source.");
  assert.match(discoveryRun?.message ?? "", /Registered discovery connector results:.*phila-opa/);
  assert.match(discoveryRun?.message ?? "", /no active lead was created/i);
  const unmatchedCountFromRun = Number(discoveryRun?.message?.match(/Retained (\d+) unmatched L&I source observations/)?.[1]);
  assert.ok(Number.isInteger(unmatchedCountFromRun), "Worker outcome must report the count of unmatched source observations retained.");
  const liveUnmatched = await db.select().from(unmatchedPropertySourceObservationsTable);
  assert.equal(liveUnmatched.length, unmatchedCountFromRun, "Every real unmatched L&I parcel returned by the worker must be persisted without a property or lead.");
  assert.ok(liveUnmatched.every(row => row.status === "UNMATCHED" && row.linkedDiscoveryId === null));
  assert.ok(liveUnmatched.every(row => row.sourceKey.startsWith("phila-li-violations:") && row.propertyId.length === 9));
  const liveDiscoveryList = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA" });
  assert.ok(liveDiscoveryList.records.length > 0);
  assert.ok(liveDiscoveryList.records.every(record => record.demandFit.snapshotFresh),
    "The durable worker must persist demand snapshots that agree with the current buyer-evidence versions.");
  assert.ok(liveDiscoveryList.records.every(record => record.priorityScore >= record.score),
    "Demand ranking may add a separate priority bonus but cannot reduce seller relevance.");
  assert.ok(liveDiscoveryList.records.every(record => Array.isArray(record.property.contactPaths)),
    "The API response must preserve contact-path evidence, including an explicit empty list when OPA has no mailing route.");
  assert.equal(liveDiscoveryList.unmatchedSourceObservations.length, liveUnmatched.length);
  assert.ok(liveDiscoveryList.unmatchedSourceObservations.every(row => row.nextAction.includes("exact residential OPA match")));
  const observedSources = await db.select().from(propertySourceObservationsTable);
  assert.ok(observedSources.some(row => row.sourceKey.startsWith("phila-opa:")), "OPA raw observations must persist.");
  assert.ok(observedSources.some(row => row.sourceKey.startsWith("phila-li-violations:")), "The L&I violations adapter must persist matched or explicit no-match observations.");
  assert.ok(observedSources.some(row => row.sourceKey.startsWith("phila-li-unsafe:")), "The unsafe-building adapter must persist matched or explicit no-match observations.");
  assert.ok(observedSources.some(row => row.sourceKey.startsWith("phila-vacancy-indicators:")), "The vacancy adapter must persist matched, stale, or explicit no-match observations.");
  assert.equal((await db.select().from(leadsTable)).length, 0, "Raw property discovery must never create active leads.");

  const unmatchedFixture: PropertySourceRefresh = {
    sourceKey: `synthetic-unmatched:${randomUUID()}`,
    sourceId: `synthetic-public-record:${randomUUID()}`,
    propertyId: "999999999",
    sourceName: "SYNTHETIC isolated unmatched-source fixture",
    sourceUrl: "https://example.com/synthetic-unmatched-source",
    capturedAt: now.toISOString(),
    payload: {
      state: "SOURCE_RECORD_OBSERVED",
      recordCount: 1,
      recordIdentities: ["synthetic-record-1"],
      latestSourceEventAt: now.toISOString(),
      evidenceRef: "synthetic:unmatched-record-1",
    },
    signal: {
      id: `synthetic-signal:${randomUUID()}`,
      key: "OPEN_CODE_VIOLATION",
      group: "CONDITION",
      classification: "OBSERVED",
      sourceType: "PUBLIC_RECORD",
      statement: "SYNTHETIC fixture: public violation record; not a real parcel fact.",
      source: "SYNTHETIC isolated source exercise",
      sourceUrl: "https://example.com/synthetic-unmatched-source",
      evidenceRef: "synthetic:unmatched-record-1",
      capturedAt: now.toISOString(),
      confidence: 0.6,
    },
  };
  await persistUnmatchedPropertySourceObservations([unmatchedFixture], actor.id, now);
  const changedUnmatchedFixture: PropertySourceRefresh = {
    ...unmatchedFixture,
    capturedAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    payload: {
      state: "NO_CURRENT_MATCH",
      recordCount: 0,
      recordIdentities: [],
      latestSourceEventAt: null,
      evidenceRef: "synthetic:unmatched-record-1",
    },
    signal: null,
  };
  await persistUnmatchedPropertySourceObservations([changedUnmatchedFixture], actor.id, new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const unmatchedListAfterChange = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA" });
  const retainedSyntheticSource = unmatchedListAfterChange.unmatchedSourceObservations.find(row => row.sourceKey === unmatchedFixture.sourceKey);
  assert.ok(retainedSyntheticSource, "An unmatched raw source record remains available even without a matching property discovery.");
  assert.equal(retainedSyntheticSource.status, "UNMATCHED");
  assert.equal(retainedSyntheticSource.seenCount, 2);
  assert.equal(retainedSyntheticSource.history.length, 1);
  assert.equal(retainedSyntheticSource.history[0]?.state, "SOURCE_RECORD_OBSERVED");
  assert.equal(retainedSyntheticSource.history[0]?.classification, "OBSERVED");
  assert.equal((await db.select().from(leadsTable)).length, 0, "Persisting an unmatched source record must not create a lead.");

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
  assert.ok(first.sourceObservationCount >= 4, "A source-backed property keeps separate OPA, L&I, unsafe-building and vacancy observations.");
  assert.match(first.reason, /not a lead|signal|candidate/i);
  assert.ok(first.signals.every(signal => signal.source && signal.sourceUrl && signal.evidenceRef && signal.capturedAt));
  const matchedLeads = await db.select().from(leadsTable).where(sql`${leadsTable.payload}->>'address' = ${property.address}`);
  assert.equal(matchedLeads.length, 0, "Saving the source observation must not create a lead row.");

  const repeated = await recordPublicPropertyDiscovery(property.id, true, actor, now);
  assert.equal(repeated.id, first.id, "Repeated OPA parcel imports must deduplicate by property identity.");
  assert.equal(repeated.sourceObservationCount, first.sourceObservationCount, "The same source connectors update in place rather than duplicating their observations.");
  const [repeatRow] = await db.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.sourceKey, `phila-opa:${property.id}`));
  assert.equal(repeatRow?.seenCount, 3, "The worker capture and two manual imports update one deduplicated source observation.");
  const savedOpaPayload = repeatRow?.payload as { contactPaths?: unknown[] } | undefined;
  assert.ok(Array.isArray(savedOpaPayload?.contactPaths), "The official OPA source observation persists contact-path evidence.");
  for (const path of savedOpaPayload.contactPaths) {
    assert.equal((path as { sourceId?: string }).sourceId, property.provider);
    assert.equal((path as { classification?: string }).classification, "OBSERVED");
    assert.equal((path as { permissionStatus?: string }).permissionStatus, "NOT_REVIEWED");
  }
  const secondary = await recordPropertyObservation(
    { ...property, provider: "SYNTHETIC_SECONDARY_SOURCE", sourceUrl: "https://example.com/synthetic-record" },
    `synthetic-secondary:${property.id}`, actor.id, now,
  );
  assert.equal(secondary.id, first.id, "A second source with the same normalized property identity must attach to one discovery.");
  assert.equal(secondary.sourceObservationCount, first.sourceObservationCount + 1);
  assert.equal(secondary.leadId, null);

  const demandBuyer = await createBuyer({
    name: "SYNTHETIC BUYER DEMAND FIT TEST ONLY",
    email: "synthetic-demand-fit@example.com",
    phone: "",
    source: "SYNTHETIC isolated demand-fit fixture; not a real buyer",
    status: "ACTIVE",
    criteria: {
      states: ["PA"], cities: ["Philadelphia"], zipCodes: property.zip ? [property.zip] : [],
      propertyTypes: [property.propertyType], maxPurchasePrice: 400000, maxRepairs: 100000,
      minBeds: 1, minSqft: 500, maxSqft: 5000, closingDays: 10,
      counties: ["Philadelphia"], excludedCounties: [], excludedCities: [], excludedZipCodes: [],
      minPurchasePrice: 0, minUnits: 1, maxUnits: 4, minBaths: 1,
      rehabTolerance: "HEAVY", strategies: ["FLIP"], fundingTypes: ["CASH"], maxConcurrentDeals: 2,
    },
  }, actor);
  const verifiedDemandBuyer = await verifyBuyer(demandBuyer.id, {
    version: demandBuyer.version,
    identityEvidenceUrl: "https://example.com/synthetic-demand-identity",
    fundingEvidenceUrl: "https://example.com/synthetic-demand-funds",
    verificationNote: "SYNTHETIC fixture only; not evidence about a real buyer.",
    availableFunds: 500000,
    evidenceAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 10 * 86400000).toISOString(),
    currentBuyingStatus: "BUYING",
    buyingEvidenceAt: now.toISOString(),
    buyingEvidenceUrl: "https://example.com/synthetic-current-buying",
    criteriaEvidenceUrl: "https://example.com/synthetic-current-criteria",
    verificationSource: "Synthetic isolated exercise response",
    confidence: 0.9,
    verifiedFundingTypes: ["CASH"],
  }, actor, now);
  assert.equal(verifiedDemandBuyer.approvalStatus, "APPROVED");
  const [demandJob] = await db.select().from(jobsTable)
    .where(eq(jobsTable.idempotencyKey, `buyer-demand:${demandBuyer.id}:${verifiedDemandBuyer.version}`));
  assert.ok(demandJob, "Current buyer evidence must queue a durable demand refresh.");
  const demandJobResult = await runWorkerOnce(now, false, demandJob.id);
  assert.equal(demandJobResult?.state, "SUCCEEDED");
  const demandUpdated = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA" });
  const demandSubject = demandUpdated.records.find(record => record.id === secondary.id);
  assert.ok(demandSubject);
  assert.equal(demandSubject.status, secondary.status, "Demand matching cannot promote or alter seller qualification.");
  assert.equal(demandSubject.leadId, null);
  assert.equal(demandSubject.demandFit.alignedBuyerCount, 1);
  assert.equal(demandSubject.demandFit.snapshotFresh, true);
  assert.ok(demandSubject.priorityScore > demandSubject.score, "Verified current demand affects ranking independently of seller relevance.");
  assert.ok(demandSubject.demandFit.missingInformation.length > 0, "Early demand fit must disclose missing deal-level underwriting inputs.");

  const resolvableFixture: PropertySourceRefresh = {
    ...unmatchedFixture,
    sourceKey: `synthetic-unmatched-link:${randomUUID()}`,
    sourceId: `synthetic-resolved-public-record:${randomUUID()}`,
    propertyId: property.id,
  };
  await persistUnmatchedPropertySourceObservations([resolvableFixture], actor.id, now);
  const linkResult = await linkUnmatchedPropertySourceObservations(new Map([[property.id, first.id]]), actor.id, now);
  assert.equal(linkResult.linked, 1, "An exact OPA account match should move a prior raw observation into the property's source trail.");
  const [linkedRawObservation] = await db.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.sourceKey, resolvableFixture.sourceKey));
  assert.equal(linkedRawObservation?.discoveryId, first.id);
  const [linkedInboxRow] = await db.select().from(unmatchedPropertySourceObservationsTable)
    .where(eq(unmatchedPropertySourceObservationsTable.sourceKey, resolvableFixture.sourceKey));
  assert.equal(linkedInboxRow?.status, "LINKED");
  assert.equal(linkedInboxRow?.linkedDiscoveryId, first.id);

  const beforeHypothesisScore = secondary.score;
  let discovery = await addPropertyRelevanceSignal(secondary.id, {
    version: demandSubject.version,
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
   assert.equal(discovery.leadId, null, "A weak or AI-only signal cannot create or promote a lead.");

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
  const sellerNextAction = "Verify seller identity and contact permission, then establish condition and underwriting inputs before any offer.";
  assert.ok(promoted.discovery.nextAction.startsWith(sellerNextAction));
  assert.match(promoted.discovery.nextAction, /Current buyer demand aligns with 1 profile/);
  assert.ok(promoted.discovery.missingInformation.some((item) => /seller identity/i.test(item)));
  let detail = await leadDetail(promoted.leadId);
  assert.equal(detail.lead.stage, "ENRICHING");
  assert.equal(detail.lead.propertyQualification?.status, "QUALIFIED_LEAD");
  assert.equal(detail.lead.propertyQualification?.score, promoted.discovery.score);
  assert.ok(detail.lead.propertyQualification?.reason);
  assert.ok((detail.lead.propertyQualification?.signals.length ?? 0) >= 3);
  assert.equal(detail.lead.propertyQualification?.nextAction, detail.lead.nextAction);
  assert.equal(detail.lead.nextAction, sellerNextAction, "Demand notes must not replace the seller's principal next action.");
  const center = await commandCenter("OWNER", now);
  const qualifiedOpportunity = center.propertyDiscoveries.records.find((item) => item.id === first.id);
  assert.equal(qualifiedOpportunity?.status, "QUALIFIED_LEAD");
  assert.equal(qualifiedOpportunity?.reason, promoted.discovery.reason);
  assert.equal(qualifiedOpportunity?.nextAction, promoted.discovery.nextAction);
  assert.equal(qualifiedOpportunity?.demandFit.alignedBuyerCount, 1);
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
  assert.ok(passed.sourceObservationCount >= 4);
  assert.equal(passed.leadId, null);

  const buyerResearch = await searchPublicProperties(undefined, "buyer_candidates");
  assert.ok(buyerResearch.records.length > 0);
  assert.ok(buyerResearch.records.every((record) => record.entityCandidate && record.classification === "OBSERVED"));
  const staleTargets = await stalePropertySourceRefreshTargets(new Date(now.getTime() + 7 * 60 * 60 * 1000));
  assert.ok(staleTargets.includes(property.id), "Previously qualified/candidate parcels become eligible for recurring source refresh after six hours.");
  const sourceObservations = await db.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.discoveryId, first.id));
  const refreshableObservation = sourceObservations.find(row => !row.sourceKey.startsWith("phila-opa:"));
  assert.ok(refreshableObservation, "A linked non-OPA source observation is required to exercise source-change propagation.");
  await db.update(propertySourceObservationsTable).set({
    payload: {
      ...refreshableObservation.payload,
      signalId: `synthetic-prior-signal:${randomUUID()}`,
      evidenceRef: "https://example.com/synthetic-prior-evidence",
    },
  }).where(eq(propertySourceObservationsTable.id, refreshableObservation.id));

  // Build a persisted, synthetic seller offer and unexecuted transaction against
  // the promoted source-linked lead. The source refresh below must stale it.
  detail = await leadDetail(promoted.leadId);
  const lead = detail.lead;
  await updateLead(promoted.leadId, {
    version: lead.version,
    address: lead.address, city: lead.city, state: lead.state, county: lead.county, zip: lead.zip,
    propertyType: lead.propertyType, sqft: lead.sqft ?? 1000, beds: lead.beds ?? 3, baths: lead.baths ?? 2,
    units: lead.units ?? 1, askingPrice: 50000, sellerName: "SYNTHETIC source-refresh exercise only",
    sellerPhone: "000-000-0000", source: "SYNTHETIC isolated property-source exercise; no real seller contact",
  }, actor.id, now);
  detail = await leadDetail(promoted.leadId);
  const sellerAuthority = await addIntelligence(promoted.leadId, {
    classification: "VERIFIED_FACTS", category: "ownership",
    statement: "Synthetic owner-authority fixture for isolated source-refresh behavior; not a real title fact.",
    source: "Synthetic isolated exercise evidence", sourceType: "PUBLIC_RECORD", confidence: 0.9,
    capturedAt: now.toISOString(), verificationNote: "Synthetic test fixture only; no real owner or property is represented.",
  }, actor.id, now);
  detail = await leadDetail(promoted.leadId);
  const future = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  const syntheticUnderwriting = {
    version: detail.lead.version, repairsComplete: true, conditionConfirmed: true,
    comps: [0, 1, 2].map(index => ({
      id: `synthetic-source-refresh-comp-${index}`,
      address: `SYNTHETIC SOURCE REFRESH COMP ${index}`,
      salePrice: 300000 + index * 10000, sqft: Math.max(1, detail.lead.sqft ?? 1000),
      soldAt: new Date(now.getTime() - (10 + index) * 86_400_000).toISOString().slice(0, 10),
      distanceMiles: 0.5, propertyType: detail.lead.propertyType,
      condition: "RENOVATED" as const, source: "Synthetic isolated fixture", verified: true,
    })),
    repairs: [{ category: "Synthetic repair scope", low: 10000, expected: 20000, high: 30000,
      confidence: 0.8, source: "Synthetic isolated repair fixture" }],
  };
  Object.assign(syntheticUnderwriting, await exerciseEvidence(promoted.leadId, syntheticUnderwriting, actor.id, now));
  detail = await saveUnderwriting(promoted.leadId, syntheticUnderwriting, actor.id, now);
  assert.ok(detail.analysis, "Synthetic underwriting should persist its deterministic calculation.");
  assert.ok(["STRONG", "NEGOTIABLE"].includes(detail.analysis.classification),
    `Synthetic source-refresh deal must be offer-ready: ${JSON.stringify({classification:detail.analysis.classification,blockers:detail.analysis.blockers,mao:detail.analysis.mao})}`);
  detail = await transitionLead(promoted.leadId, {
    version: detail.lead.version, to: "CALL_READY",
    reason: "Synthetic isolated call-readiness gate.", nextAction: "Synthetic exercise only.",
  }, actor.id, now);
  detail = await recordCall(promoted.leadId, {
    version: detail.lead.version, outcome: "CONNECTED",
    notes: "Synthetic exercise only; no external call occurred.",
    nextAction: "Prepare synthetic exact terms.", followUpAt: future(24),
  }, actor.id, now);
  const commandDesk = await commandCenter("OPERATOR", now);
  const persistedCallAction = commandDesk.actions.find(action => action.leadId === promoted.leadId);
  assert.equal(persistedCallAction?.href, `/calls?lead=${promoted.leadId}`,
    "The real command-center API must link a call-ready/follow-up action to the selected seller's live call form.");
  assert.equal(persistedCallAction?.cta, "Open call brief");
  detail = await offers.createOfferDraft(promoted.leadId, {
    version: detail.lead.version, amount: 50000, earnestMoney: 500, closingDays: 30,
    contingencies: "Synthetic exercise only.", assignmentIntent: true,
    reason: "Synthetic source-refresh invalidation test.",
  }, actor, now);
  const sourceTestOfferId = detail.offers[0]!.id;
  detail = await offers.authorizeOffer(promoted.leadId, sourceTestOfferId, {
    version: detail.lead.version, maximumApprovedAcquisitionPrice: 50000,
    authorityEvidenceId: sellerAuthority.id, expiresAt: future(48),
    reason: "Synthetic owner review.", nextAction: "Synthetic exact terms.",
    followUpAt: future(24),
  }, actor, now);
  detail = await offers.communicateOffer(promoted.leadId, sourceTestOfferId, {
    version: detail.lead.version, amount: 50000, channel: "PHONE",
    evidence: "Synthetic communication attestation; no external contact occurred.",
    nextAction: "Prepare synthetic transaction review.", followUpAt: future(24),
  }, { id: actor.id, role: "OWNER" }, now);
  let sourceTestOperations = await transactions.createContract(promoted.leadId, {
    version: detail.lead.version, offerId: sourceTestOfferId, closingAt: future(20 * 24),
  }, { id: actor.id, role: "OWNER" }, now);
  assert.equal(sourceTestOperations.contract?.status, "DRAFT");
  sourceTestOperations = await transactions.preparePurchaseReviewDocument(promoted.leadId, {
    version: sourceTestOperations.contract!.version,
  }, { id: actor.id, role: "OWNER" }, now);
  assert.equal(sourceTestOperations.contract?.documents?.[0]?.status, "PREPARED_FOR_REVIEW");
  const sourceTestSnapshot = detail.analysisSnapshotId;
  assert.ok(sourceTestSnapshot);

  const staleRefresh = await refreshPropertySourceEvidence([property.id], "system:property-source-exercise", new Date(now.getTime() + 7 * 60 * 60 * 1000));
  assert.equal(staleRefresh.checked, 3, "The stale refresh rechecks each connected exact-parcel evidence source.");
  assert.ok(staleRefresh.changed > 0, "A changed source signal must be detected, not hidden by a fresh retrieval timestamp.");
  detail = await leadDetail(promoted.leadId);
  assert.equal(detail.analysis, null, "Changed public evidence invalidates pre-execution underwriting.");
  assert.equal(detail.analysisSnapshotId, null);
  assert.equal(detail.lead.stage, "ENRICHING");
  assert.equal(detail.offers.find(item => item.id === sourceTestOfferId)?.status, "INVALIDATED");
  const [staleContractRow] = await db.select().from(contractsTable)
    .where(eq(contractsTable.leadId, promoted.leadId));
  assert.equal(staleContractRow?.payload.status, "CANCELLED",
    "A changed source abandons only the unexecuted draft, not an executed transaction.");
  assert.ok(Array.isArray(staleContractRow?.payload.history));
  assert.match(String((staleContractRow?.payload.history as Array<Record<string, unknown>>).at(-1)?.note), /No signature or external cancellation is asserted/);
  sourceTestOperations = await dealOperations(promoted.leadId, new Date(now.getTime() + 7 * 60 * 60 * 1000));
  assert.match(sourceTestOperations.nextAction, /Refresh evidence and underwriting/);
  const sourceTestDocumentId = sourceTestOperations.contract!.documents![0]!.id;
  const archivedWorksheet = await transactions.downloadPurchaseReviewDocument(promoted.leadId, sourceTestDocumentId,
    { id: actor.id, role: "OWNER" }, new Date(now.getTime() + 7 * 60 * 60 * 1000));
  assert.equal(archivedWorksheet.bytes.subarray(0, 5).toString(), "%PDF-",
    "The superseded review copy remains available as an audit artifact, not current transaction authority.");
  await assert.rejects(
    transactions.executeContract(promoted.leadId, {
      version: sourceTestOperations.contract!.version,
      executedDocumentUrl: "https://example.com/synthetic-stale-document",
      sellerSignedAt: new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString(),
      acquisitionSignedAt: new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString(),
      reviewNote: "Synthetic attempt to execute a stale, cancelled draft.",
    }, { id: actor.id, role: "OWNER" }, new Date(now.getTime() + 7 * 60 * 60 * 1000)),
    /terminal/,
    "The superseded review copy and cancelled attempt cannot be treated as executed authority.",
  );

  // The complete transaction exercise verifies real signature-evidence gates.
  // Here an isolated persisted-state fixture checks that this refresh branch
  // cannot mutate a transaction already in its executed lifecycle.
  const [savedAnalysis] = await db.select().from(analysesTable)
    .where(eq(analysesTable.id, sourceTestSnapshot));
  assert.ok(savedAnalysis);
  const immutableAnalysis = (savedAnalysis.snapshot as { analysis: Record<string, unknown> }).analysis;
  const [savedOffer] = await db.select().from(offersTable)
    .where(eq(offersTable.id, sourceTestOfferId));
  assert.ok(savedOffer);
  const activeOfferPayload = { ...savedOffer.payload } as Record<string, unknown>;
  delete activeOfferPayload.authorityEndedAt;
  delete activeOfferPayload.withdrawalReason;
  await db.update(offersTable).set({
    status: "COMMUNICATED", payload: activeOfferPayload, updatedAt: new Date(now.getTime() + 8 * 3_600_000),
  }).where(eq(offersTable.id, sourceTestOfferId));
  const archivedContractPayload: Record<string, unknown> = { ...staleContractRow!.payload, status: "UNDER_CONTRACT" };
  delete archivedContractPayload.cancelledAt;
  await db.update(contractsTable).set({
    payload: archivedContractPayload, version: staleContractRow!.version + 1,
    updatedAt: new Date(now.getTime() + 8 * 3_600_000),
  }).where(eq(contractsTable.id, staleContractRow!.id));
  await db.update(leadsTable).set({
    stage: "UNDER_CONTRACT", analysis: immutableAnalysis as typeof leadsTable.$inferSelect.analysis,
    analysisSnapshotId: sourceTestSnapshot,
    nextAction: "Synthetic executed-state boundary fixture; no real transaction is represented.",
    updatedAt: new Date(now.getTime() + 8 * 3_600_000),
  }).where(eq(leadsTable.id, promoted.leadId));
  await db.update(propertySourceObservationsTable).set({
    payload: {
      ...refreshableObservation.payload,
      signalId: `synthetic-executed-prior-signal:${randomUUID()}`,
      evidenceRef: "https://example.com/synthetic-executed-prior-evidence",
    },
  }).where(eq(propertySourceObservationsTable.id, refreshableObservation.id));
  const executedRefreshAt = new Date(now.getTime() + 8 * 3_600_000);
  const executedRefresh = await refreshPropertySourceEvidence([property.id], "system:property-source-exercise", executedRefreshAt);
  assert.ok(executedRefresh.changed > 0);
  const [executedLeadRow] = await db.select().from(leadsTable).where(eq(leadsTable.id, promoted.leadId));
  const [executedOfferRow] = await db.select().from(offersTable).where(eq(offersTable.id, sourceTestOfferId));
  const [executedContractRow] = await db.select().from(contractsTable).where(eq(contractsTable.leadId, promoted.leadId));
  assert.equal(executedLeadRow?.stage, "UNDER_CONTRACT");
  assert.equal(executedLeadRow?.analysisSnapshotId, sourceTestSnapshot);
  assert.deepEqual(executedLeadRow?.analysis, immutableAnalysis);
  assert.match(executedLeadRow?.nextAction ?? "", /Executed economics and commitments remain unchanged/);
  assert.equal(executedOfferRow?.status, "COMMUNICATED");
  assert.equal(executedContractRow?.payload.status, "UNDER_CONTRACT");
  assert.equal(executedContractRow?.payload.purchasePrice, 50000);
  const sourceReviewJobs = await db.select().from(jobsTable).where(eq(jobsTable.leadId, promoted.leadId));
  assert.ok(sourceReviewJobs.some(job => job.kind === "MATCH_BUYERS" && job.idempotencyKey.startsWith("source-evidence:")));

  logger.info({
    records: search.records.length,
    savedDiscoveryId: first.id,
    repeatedSourceObservationCount: repeated.sourceObservationCount,
    crossSourceObservationCount: secondary.sourceObservationCount,
    qualifiedLeadId: promoted.leadId,
    buyerResearchCandidates: buyerResearch.records.length,
    staleRefresh: staleRefresh.checked,
    checks: "real OPA and City L&I/vacancy source observation persistence; no lead on discovery; same-source and cross-source dedupe; AI hypothesis exclusion; synthetic provenance-backed qualification; human promotion; source research/comps; pass retention; source-change invalidation of pre-execution underwriting/offers/drafts; preservation of executed terms with a persisted research-review action and buyer-rematch job",
  }, "Selective property qualification exercise PASSED (isolated schema; actual public source row; synthetic qualification evidence only)");
} finally {
  await pool.end();
}
