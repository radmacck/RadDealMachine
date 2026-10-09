import {
  listPropertyDiscoveries, linkUnmatchedPropertySourceObservations,
  persistUnmatchedPropertySourceObservations, recordPropertyObservation, refreshPropertySourceEvidence,
  refreshPropertySourceEvidenceFromConnectors,
  refreshPropertyBuyerDemandAlignment, stalePropertySourceRefreshTargets,
} from "./property-discovery-store";
import { discoverPropertiesFromRegisteredSources } from "./property-source-connectors";

/**
 * Imports each registered connector's bounded source batch as observations.
 * Source-specific limits live in the adapters; the connector count is not
 * capped here. Qualification remains evidence-driven and this worker never
 * creates acquisition leads.
 */
export async function discoverPublicProperties(now = new Date()) {
  const { batches: connectorBatches, failures: discoveryFailures } = await discoverPropertiesFromRegisteredSources(now);
  if (!connectorBatches.length) {
    throw new Error(`No property discovery connector succeeded. ${discoveryFailures.map(failure =>
      `${failure.connectorId}: ${failure.message}`).join("; ") || "No discovery connector is registered."}`);
  }
  const baseRecords = connectorBatches.find(batch => batch.connectorId === "phila-opa")?.properties ?? [];
  const distressRecords = connectorBatches.find(batch => batch.connectorId === "phila-li-enforcement")?.properties ?? [];
  const unmatchedObservations = connectorBatches.flatMap(batch => batch.unmatchedObservations);
  const sourceRecords = connectorBatches.flatMap(batch => batch.properties);
  // Preserve one observation per distinct source record, while allowing the
  // property store to merge exact parcel identities into one discovery.
  const observationsBySourceKey = new Map(
    sourceRecords.map(property => [`${property.provider}:${property.id}`, property]),
  );
  const recordsById = new Map([...observationsBySourceKey.values()].map(property => [property.id, property]));
  const records = [...recordsById.values()];

  const discoveryIds = new Map<string, string>();
  for (const property of observationsBySourceKey.values()) {
    const saved = await recordPropertyObservation(
      property,
      `${property.provider}:${property.id}`,
      "system:property-discovery",
      now,
    );
    discoveryIds.set(property.id, saved.id);
  }

  const matchedIds = new Set(sourceRecords.map(property => property.id));
  const unmatchedRetention = await persistUnmatchedPropertySourceObservations(
    unmatchedObservations.filter(observation => !matchedIds.has(observation.propertyId)),
    "system:property-discovery",
    now,
  );
  const linkedPreviouslyUnmatched = await linkUnmatchedPropertySourceObservations(
    discoveryIds,
    "system:property-discovery",
    now,
  );
  const sheriffBatch = connectorBatches.find(batch => batch.connectorId === "phila-sheriff-deed-records");
  const sheriffIds = new Set((sheriffBatch?.properties ?? []).map(property => property.id));
  const regularRefreshIds = [...new Set(connectorBatches
    .filter(batch => batch.connectorId !== "phila-sheriff-deed-records")
    .flatMap(batch => batch.properties.map(property => property.id)))];
  const regularSupplemental = await refreshPropertySourceEvidence(
    regularRefreshIds, "system:property-discovery", now,
  );
  const sheriffOnlyIds = [...sheriffIds].filter(id => !regularRefreshIds.includes(id));
  const sheriffSupplemental = sheriffOnlyIds.length
    ? await refreshPropertySourceEvidenceFromConnectors(
      sheriffOnlyIds, "system:property-discovery", now, ["phila-sheriff-deed-records"],
    )
    : { checked: 0, changed: 0, signals: 0, failures: [] as typeof regularSupplemental.failures };
  const supplemental = {
    checked: regularSupplemental.checked + sheriffSupplemental.checked,
    changed: regularSupplemental.changed + sheriffSupplemental.changed,
    signals: regularSupplemental.signals + sheriffSupplemental.signals,
    failures: [...regularSupplemental.failures, ...sheriffSupplemental.failures],
  };
  const staleTargets = await stalePropertySourceRefreshTargets(now);
  const staleRefresh: typeof supplemental = staleTargets.length
    ? await refreshPropertySourceEvidence(staleTargets, "system:property-discovery", now)
    : { checked: 0, changed: 0, signals: 0, failures: [] };
  const qualification = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA", limit: 1 });
  const demand = await refreshPropertyBuyerDemandAlignment(now);
  const matchedDistressParcels = distressRecords.length;
  const sheriffDeedParcels = connectorBatches.find(batch =>
    batch.connectorId === "phila-sheriff-deed-records")?.properties.length ?? 0;
  const connectorSummary = connectorBatches
    .map(batch => {
      const traversal = batch.sourceStats
        ? `, traversed ${batch.sourceStats.pagesFetched} page(s) / ${batch.sourceStats.sourceRecordCount} source record(s), complete=${batch.sourceStats.traversalComplete}`
        : "";
      return `${batch.connectorId}: ${batch.properties.length} property record(s), ${batch.unmatchedObservations.length} unmatched observation(s)${traversal}`;
    })
    .join("; ");
  const unmatchedSourceCount = new Set(unmatchedObservations
    .filter(observation => !matchedIds.has(observation.propertyId))
    .map(observation => observation.sourceId)).size;
  const connectorFailures = [...discoveryFailures, ...supplemental.failures, ...staleRefresh.failures];
  const failureNote = connectorFailures.length
    ? ` Source-specific partial failures (${connectorFailures.length}): ${connectorFailures.map(failure => `${failure.connectorId}/${failure.operation}: ${failure.message}`).join(" | ")}.`
    : " All registered source operations completed.";
  return `Registered discovery connector results: ${connectorSummary}. Processed ${baseRecords.length} bounded OPA discoveries, ${matchedDistressParcels} exact-matched parcels independently discovered from recent unresolved L&I records, and ${sheriffDeedParcels} exact-matched parcels present in the recent sheriff-deed transfer feed. Sheriff-deed activity is retained as OBSERVED transaction history only; it does not assert current availability or seller motivation. Retained ${unmatchedRetention.checked} unmatched public-source observations across ${unmatchedSourceCount} source types (no exact residential OPA match) and linked ${linkedPreviouslyUnmatched.linked} previously unmatched records after exact OPA resolution. Qualification after source refresh: ${qualification.counts.RELEVANT_CANDIDATE} candidates, ${qualification.counts.QUALIFIED_LEAD} qualified, ${qualification.counts.CALL_READY} call ready; these counts do not represent raw discovery volume. Refreshed ${supplemental.checked} exact-parcel public-record observations and rechecked ${staleTargets.length} previously qualified/candidate parcels (${staleRefresh.checked} observations); ${supplemental.signals + staleRefresh.signals} current indicators are present and ${supplemental.changed + staleRefresh.changed} source evidence snapshots changed. ${demand.message} Raw discoveries remain separate from the active acquisition queue; no active lead was created from a source record.${failureNote}`;
}
