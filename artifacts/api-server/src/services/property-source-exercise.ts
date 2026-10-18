/**
 * Real Philadelphia OPA discovery through PostgreSQL and qualification services.
 * Synthetic evidence is clearly labeled and runs only inside the isolated exercise schema.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import {
  db, pool, jobsTable, leadsTable, intelligenceTable, analysesTable, offersTable, contractsTable, propertyDiscoveriesTable, propertySourceObservationsTable,
  unmatchedPropertySourceObservationsTable,
} from "@workspace/db";
import { GetPropertySourceCoverageResponse, ListPropertySourcesResponse } from "@workspace/api-zod";
import { DomainError } from "@workspace/deal-domain";
import type { PropertySourceRefresh, PublicProperty } from "@workspace/property-sources";
import { logger } from "../lib/logger";
import { commandCenter } from "./command-center";
import {
  addPropertyRelevanceSignal, disqualifyPropertyDiscovery, listPropertyDiscoveries,
  linkUnmatchedPropertySourceObservations, persistUnmatchedPropertySourceObservations,
  promotePropertyDiscovery, recordPropertyObservation, recordPublicPropertyDiscovery, savePropertyContactResearchCase,
  refreshPropertySourceEvidence, stalePropertySourceRefreshTargets,
} from "./property-discovery-store";
import { addSourceComps, getPropertySourceCoverage, getSourceResearch, importPublicProperty, listPropertySources, refreshSourceResearch, searchPublicProperties } from "./property-source-store";
import { addIntelligence, callQueue, createLead, leadDetail, updateLead, saveUnderwriting, transitionLead, recordCall } from "./deal-store";
import { createBuyer, verifyBuyer } from "./buyer-store";
import * as offers from "./offer-store";
import { authorizeReviewedOffer } from "./offer-exercise-helpers";
import * as transactions from "./transaction-store";
import { dealOperations } from "./matching-store";
import { exerciseEvidence } from "./exercise-evidence";
import { runWorkerOnce, submitWorkerJob } from "./workers";
import { comparePropertyDiscoveriesByRank } from "./property-discovery-ranking";
import { rankPropertyAcquisitionQueue } from "@workspace/deal-domain";
import { getSellerContactPaths } from "./seller-contact-store";
import {
  allPropertySourceConnectors,
  listPropertySourceDescriptors,
  propertySourceConnectorsWithListingDescriptions,
  runPropertyDiscoveryConnectors,
  runPropertyEvidenceRefresh,
} from "./property-source-connectors";

const actor = { id: `synthetic-source:${randomUUID()}`, role: "OWNER" };
const now = new Date();
try {
  const registeredConnectors = allPropertySourceConnectors();
  const listingDescriptionConnectors = propertySourceConnectorsWithListingDescriptions();
  const persistedListingObservations = (await db.select({ total: count() }).from(propertySourceObservationsTable)
    .where(sql`${propertySourceObservationsTable.sourceKey} LIKE 'listing-description:%'`))[0]?.total ?? 0;
  assert.ok(registeredConnectors.length >= 7, "The live system must register multiple real, replaceable source adapters.");
  const listedSources = ListPropertySourcesResponse.parse(listPropertySources());
  assert.equal(new Set(listedSources.map(source => source.id)).size,
    listedSources.length, "The public source catalog must deduplicate source descriptors and conform to the API contract.");
  assert.ok(listedSources.length >= 8, "The public catalog must enumerate OPA, L&I, vacancy, transfer, sheriff-deed, permit, and demolition sources.");
  const sourceCoverage = GetPropertySourceCoverageResponse.parse(await getPropertySourceCoverage());
  assert.deepEqual(sourceCoverage.registeredSources.map(source => source.id).sort(), listedSources.map(source => source.id).sort());
  assert.ok(sourceCoverage.notConnectedProviders.some(provider =>
    provider.id === "zillow-listings-fsbo" && provider.status === "NOT_CONNECTED" && /has not queried/i.test(provider.reason)));
  assert.ok(sourceCoverage.notConnectedProviders.some(provider => provider.id === "redfin-listings"));
  assert.ok(sourceCoverage.notConnectedProviders.some(provider =>
    provider.id === "parcel-tax-delinquency" && /geographically aggregated/i.test(provider.reason)));
  assert.ok(sourceCoverage.notConnectedProviders.every(provider =>
    provider.reason.length > 0 && provider.nextAction.length > 0),
  "Unavailable source capabilities must have an explicit reason and a safe activation path, not connector-shaped placeholders.");
  assert.ok(registeredConnectors.some(connector => connector.id === "phila-opa" &&
    connector.searchProperties && connector.propertyById && connector.discoverProperties));
  assert.ok(registeredConnectors.some(connector => connector.id === "phila-li-enforcement" &&
    connector.discoverProperties && connector.refreshEvidence));
  assert.ok(registeredConnectors.some(connector => connector.id === "phila-vacancy-indicators" &&
    connector.refreshEvidence));
  assert.ok(registeredConnectors.some(connector => connector.id === "phila-li-building-permits" &&
    connector.discoverProperties && connector.refreshEvidence));
  assert.ok(registeredConnectors.some(connector => connector.id === "phila-li-demolitions" &&
    connector.discoverProperties && connector.refreshEvidence));
  assert.ok(registeredConnectors.some(connector => connector.id === "phila-sheriff-deed-records" &&
    connector.discoverProperties && connector.refreshEvidence),
  "The documented sheriff-deed subfeed must run through the property connector registry.");
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
  assert.equal(
    discoveryRun?.state,
    "SUCCEEDED",
    `The durable seller discovery job must complete from the official source; observed ${discoveryRun?.state ?? "missing"}: ${discoveryRun?.message ?? "no persisted run message"}`,
  );
  assert.match(discoveryRun?.message ?? "", /Registered discovery connector results:.*phila-opa/);
  assert.match(discoveryRun?.message ?? "", /no active lead was created/i);
  const sheriffTraversalMatch = discoveryRun?.message?.match(
    /phila-sheriff-deed-records: (\d+) property record\(s\), \d+ unmatched observation\(s\), traversed (\d+) page\(s\) \/ (\d+) source record\(s\), complete=true/,
  );
  assert.ok(sheriffTraversalMatch, "The live worker must report complete sheriff-deed keyset traversal metrics.");
  const sheriffDeedTraversal = {
    matchedProperties: Number(sheriffTraversalMatch![1]),
    pagesFetched: Number(sheriffTraversalMatch![2]),
    sourceRecordCount: Number(sheriffTraversalMatch![3]),
  };
  assert.ok(sheriffDeedTraversal.matchedProperties > 0 &&
    sheriffDeedTraversal.pagesFetched > 1 &&
    sheriffDeedTraversal.sourceRecordCount > 40,
  "The actual public-source exercise must prove that the sheriff-deed result set crosses page boundaries.");
  const unmatchedCountFromRun = Number(discoveryRun?.message?.match(/Retained (\d+) unmatched public-source observations/)?.[1]);
  assert.ok(Number.isInteger(unmatchedCountFromRun), "Worker outcome must report the count of unmatched source observations retained.");
  const liveUnmatched = await db.select().from(unmatchedPropertySourceObservationsTable);
  assert.equal(liveUnmatched.length, unmatchedCountFromRun, "Every real unmatched L&I parcel returned by the worker must be persisted without a property or lead.");
  assert.ok(liveUnmatched.every(row => row.status === "UNMATCHED" && row.linkedDiscoveryId === null));
  assert.ok(liveUnmatched.every(row => row.sourceKey.length > 0 && /^\d{9}$/.test(row.propertyId)));
  const livePageSize = 25;
  const liveDiscoveryList = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA", limit: livePageSize });
  const liveDiscoveryPages = [liveDiscoveryList];
  let liveDiscoveryPage = liveDiscoveryList;
  while (liveDiscoveryPage.hasMore) {
    assert.ok(liveDiscoveryPage.nextCursor, "Every non-final property page must expose a continuation cursor.");
    liveDiscoveryPage = await listPropertyDiscoveries({
      marketKey: "PHILADELPHIA_PA", limit: livePageSize, cursor: liveDiscoveryPage.nextCursor!,
    });
    liveDiscoveryPages.push(liveDiscoveryPage);
  }
  const liveDiscoveryRecords = liveDiscoveryPages.flatMap(page => page.records);
  const liveDiscoveryCount = Object.values(liveDiscoveryList.counts).reduce((sum, value) => sum + value, 0);
  assert.equal(liveDiscoveryList.contactCoverage.discoveryCount, liveDiscoveryCount,
    "Contact coverage must use the full persisted discovery pool, not just the current page.");
  assert.equal(liveDiscoveryList.contactCoverage.publicFeedPropertiesWithDirectRoute, 0,
    "The permitted public-source sample contains no direct phone, email, or web routes.");
  assert.equal(liveDiscoveryList.contactCoverage.publicFeedPropertiesWithCurrentPermittedVerifiedRoute, 0,
    "Public source coverage must not imply a current verified contact route where none exists.");
  assert.ok(liveDiscoveryPages.length > 1, "The live Philadelphia source exercise must traverse multiple persisted property pages.");
  assert.equal(liveDiscoveryRecords.length, liveDiscoveryCount, "Every persisted live discovery must be reachable through bounded pages.");
  assert.equal(new Set(liveDiscoveryRecords.map(record => record.id)).size, liveDiscoveryRecords.length,
    "Cross-page traversal must not repeat a discovery record.");
  assert.deepEqual(
    liveDiscoveryRecords.map(record => record.id),
    [...liveDiscoveryRecords]
      .sort((left, right) => comparePropertyDiscoveriesByRank(
        { id: left.id, score: left.score, updatedAt: left.lastObservedAt },
        { id: right.id, score: right.score, updatedAt: right.lastObservedAt },
      ))
      .map(record => record.id),
    "Live source pages must preserve the deterministic relevance / update / ID order.",
  );
  const repeatedLiveFirstPage = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA", limit: livePageSize });
  assert.deepEqual(repeatedLiveFirstPage.records.map(record => record.id), liveDiscoveryList.records.map(record => record.id),
    "Repeated reads of an unchanged live snapshot must return the same first-page order.");
  if (liveDiscoveryList.nextCursor) {
    await assert.rejects(
      () => listPropertyDiscoveries({
        marketKey: "PHILADELPHIA_PA", status: "DISCOVERED_PROPERTY", limit: livePageSize,
        cursor: liveDiscoveryList.nextCursor!,
      }),
      /cursor does not match this market or filter/i,
      "A cursor from the all-status view cannot be replayed against a different status filter.",
    );
  }
  const liveUnmatchedPages = [liveDiscoveryList];
  let liveUnmatchedPage = liveDiscoveryList;
  while (liveUnmatchedPage.unmatchedHasMore) {
    assert.ok(liveUnmatchedPage.unmatchedNextCursor, "Every non-final unmatched page must expose a continuation cursor.");
    liveUnmatchedPage = await listPropertyDiscoveries({
      marketKey: "PHILADELPHIA_PA", limit: livePageSize,
      unmatchedCursor: liveUnmatchedPage.unmatchedNextCursor!,
    });
    liveUnmatchedPages.push(liveUnmatchedPage);
  }
  const liveApiUnmatched = liveUnmatchedPages.flatMap(page => page.unmatchedSourceObservations);
  assert.equal(liveApiUnmatched.length, liveUnmatched.length,
    "All real unmatched public-source observations must be accessible through their bounded page sequence.");
  assert.equal(new Set(liveApiUnmatched.map(row => row.id)).size, liveApiUnmatched.length,
    "Unmatched-source pagination must not repeat source observation rows.");
  assert.ok(liveDiscoveryList.records.length > 0);
  assert.ok(liveDiscoveryRecords.every(record => record.demandFit.snapshotFresh),
    "The durable worker must persist demand snapshots that agree with the current buyer-evidence versions.");
  assert.ok(liveDiscoveryRecords.every(record => record.priorityScore >= record.score),
    "Demand ranking may add a separate priority bonus but cannot reduce seller relevance.");
  const queueOrder = rankPropertyAcquisitionQueue(liveDiscoveryRecords, now);
  const repeatedQueueOrder = rankPropertyAcquisitionQueue(liveDiscoveryRecords, now);
  assert.deepEqual(queueOrder.map(item => item.id), repeatedQueueOrder.map(item => item.id),
    "The persisted discovery queue must rank deterministically across identical API reads.");
  assert.ok(queueOrder.every(item => item.status === liveDiscoveryRecords.find(record => record.id === item.id)?.status),
    "Queue ranking cannot promote raw observations or change human-reviewed qualification.");
  assert.ok(queueOrder.some(item => item.acquisitionPriority.tasks.some(task => /direct seller contact route/.test(task))),
    "Missing seller contact data must create explicit acquisition work.");
  assert.equal((await db.select().from(leadsTable)).length, 0,
    "Prioritization of persisted public-source discoveries must not create qualified leads.");
  assert.ok(liveDiscoveryRecords.every(record => Array.isArray(record.property.contactPaths)),
    "The API response must preserve contact-path evidence, including an explicit empty list when OPA has no mailing route.");
  const liveContactPaths = liveDiscoveryRecords.flatMap(record => record.property.contactPaths);
  const liveContactChannelCounts = Object.fromEntries(
    ["POSTAL", "PHONE", "EMAIL", "WEB", "OTHER"].map(channel => [
      channel, liveContactPaths.filter(path => path.channel === channel).length,
    ]),
  );
  assert.equal(liveContactPaths.some(path => path.channel === "PHONE" || path.channel === "EMAIL" || path.channel === "WEB"), false,
    "Available Philadelphia public adapters expose no direct phone/email/web contact route; a mailing record remains postal-only.");
  assert.ok(liveApiUnmatched.every(row => row.nextAction.includes("exact residential OPA match")));
  const observedSources = await db.select().from(propertySourceObservationsTable);
  assert.ok(observedSources.some(row => row.sourceKey.startsWith("phila-opa:")), "OPA raw observations must persist.");
  assert.ok(observedSources.some(row => row.sourceKey.startsWith("phila-li-violations:")), "The L&I violations adapter must persist matched or explicit no-match observations.");
  assert.ok(observedSources.some(row => row.sourceKey.startsWith("phila-li-unsafe:")), "The unsafe-building adapter must persist matched or explicit no-match observations.");
  assert.ok(observedSources.some(row => row.sourceKey.startsWith("phila-vacancy-indicators:")), "The vacancy adapter must persist matched, stale, or explicit no-match observations.");
  const propertyFeedRows = [
    ...observedSources.map(row => ({ sourceId: row.sourceId, sourceKey: row.sourceKey, payload: row.payload, linked: true })),
    ...liveUnmatched.map(row => ({ sourceId: row.sourceId, sourceKey: row.sourceKey, payload: row.payload, linked: false })),
  ];
  const feedStats = (sourceId: string) => {
    const rows = propertyFeedRows.filter(row => row.sourceId === sourceId || row.sourceKey.startsWith(`${sourceId}:`));
    return {
      observationRows: rows.length,
      matchedRows: rows.filter(row => row.linked).length,
      unmatchedRows: rows.filter(row => !row.linked).length,
      sourceRecordCount: rows.reduce((total, row) => total +
        (typeof row.payload.recordCount === "number" ? row.payload.recordCount : 0), 0),
    };
  };
  const liveSourceCounts = listedSources.map(source => {
    const rows = propertyFeedRows.filter(row =>
      row.sourceId === source.id || row.sourceKey.startsWith(`${source.id}:`));
    const sourceRecordCount = rows.reduce((total, row) => {
      if (typeof row.payload.recordCount === "number") return total + row.payload.recordCount;
      if (Array.isArray(row.payload.recordIdentities)) return total + row.payload.recordIdentities.length;
      return total + 1;
    }, 0);
    return {
      sourceId: source.id,
      state: source.id === "phila-real-estate-transfers"
        ? "REGISTERED_BUYER_ACTIVITY_ONLY_NOT_RUN_IN_PROPERTY_EXERCISE"
        : rows.length ? "LIVE_AND_OBSERVED" : "NO_OBSERVATION_ROWS",
      observationRows: rows.length,
      matchedRows: rows.filter(row => "linked" in row && row.linked).length,
      unmatchedRows: rows.filter(row => "linked" in row && !row.linked).length,
      sourceRecordCount,
    };
  });
  const permitFeed = feedStats("phila-li-building-permits");
  const demolitionFeed = feedStats("phila-li-demolitions");
  const sheriffDeedFeed = feedStats("phila-sheriff-deed-records");
  assert.ok(permitFeed.observationRows > 0 && permitFeed.sourceRecordCount > 0,
    "The real public permit feed must return and persist at least one exact-parcel source observation.");
  assert.ok(demolitionFeed.observationRows > 0 && demolitionFeed.sourceRecordCount > 0,
    "The real public demolition feed must return and persist at least one exact-parcel source observation.");
  assert.ok(sheriffDeedFeed.observationRows > 0 && sheriffDeedFeed.sourceRecordCount > 0,
    "The real public sheriff-deed source must return and persist exact-parcel transfer observations.");
  for (const row of propertyFeedRows.filter(item =>
    ["phila-li-building-permits", "phila-li-demolitions", "phila-sheriff-deed-records"].includes(item.sourceId))) {
    assert.equal(row.payload.classification, "OBSERVED");
    assert.equal(row.payload.signalId ?? null, null, "Permit/demolition/transfer records must not become motivation signals.");
    assert.ok(typeof row.payload.evidenceDigest === "string" && row.payload.evidenceDigest.length === 64);
    assert.ok(Array.isArray(row.payload.records), "Source snapshots retain bounded raw and normalized event records.");
  }
  assert.ok(propertyFeedRows.some(row => row.sourceId === "phila-sheriff-deed-records" &&
    row.payload.identityMethod === "EXACT_OPA_ACCOUNT" &&
    typeof row.payload.latestSourceEventAt === "string" &&
    (row.payload.recordIdentities as string[] | undefined)?.length),
  "Persisted sheriff-deed observations must retain exact parcel identity, event time, and source record IDs.");
  assert.equal(new Set(liveDiscoveryRecords.map(record => record.property.id)).size,
    liveDiscoveryRecords.length, "Cross-source observations must share one exact-parcel discovery record across every result page.");
  assert.equal((await db.select().from(leadsTable)).length, 0, "Raw property discovery must never create active leads.");
  console.log(`LIVE property-source exercise results: ${JSON.stringify({
    persistedUniqueDiscoveries: liveDiscoveryRecords.length,
    persistedActiveLeadsFromRawDiscovery: 0,
    persistedUnmatchedObservations: liveUnmatched.length,
    sourceCounts: liveSourceCounts,
    sheriffDeedTraversal,
    directContactRoutes: "unavailable in current permitted feeds",
  })}`);

  const liveObservationRowsBeforeSynthetic = observedSources.length + liveUnmatched.length;
  const paginationTemplate = liveDiscoveryRecords[0]?.property;
  assert.ok(paginationTemplate, "The synthetic pagination exercise needs a property-shaped template from the real persisted response.");
  const syntheticPaginationRecords: Array<{
    id: string; version: number; property: typeof paginationTemplate; sourceKey: string; capturedAt: Date;
  }> = [];
  for (let index = 0; index < 110; index += 1) {
    const capturedAt = new Date(now.getTime() - (110 - index) * 1000);
    const syntheticProperty = {
      ...paginationTemplate,
      id: `SYNTHETIC-PAGINATION-${index}`,
      provider: "SYNTHETIC_PAGINATION_EXERCISE",
      parcelId: `SYNTHETIC-PAGINATION-PARCEL-${index}`,
      address: `${1000 + index} SYNTHETIC PAGINATION AVENUE`,
      recordedOwner: `SYNTHETIC PAGINATION OWNER ${index}`,
      sourceUrl: "https://example.invalid/synthetic-pagination",
      contactPaths: [],
      capturedAt: capturedAt.toISOString(),
    };
    const sourceKey = `synthetic-pagination:${index}`;
    const saved = await recordPropertyObservation(
      syntheticProperty,
      sourceKey,
      "synthetic-property-pagination-exercise",
      capturedAt,
    );
    syntheticPaginationRecords.push({ id: saved.id, version: saved.version, property: syntheticProperty, sourceKey, capturedAt });
    assert.equal(saved.leadId, null, "A synthetic raw source record must not create a lead.");
    assert.notEqual(saved.status, "CALL_READY", "A raw source record must never become call ready automatically.");
  }

  const strongSynthetic = syntheticPaginationRecords.at(-1)!;
  let strongSyntheticResult = await addPropertyRelevanceSignal(strongSynthetic.id, {
    version: strongSynthetic.version,
    key: "FORECLOSURE",
    group: "DISTRESS",
    classification: "VERIFIED",
    sourceType: "PUBLIC_RECORD",
    statement: "SYNTHETIC fixture only: test filing evidence, not a real property fact.",
    source: "SYNTHETIC isolated pagination test",
    sourceUrl: "https://example.invalid/synthetic-foreclosure",
    evidenceRef: "synthetic:pagination-foreclosure",
    capturedAt: now.toISOString(),
    confidence: 0.99,
  }, actor, now);
  strongSyntheticResult = await addPropertyRelevanceSignal(strongSynthetic.id, {
    version: strongSyntheticResult.version,
    key: "REPORTED_POOR_CONDITION",
    group: "CONDITION",
    classification: "OBSERVED",
    sourceType: "PUBLIC_RECORD",
    statement: "SYNTHETIC fixture only: observed test condition record, not a real property fact.",
    source: "SYNTHETIC isolated pagination test",
    sourceUrl: "https://example.invalid/synthetic-condition",
    evidenceRef: "synthetic:pagination-condition",
    capturedAt: now.toISOString(),
    confidence: 0.99,
  }, actor, now);
  strongSyntheticResult = await addPropertyRelevanceSignal(strongSynthetic.id, {
    version: strongSyntheticResult.version,
    key: "SELLER_MOTIVATION",
    group: "MOTIVATION",
    classification: "INDICATED",
    sourceType: "SELLER",
    statement: "SYNTHETIC fixture only: test seller motivation indication, not a real owner statement.",
    source: "SYNTHETIC isolated pagination test",
    sourceUrl: "https://example.invalid/synthetic-motivation",
    evidenceRef: "synthetic:pagination-motivation",
    capturedAt: now.toISOString(),
    confidence: 0.99,
  }, actor, now);
  assert.equal(strongSyntheticResult.status, "RELEVANT_CANDIDATE");
  assert.ok(strongSyntheticResult.score >= 35);
  assert.equal(strongSyntheticResult.leadId, null, "Even a strong synthetic candidate requires human promotion.");
  assert.notEqual(strongSyntheticResult.status, "CALL_READY", "Qualification ranking cannot bypass contact and call-readiness gates.");
  assert.ok(strongSyntheticResult.rankingReasons.some(reason => reason.includes("VERIFIED")));
  assert.ok(strongSyntheticResult.rankingReasons.some(reason => reason.includes("OBSERVED")));

  const hypothesisSynthetic = syntheticPaginationRecords[0]!;
  const beforeSyntheticHypothesisScore = hypothesisSynthetic.version;
  const hypothesisResult = await addPropertyRelevanceSignal(hypothesisSynthetic.id, {
    version: beforeSyntheticHypothesisScore,
    key: "VACANCY",
    group: "VACANCY",
    classification: "AI_HYPOTHESIS",
    sourceType: "MODEL",
    statement: "SYNTHETIC fixture only: unconfirmed vacancy hypothesis.",
    source: "SYNTHETIC isolated pagination model",
    sourceUrl: "https://example.invalid/synthetic-vacancy-hypothesis",
    evidenceRef: "synthetic:pagination-vacancy-hypothesis",
    capturedAt: now.toISOString(),
    confidence: 0.95,
  }, actor, now);
  assert.equal(hypothesisResult.signals.find(signal => signal.evidenceRef === "synthetic:pagination-vacancy-hypothesis")?.classification,
    "AI_HYPOTHESIS", "Persisted ranking responses retain hypothesis classification.");
  assert.equal(hypothesisResult.signals.find(signal => signal.evidenceRef === "synthetic:pagination-vacancy-hypothesis")?.scoreContribution,
    0, "AI hypotheses cannot add seller relevance points.");
  assert.ok(hypothesisResult.rankingReasons.some(reason => reason.includes("AI_HYPOTHESIS") && reason.includes("zero ranking points")));

  const duplicateSyntheticProperty = {
    ...strongSynthetic.property,
    id: "SYNTHETIC-PAGINATION-SECOND-SOURCE",
    parcelId: strongSynthetic.property.parcelId ?? "SYNTHETIC-PAGINATION-STRONG-PARCEL",
    provider: "SYNTHETIC_PAGINATION_SECOND_SOURCE",
    sourceUrl: "https://example.invalid/synthetic-pagination-second-source",
    contactPaths: [],
  };
  const duplicateSynthetic = await recordPropertyObservation(
    duplicateSyntheticProperty,
    "synthetic-pagination-second-source:strong-parcel",
    "synthetic-property-pagination-exercise",
    now,
  );
  assert.equal(duplicateSynthetic.id, strongSynthetic.id, "A second source for the same synthetic parcel must deduplicate to one property discovery.");
  assert.equal(duplicateSynthetic.leadId, null);
  const crossFeedObservations = await db.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.discoveryId, strongSynthetic.id));
  assert.ok(crossFeedObservations.some(row => row.sourceKey === strongSynthetic.sourceKey));
  assert.ok(crossFeedObservations.some(row => row.sourceKey === "synthetic-pagination-second-source:strong-parcel"),
    "Cross-feed property deduplication must retain each source observation and its own source key.");
  assert.ok(crossFeedObservations.length >= 2);

  const [sourceObservationBeforeReplay] = await db.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.sourceKey, strongSynthetic.sourceKey));
  const [discoveryBeforeReplay] = await db.select().from(propertyDiscoveriesTable)
    .where(eq(propertyDiscoveriesTable.id, strongSynthetic.id));
  const exactReplay = await recordPropertyObservation(
    strongSynthetic.property as Parameters<typeof recordPropertyObservation>[0],
    strongSynthetic.sourceKey,
    "synthetic-property-pagination-exercise",
    strongSynthetic.capturedAt,
  );
  const [sourceObservationAfterReplay] = await db.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.sourceKey, strongSynthetic.sourceKey));
  assert.equal(exactReplay.version, discoveryBeforeReplay?.version, "An exact same-capture replay must not bump the persisted discovery version.");
  assert.equal(sourceObservationAfterReplay?.seenCount, sourceObservationBeforeReplay?.seenCount,
    "An exact same-capture replay must not inflate observation counts.");

  await assert.rejects(
    recordPropertyObservation(
      { ...strongSynthetic.property, id: `${strongSynthetic.property.id}-CONFLICT`, parcelId: "CONFLICTING-PARCEL-ID" } as Parameters<typeof recordPropertyObservation>[0],
      strongSynthetic.sourceKey,
      "synthetic-property-pagination-exercise",
      strongSynthetic.capturedAt,
    ),
    /conflicting property identity/,
    "A reused source-record key cannot silently move to a different property.",
  );
  const [sourceObservationAfterConflict] = await db.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.sourceKey, strongSynthetic.sourceKey));
  assert.equal(sourceObservationAfterConflict?.sourceId, strongSynthetic.property.id,
    "Rejecting an identity conflict must preserve the original source observation.");
  await assert.rejects(
    recordPropertyObservation(
      { ...strongSynthetic.property, id: "" } as Parameters<typeof recordPropertyObservation>[0],
      "synthetic-pagination:missing-identifier",
      "synthetic-property-pagination-exercise",
      now,
    ),
    /source record identifier/,
    "A property without a stable source record identifier must not enter discovery.",
  );

  const lineageSourceKey = `synthetic-lineage:${randomUUID()}`;
  const lineageProperty = {
    ...strongSynthetic.property,
    id: `SYNTHETIC-LINEAGE-${randomUUID()}`,
    parcelId: `SYNTHETIC-LINEAGE-PARCEL-${randomUUID()}`,
    sourceUrl: "https://example.invalid/synthetic-lineage-v1",
    contactPaths: [],
  } as PublicProperty;
  const lineageFirst = await recordPropertyObservation(lineageProperty, lineageSourceKey,
    "synthetic-property-lineage-exercise", now);
  const lineageUpdate = await recordPropertyObservation({
    ...lineageProperty,
    sqft: (lineageProperty.sqft ?? 0) + 25,
    sourceUrl: "https://example.invalid/synthetic-lineage-v2",
  }, lineageSourceKey, "synthetic-property-lineage-exercise", new Date(now.getTime() + 60_000));
  const [lineageObservation] = await db.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.sourceKey, lineageSourceKey));
  const lineagePayload = lineageObservation?.payload as Record<string, unknown> | undefined;
  const versions = Array.isArray(lineagePayload?.recordHistory) ? lineagePayload.recordHistory as Array<Record<string, unknown>> : [];
  assert.equal(lineageUpdate.id, lineageFirst.id, "A material update under the same exact parcel remains on its discovery.");
  assert.equal(versions.length, 1, "A material source-record revision retains its earlier normalized version.");
  assert.equal(versions[0]?.sourceUrl, "https://example.invalid/synthetic-lineage-v1");
  assert.equal(versions[0]?.observedAt, now.toISOString());
  assert.equal(lineageUpdate.leadId, null, "A source-record update remains raw discovery, not an active lead.");

  const syntheticAndLivePages = [];
  let page = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA", limit: livePageSize });
  syntheticAndLivePages.push(page);
  while (page.hasMore) {
    assert.ok(page.nextCursor, "A bounded property page must provide a continuation cursor when more rows exist.");
    page = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA", limit: livePageSize, cursor: page.nextCursor! });
    syntheticAndLivePages.push(page);
  }
  const pagedDiscoveries = syntheticAndLivePages.flatMap(result => result.records);
  const pagedIds = pagedDiscoveries.map(result => result.id);
  const persistedDiscoveryCount = Object.values(syntheticAndLivePages[0]!.counts).reduce((sum, value) => sum + value, 0);
  assert.ok(persistedDiscoveryCount > 100, "The persisted exercise set must cross the former 100-record visibility boundary.");
  assert.equal(pagedDiscoveries.length, persistedDiscoveryCount, "The bounded cursor traversal must reach the entire persisted result set.");
  assert.ok(syntheticAndLivePages.length > 4, "The >100-record exercise must require multiple bounded pages.");
  assert.equal(new Set(pagedIds).size, pagedIds.length, "Same-property cross-source observations must not duplicate a property across pages.");
  assert.deepEqual(pagedIds, [...pagedDiscoveries]
    .sort((left, right) => comparePropertyDiscoveriesByRank(
      { id: left.id, score: left.score, updatedAt: left.lastObservedAt },
      { id: right.id, score: right.score, updatedAt: right.lastObservedAt },
    ))
    .map(result => result.id), "Every page must preserve deterministic ranking order.");
  const stableSyntheticFirstPage = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA", limit: livePageSize });
  assert.deepEqual(stableSyntheticFirstPage.records.map(result => result.id), syntheticAndLivePages[0]!.records.map(result => result.id),
    "Repeated reads without a data change must preserve the exact first-page selection.");
  const strongResultAcrossPages = pagedDiscoveries.find(result => result.id === strongSynthetic.id);
  assert.ok(strongResultAcrossPages);
  assert.equal(strongResultAcrossPages.status, "RELEVANT_CANDIDATE");
  assert.equal(strongResultAcrossPages.sourceObservationCount, 2, "Both distinct source observations must remain attached after cross-page deduplication.");
  assert.equal(strongResultAcrossPages.leadId, null);
  assert.ok(pagedDiscoveries.every(result => result.status !== "CALL_READY"),
    "Neither the real feed's raw discoveries nor synthetic records become CALL_READY from listing or ranking.");
  assert.equal((await db.select().from(leadsTable)).length, 0,
    "The multi-page source exercise creates no active lead before a human promotion decision.");
  const topCandidatePage = await listPropertyDiscoveries({
    marketKey: "PHILADELPHIA_PA",
    statuses: ["RELEVANT_CANDIDATE", "QUALIFIED_LEAD"],
    limit: 5,
  });
  assert.ok(topCandidatePage.records.length <= 5);
  assert.ok(topCandidatePage.records.every(result => ["RELEVANT_CANDIDATE", "QUALIFIED_LEAD"].includes(result.status)),
    "The command-center query must filter the candidate queue before its small top-five limit.");
  assert.ok(topCandidatePage.records.some(result => result.id === strongSynthetic.id),
    "A high-value candidate remains visible in the independently filtered command-center queue.");
  const sourceObservationRowsAfterSyntheticFixture =
    (await db.select().from(propertySourceObservationsTable)).length +
    (await db.select().from(unmatchedPropertySourceObservationsTable)).length;
  assert.equal(sourceObservationRowsAfterSyntheticFixture - liveObservationRowsBeforeSynthetic, 112,
    "The isolated fixture adds 110 pagination properties, one retained second-source observation, and one source-lineage revision fixture.");
  const propertyPaginationSummary = {
    liveFirstPageRecords: liveDiscoveryList.records.length,
    livePersistedPropertyRecords: liveDiscoveryRecords.length,
    livePropertyPages: liveDiscoveryPages.length,
    liveUnmatchedObservations: liveApiUnmatched.length,
    liveUnmatchedPages: liveUnmatchedPages.length,
    sourceObservationRowsBeforeSynthetic: liveObservationRowsBeforeSynthetic,
    sourceObservationRowsAfterSyntheticFixture: sourceObservationRowsAfterSyntheticFixture,
    syntheticPropertiesAdded: syntheticPaginationRecords.length,
    totalPersistedRecordsAfterSynthetic: persistedDiscoveryCount,
    boundedPagesAfterSynthetic: syntheticAndLivePages.length,
    statusFilteredCommandCenterResults: topCandidatePage.records.length,
    crossSourceDuplicateObservationsRetained: strongResultAcrossPages.sourceObservationCount,
  };

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
  const contactCaseInput = {
    version: first.version,
    status: "OPEN" as const,
    confidence: 0.6,
    sourceName: "SYNTHETIC contact research case exercise",
    sourceType: "OTHER" as const,
    sourceUrl: null,
    observedAt: now.toISOString(),
    identityMatch: "RECORDED_OWNER_ONLY" as const,
    permissionBasis: "UNKNOWN" as const,
    evidenceReference: null,
    note: "SYNTHETIC: assessed owner mailing record found; no direct route established.",
    candidateRoute: {
      channel: "PHONE" as const,
      routeValue: "(215) 555-0160",
      recipient: "SYNTHETIC recorded owner; not a real person",
      recipientRole: "RECORDED_OWNER" as const,
      sourceId: "synthetic-contact-route",
      sourceName: "SYNTHETIC route fixture; not a real source",
      sourceRecordId: "SYNTHETIC-ROUTE-CASE-1",
      sourceUrl: "https://example.com/synthetic-route-case",
      sourceType: "ANALYST" as const,
      capturedAt: now.toISOString(),
      confidence: 0.6,
      permissionStatus: "NOT_REVIEWED" as const,
      permissionBasis: "UNKNOWN" as const,
      identityEvidenceStatus: "NONE" as const,
      routeVerificationStatus: "UNREVIEWED" as const,
    },
  };
  const contactCase = await savePropertyContactResearchCase(first.id, contactCaseInput, actor, now);
  assert.equal(contactCase.contactResearchCase?.synthetic, true);
  assert.equal(contactCase.contactResearchCase?.status, "OPEN");
  assert.ok(contactCase.contactResearchCase?.missingRequirements.some((x) => x.includes("does not establish seller identity")));
  assert.ok(contactCase.contactResearchCase?.missingRequirements.some((x) => x.includes("confirm the route")));
  assert.equal(contactCase.leadId, null, "A contact research case cannot promote a raw discovery.");
  assert.ok(contactCase.property.contactPaths.every(path => path.channel !== "PHONE" || path.routeVerificationStatus !== "CONFIRMED"),
    "Contact research notes must not create a confirmed route.");
  assert.equal(contactCase.contactResearchCase?.candidateRoutes?.length, 1);
  assert.equal(contactCase.contactResearchCase?.candidateRoutes?.[0]?.freshnessStatus, "CURRENT");
  assert.equal(contactCase.contactResearchCase?.candidateRoutes?.[0]?.routeVerificationStatus, "UNREVIEWED");
  const replayedRoute = await savePropertyContactResearchCase(contactCase.id, {
    ...contactCaseInput, version: contactCase.version,
  }, actor, now);
  assert.equal(replayedRoute.contactResearchCase?.candidateRoutes?.length, 1,
    "Replaying the same route source/record/time must not duplicate the candidate.");
  assert.equal(replayedRoute.contactResearchCase?.auditHistory.length, contactCase.contactResearchCase?.auditHistory.length,
    "Exact candidate-route replay must not duplicate audit events.");
  await assert.rejects(() => savePropertyContactResearchCase(contactCase.id, {
    ...contactCaseInput, version: contactCase.version,
    candidateRoute: {
      ...contactCaseInput.candidateRoute, permissionStatus: "PERMITTED" as const,
      permissionBasis: "CONSENT" as const, permissionScope: "SYNTHETIC only",
      permissionEvidenceUrl: "https://example.com/synthetic-consent",
    },
  }, { ...actor, role: "OPERATOR" }, now), /only an owner/i);
  const staleRouteCase = await savePropertyContactResearchCase(contactCase.id, {
    ...contactCaseInput, version: replayedRoute.version,
    candidateRoute: {
      ...contactCaseInput.candidateRoute, routeValue: "(215) 555-0199",
      sourceRecordId: "SYNTHETIC-STALE-ROUTE",
      capturedAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    },
  }, actor, now);
  assert.equal(staleRouteCase.contactResearchCase?.candidateRoutes?.find(path => path.sourceRecordId === "SYNTHETIC-STALE-ROUTE")?.freshnessStatus, "STALE");
  assert.ok(staleRouteCase.contactResearchCase?.missingRequirements.some(item => /stale/i.test(item)));
  const conflictRouteCase = await savePropertyContactResearchCase(contactCase.id, {
    ...contactCaseInput, version: staleRouteCase.version,
    candidateRoute: {
      ...contactCaseInput.candidateRoute, recipient: "SYNTHETIC conflicting recipient; not a real person",
      recipientRole: "UNKNOWN" as const, sourceRecordId: "SYNTHETIC-CONFLICTING-ROUTE",
    },
  }, actor, now);
  assert.ok(conflictRouteCase.contactResearchCase?.candidateRoutes?.some(path => path.identityConflictStatus === "MULTIPLE_RECIPIENTS"),
    "Conflicting recipient claims must remain visible and disqualify that route.");
  assert.ok(conflictRouteCase.contactResearchCase?.missingRequirements.some(item => /conflict/i.test(item)));
  await assert.rejects(savePropertyContactResearchCase(contactCase.id, contactCaseInput, actor, now), /changed|reload/i);
  await assert.rejects(savePropertyContactResearchCase(contactCase.id, contactCaseInput, { ...actor, role: "VIEWER" }, now), /role|only/i);
  const matchedLeads = await db.select().from(leadsTable).where(sql`${leadsTable.payload}->>'address' = ${property.address}`);
  assert.equal(matchedLeads.length, 0, "Saving the source observation must not create a lead row.");

  const repeated = await recordPublicPropertyDiscovery(property.id, true, actor, now);
  assert.equal(repeated.id, first.id, "Repeated OPA parcel imports must deduplicate by property identity.");
  assert.equal(repeated.sourceObservationCount, first.sourceObservationCount, "The same source connectors update in place rather than duplicating their observations.");
  const [repeatRow] = await db.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.sourceKey, `phila-opa:${property.id}`));
  assert.equal(repeatRow?.seenCount, 1, "Same-capture worker/manual retries are idempotent and do not inflate observation counts.");
  const savedOpaPayload = repeatRow?.payload as { contactPaths?: unknown[] } | undefined;
  assert.ok(Array.isArray(savedOpaPayload?.contactPaths), "The official OPA source observation persists contact-path evidence.");
  for (const path of savedOpaPayload.contactPaths) {
    assert.equal((path as { sourceId?: string }).sourceId, property.provider);
    assert.equal((path as { classification?: string }).classification, "OBSERVED");
    assert.equal((path as { permissionStatus?: string }).permissionStatus, "NOT_REVIEWED");
  }
  assert.ok(first.property.contactPaths.every(path => path.channel === "POSTAL"),
    "The OPA discovery exercise must not reinterpret postal owner-mailing data as phone or email contact.");
  assert.equal(first.property.contactPaths.some(path => path.channel === "PHONE" || path.channel === "EMAIL"), false);
  console.log(`LIVE permitted-source contact evidence: ${liveDiscoveryRecords.length} persisted discoveries; ${liveContactPaths.length} contact routes by channel ${JSON.stringify(liveContactChannelCounts)}; direct phone/email/web routes unavailable.`);
  const secondary = await recordPropertyObservation(
    {
      ...property,
      id: `external-record-${property.id}`,
      provider: "SYNTHETIC_SECONDARY_SOURCE",
      address: `${property.address} (source formatting variation)`,
      sourceUrl: "https://example.com/synthetic-record",
    },
    `synthetic-secondary:${property.id}`, actor.id, now,
  );
  assert.equal(secondary.id, first.id, "A second source with the exact jurisdiction-scoped parcel ID must attach to one discovery despite an address-format variation.");
  assert.equal(secondary.sourceObservationCount, first.sourceObservationCount + 1);
  assert.equal(secondary.leadId, null);
  const sameAddressDifferentParcel = await recordPropertyObservation({
    ...property,
    id: "different-parcel-record",
    parcelId: `SYNTHETIC-PARCEL-${randomUUID()}`,
    provider: "SYNTHETIC_SECONDARY_SOURCE",
    sourceUrl: "https://example.com/synthetic-distinct-parcel",
  }, `synthetic-different-parcel:${property.id}`, actor.id, now);
  assert.notEqual(sameAddressDifferentParcel.id, first.id,
    "Different exact parcel IDs at the same normalized street address remain separate until a source proves parcel identity.");
  assert.equal(sameAddressDifferentParcel.leadId, null);

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
  assert.equal(verifiedDemandBuyer.approvalStatus, "QUALIFICATION_REQUIRED",
    "Synthetic buyer fixtures must remain excluded from qualified live demand even after a complete evidence-shaped verification exercise.");
  assert.ok(verifiedDemandBuyer.qualificationBlockers.some(reason => /synthetic fixture is not a real buyer/i.test(reason)));
  const [demandJob] = await db.select().from(jobsTable)
    .where(eq(jobsTable.idempotencyKey, `buyer-demand:${demandBuyer.id}:${verifiedDemandBuyer.version}`));
  assert.ok(demandJob, "Current buyer evidence must queue a durable demand refresh.");
  const demandJobResult = await runWorkerOnce(now, false, demandJob.id);
  assert.equal(demandJobResult?.state, "SUCCEEDED");
  // Exercise the exact persisted discovery response; the public pool is
  // paginated independently from the command-center candidate queue.
  const demandSubject = await recordPublicPropertyDiscovery(property.id, true, actor, now);
  assert.equal(demandSubject.id, secondary.id);
  assert.equal(demandSubject.status, secondary.status, "Demand matching cannot promote or alter seller qualification.");
  assert.equal(demandSubject.leadId, null);
  assert.equal(demandSubject.demandFit.alignedBuyerCount, 0,
    "A synthetic buyer must not count as eligible demand for a real public-source discovery.");
  assert.equal(demandSubject.demandFit.snapshotFresh, true);
  assert.ok(demandSubject.priorityScore <= demandSubject.score,
    "Synthetic buyers do not increase discovery priority as though current real demand existed.");
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
  await addSignal({
    key: "FORECLOSURE", group: "DISTRESS", classification: "VERIFIED", sourceType: "PUBLIC_RECORD",
    statement: "SYNTHETIC fixture: deliberately verified test evidence; not a real parcel fact.",
    source: "SYNTHETIC isolated qualification fixture", sourceUrl: "https://example.com/synthetic-verified-record",
    evidenceRef: "synthetic:verified-public-record", capturedAt: now.toISOString(), confidence: 0.9,
  });
  assert.equal(discovery.status, "RELEVANT_CANDIDATE");
  assert.equal(discovery.canPromote, true, "Strong synthetic, independently referenced evidence should pass the market gate.");
  assert.ok(discovery.score >= 35);
  assert.ok(discovery.signals.every((signal) => signal.source && signal.capturedAt && signal.classification));
  for (const classification of ["VERIFIED", "OBSERVED", "INDICATED", "AI_HYPOTHESIS"]) {
    assert.ok(discovery.signals.some(signal => signal.classification === classification),
      `The persisted synthetic test must retain ${classification} as a distinct evidence classification.`);
  }

  discovery = await savePropertyContactResearchCase(discovery.id, {
    version: discovery.version,
    status: "EVIDENCE_RECORDED",
    confidence: 0.95,
    sourceName: "SYNTHETIC owner-consent contact case; not a real source",
    sourceType: "OTHER",
    sourceUrl: null,
    observedAt: now.toISOString(),
    identityMatch: "SELLER_SELF_IDENTIFIED",
    permissionBasis: "CONSENT",
    evidenceReference: "SYNTHETIC-CONTACT-CASE-REF",
    note: "SYNTHETIC exercise only; no real seller, property contact, or outreach.",
    candidateRoute: {
      channel: "PHONE",
      routeValue: "(215) 555-0198",
      recipient: "SYNTHETIC exercise seller",
      recipientRole: "SELLER_SELF_IDENTIFIED",
      sourceId: "synthetic-owner-consent",
      sourceName: "SYNTHETIC owner consent fixture; not a real source",
      sourceRecordId: "SYNTHETIC-ROUTE-TRANSFER-001",
      sourceUrl: "https://example.com/synthetic-route-evidence",
      sourceType: "ANALYST",
      capturedAt: now.toISOString(),
      confidence: 0.95,
      permissionStatus: "PERMITTED",
      permissionBasis: "CONSENT",
      permissionScope: "SYNTHETIC exercise only",
      permissionEvidenceUrl: "https://example.com/synthetic-consent",
      identityEvidenceStatus: "SUPPORTING_RECORD",
      identityEvidenceRef: "SYNTHETIC-IDENTITY-001",
      routeVerificationStatus: "CONFIRMED",
      verificationNote: "SYNTHETIC exercise only; no person or number was contacted.",
    },
  }, actor, now);
  const transferCandidate = discovery.contactResearchCase?.candidateRoutes?.find(path => path.sourceRecordId === "SYNTHETIC-ROUTE-TRANSFER-001");
  assert.ok(transferCandidate, "The confirmed route remains in the case alongside prior source evidence.");
  assert.equal(transferCandidate.freshnessStatus, "CURRENT");
  assert.equal(transferCandidate.routeVerificationStatus, "CONFIRMED");
  const coverageAfterSyntheticRoute = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA", limit: 1 });
  assert.ok(coverageAfterSyntheticRoute.contactCoverage.syntheticRouteCandidates > 0,
    "Synthetic contact routes must be counted separately from live coverage.");
  assert.equal(coverageAfterSyntheticRoute.contactCoverage.publicFeedPropertiesWithDirectRoute, 0,
    "A synthetic manually captured route cannot be reported as a public-feed route.");
  assert.ok(discovery.contactResearchCase?.missingRequirements.some(item => /stale/i.test(item)),
    "Stale candidates remain visible as blockers even when a separate current route is recorded.");
  assert.ok(discovery.contactResearchCase?.missingRequirements.some(item => /conflict/i.test(item)),
    "Conflicting candidates remain visible as blockers even when a separate current route is recorded.");

  const promoted = await promotePropertyDiscovery(discovery.id, {
    version: discovery.version,
    reviewReason: "SYNTHETIC exercise only: evidence threshold and independent source groups were deliberately supplied.",
  }, actor, now);
  const promotionReplay = await promotePropertyDiscovery(discovery.id, {
    version: promoted.discovery.version,
    reviewReason: "SYNTHETIC exact retry of the saved promotion.",
  }, actor, now);
  assert.equal(promotionReplay.leadId, promoted.leadId, "A replayed promotion must return the original canonical lead identity.");
  assert.equal(promotionReplay.discovery.version, promoted.discovery.version, "An exact promotion replay must not create another aggregate revision.");
  await assert.rejects(
    () => promotePropertyDiscovery(discovery.id, {
      version: discovery.version,
      reviewReason: "SYNTHETIC stale promotion retry.",
    }, actor, now),
    /changed in another session/i,
    "A promotion replay with a stale discovery revision must fail instead of overwriting current state.",
  );
  const canonicalLeadRows = await db.select().from(leadsTable).where(sql`
    upper(${leadsTable.payload}->>'state') = ${property.state.toUpperCase()}
    AND upper(${leadsTable.payload}->>'city') = ${property.city.toUpperCase()}
    AND left(${leadsTable.payload}->>'zip',5) = ${property.zip.slice(0,5)}
    AND regexp_replace(upper(${leadsTable.payload}->>'address'),'[^A-Z0-9]','','g') =
      regexp_replace(upper(${property.address}),'[^A-Z0-9]','','g')
  `);
  assert.equal(canonicalLeadRows.length, 1, "Promotion and exact replay must retain one canonical lead for the property identity.");
  assert.equal(canonicalLeadRows[0]?.id, promoted.leadId);
  assert.equal(promoted.discovery.status, "QUALIFIED_LEAD");
  assert.equal(promoted.discovery.leadId, promoted.leadId);
  assert.equal(promoted.discovery.canPromote, false);
  assert.ok(promoted.discovery.property.contactPaths.some(path =>
    path.sourceRecordId === "SYNTHETIC-ROUTE-TRANSFER-001" && path.routeVerificationStatus === "CONFIRMED"),
  "Promotion transfers only the independently confirmed synthetic seller route.");
  assert.ok(!promoted.discovery.property.contactPaths.some(path =>
    ["SYNTHETIC-STALE-ROUTE", "SYNTHETIC-CONFLICTING-ROUTE"].includes(path.sourceRecordId)),
  "Stale/conflicting candidate records are not attached as usable lead routes.");
  const sellerNextAction = "Verify seller identity and contact permission, then establish condition and underwriting inputs before any offer.";
  assert.ok(promoted.discovery.nextAction.startsWith(sellerNextAction));
  assert.doesNotMatch(promoted.discovery.nextAction, /Current buyer demand aligns with/i,
    "Synthetic buyer fixtures must not change a real discovery's principal seller next action.");
  assert.ok(promoted.discovery.missingInformation.some((item) => /seller identity/i.test(item)));
  let detail = await leadDetail(promoted.leadId);
  assert.equal(detail.lead.stage, "ENRICHING");
  assert.equal(detail.lead.propertyQualification?.status, "QUALIFIED_LEAD");
  assert.equal(detail.lead.sellerPhone?.trim() ?? "", "",
    "A source-backed discovery with only postal contact data must not acquire a direct seller phone route.");
  await assert.rejects(() => transitionLead(promoted.leadId, {
    version: detail.lead.version, to: "CALL_READY",
    reason: "SYNTHETIC fail-closed check: fixture contact evidence cannot qualify a seller for CALL_READY.",
    nextAction: "Find a permitted direct seller contact route.",
  }, actor.id, now), /Replace synthetic or fixture evidence with real, permitted, source-backed evidence/);
  assert.equal((await leadDetail(promoted.leadId)).lead.stage, "ENRICHING",
    "A failed CALL READY transition must leave the persisted acquisition stage unchanged.");
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
  assert.equal(qualifiedOpportunity?.demandFit.alignedBuyerCount, 0,
    "The command center must not count synthetic buyer fixtures as aligned live demand.");
  assert.equal(detail.lead.askingPrice, null);
  assert.equal(detail.lead.sellerName, "Seller not yet identified");
  assert.equal(detail.analysis, null);
  assert.equal(detail.offers.length, 0);
  const transferredContact = await getSellerContactPaths(promoted.leadId, now);
  assert.equal(transferredContact.directRouteStatus, "PHONE_ROUTE_AVAILABLE",
    "The persisted lead contact reader must see the permitted, verified, current route attached during promotion.");
  assert.equal(transferredContact.selectedPhonePath?.routeValue, "(215) 555-0198");
  assert.equal(transferredContact.selectedPhonePath?.signingAuthorityStatus, "NOT_ESTABLISHED",
    "Contact-route verification must never establish signing authority.");
  assert.equal(detail.lead.askingPrice, null, "Contact research must not create deal economics.");
  assert.equal(detail.analysis, null, "Contact research must not create underwriting or offer authority.");
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

  const unsupportedInput = {
    address: "123 Synthetic Test Street", city: "Test", state: "FL", county: "Test", zip: "33101",
    propertyType: "SINGLE_FAMILY", sqft: 1000, beds: 3, baths: 2, units: 1,
    sellerName: "SYNTHETIC", source: "Isolated unsupported-source fixture; NOT a real seller.",
  } as const;
  const parallelManualCreates = await Promise.allSettled([
    createLead(unsupportedInput, actor.id, now),
    createLead(unsupportedInput, actor.id, now),
  ]);
  const createdManualDeals = parallelManualCreates.filter(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createLead>>> => result.status === "fulfilled",
  );
  const rejectedManualDeals = parallelManualCreates.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  assert.equal(createdManualDeals.length, 1, "Concurrent duplicate manual creates must produce one canonical lead.");
  assert.equal(rejectedManualDeals.length, 1);
  assert.match(String(rejectedManualDeals[0]?.reason), /canonical deal instead of creating a duplicate/i);
  const unsupported = createdManualDeals[0]!.value;
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
  const refreshableObservation = sourceObservations.find(row => row.sourceId === "phila-li-building-permits") ??
    sourceObservations.find(row => !row.sourceKey.startsWith("phila-opa:"));
  assert.ok(refreshableObservation, "A linked non-OPA source observation is required to exercise source-change propagation.");
  await db.update(propertySourceObservationsTable).set({
    payload: {
      ...refreshableObservation.payload,
      evidenceDigest: "synthetic-prior-evidence-digest-only",
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
    sellerPhone: "(215) 555-0198", source: "SYNTHETIC isolated property-source exercise; no real seller contact",
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
  const stageBeforeBlockedCall = detail.lead.stage;
  await assert.rejects(
    () => transitionLead(promoted.leadId, {
      version: detail.lead.version, to: "CALL_READY",
      reason: "Synthetic isolated call-readiness gate.", nextAction: "Synthetic exercise only.",
    }, actor.id, now),
    /CALL_READY is blocked:.*Replace synthetic or fixture evidence with real, permitted, source-backed evidence/,
    "Synthetic route and ownership fixtures must not make a real-source discovery call-ready.",
  );
  detail = await leadDetail(promoted.leadId);
  assert.equal(detail.lead.stage, stageBeforeBlockedCall, "A rejected transition leaves the prior stage unchanged.");
  assert.equal(detail.calls.length, 0, "A blocked synthetic lead cannot create persisted call notes.");
  assert.equal(detail.offers.length, 0, "A blocked synthetic lead cannot create offers.");
  const blockedContractRows = await db.select().from(contractsTable)
    .where(eq(contractsTable.leadId, promoted.leadId));
  assert.equal(blockedContractRows.length, 0, "A blocked synthetic lead cannot create contract records.");
  const blockedRefresh = await refreshPropertySourceEvidence(
    [property.id],
    "system:property-source-exercise",
    new Date(now.getTime() + 7 * 60 * 60 * 1000),
  );
  assert.equal(
    blockedRefresh.checked,
    registeredConnectors.filter(connector => connector.refreshEvidence)
      .reduce((total, connector) => total + connector.sources.length, 0),
  );
  assert.ok(blockedRefresh.changed > 0, "The source refresh must detect evidence changes even when call readiness is blocked.");
  detail = await leadDetail(promoted.leadId);
  assert.equal(detail.analysis, null, "Changed source evidence invalidates pre-execution underwriting.");
  assert.equal(detail.analysisSnapshotId, null);
  assert.equal(detail.lead.stage, "ENRICHING", "Changed source evidence returns a pre-execution lead to evidence review.");
  assert.equal(detail.offers.length, 0);
  logger.info("SYNTHETIC source-refresh fixture remained blocked from CALL_READY; no call, offer, or contract was created.");
  if (false && property && refreshableObservation) {
    // Retained historical invalidation fixture is disabled: it fabricated a
    // call and communicated offer from synthetic contact evidence, which the
    // production authorization gate now correctly rejects.
  detail = await recordCall(promoted.leadId, {
    version: detail.lead.version, outcome: "CONNECTED",
    notes: "Synthetic exercise only; no external call occurred.",
    nextAction: "Prepare synthetic exact terms.", followUpAt: future(24),
  }, actor.id, now);
  const commandDesk = await commandCenter("OPERATOR", now);
  const persistedCallAction = commandDesk.actions.find(action => action.leadId === promoted.leadId);
  assert.equal(persistedCallAction?.href, `/leads/${promoted.leadId}`,
    "After a recorded call, the recommended follow-up action must reopen the persisted lead workspace.");
  detail = await offers.createOfferDraft(promoted.leadId, {
    version: detail.lead.version, amount: 50000, earnestMoney: 500, closingDays: 30,
    contingencies: "Synthetic exercise only.", assignmentIntent: true,
    reason: "Synthetic source-refresh invalidation test.",
  }, actor, now);
  const sourceTestOfferId = detail.offers[0]!.id;
  detail = await authorizeReviewedOffer(promoted.leadId, sourceTestOfferId, {
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

  const staleRefresh = await refreshPropertySourceEvidence([property!.id], "system:property-source-exercise", new Date(now.getTime() + 7 * 60 * 60 * 1000));
  assert.equal(
    staleRefresh.checked,
    registeredConnectors.filter(connector => connector.refreshEvidence)
      .reduce((total, connector) => total + connector.sources.length, 0),
    "The stale refresh rechecks every registered exact-parcel source descriptor, including sources sharing an adapter.",
  );
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
    .where(eq(analysesTable.id, sourceTestSnapshot!));
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
      ...refreshableObservation!.payload,
      signalId: `synthetic-executed-prior-signal:${randomUUID()}`,
      evidenceRef: "https://example.com/synthetic-executed-prior-evidence",
    },
  }).where(eq(propertySourceObservationsTable.id, refreshableObservation!.id));
  const executedRefreshAt = new Date(now.getTime() + 8 * 3_600_000);
  const executedRefresh = await refreshPropertySourceEvidence([property!.id], "system:property-source-exercise", executedRefreshAt);
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

  }

  logger.info({
    records: search.records.length,
    savedDiscoveryId: first.id,
    repeatedSourceObservationCount: repeated.sourceObservationCount,
    crossSourceObservationCount: secondary.sourceObservationCount,
    propertyPagination: propertyPaginationSummary,
    liveSourceCounts,
    livePermitSource: permitFeed,
    liveDemolitionSource: demolitionFeed,
    liveSheriffDeedSource: sheriffDeedFeed,
    sheriffDeedTraversal,
    qualifiedLeadId: promoted.leadId,
    buyerResearchCandidates: buyerResearch.records.length,
    staleRefresh: blockedRefresh.checked,
    listingDescriptionCapability: {
      state: listingDescriptionConnectors.length === 0 ? "UNAVAILABLE" :
        persistedListingObservations > 0 ? "AVAILABLE_AND_EXERCISED" : "CONFIGURED_BUT_UNEXERCISED",
      registeredConnectors: listingDescriptionConnectors.map(connector => connector.id),
      persistedListingObservations,
      reason: listingDescriptionConnectors.length === 0
        ? "No registered connector has a terms-reviewed LISTING_DESCRIPTION capability; Zillow/Redfin remarks were not collected."
        : "Only registered connectors may supply remarks; adapter result counts are taken from persisted source observations.",
    },
    checks: "real OPA, L&I enforcement/vacancy, residential permits, demolition, and sheriff-deed source observation persistence; no lead on raw discovery; exact same-source and cross-source dedupe; raw public event records retained OBSERVED without motivation points; AI hypothesis exclusion; synthetic provenance-backed qualification; human promotion; source research/comps; pass retention; synthetic contact blocked from CALL_READY; source evidence change invalidates pre-execution underwriting",
  }, "Selective property qualification exercise PASSED (isolated schema; actual public records including permits, demolitions, and sheriff deeds; synthetic qualification evidence only)");
} finally {
  await pool.end();
}
