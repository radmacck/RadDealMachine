import { discoverPhiladelphiaViolationParcels, propertiesByIds, searchProperties } from "@workspace/property-sources";
import {
  listPropertyDiscoveries, linkUnmatchedPropertySourceObservations,
  persistUnmatchedPropertySourceObservations, recordPropertyObservation, refreshPropertySourceEvidence,
  refreshPropertyBuyerDemandAlignment, stalePropertySourceRefreshTargets,
} from "./property-discovery-store";

/**
 * Imports a bounded batch of official Philadelphia OPA records as source
 * observations. Qualification remains evidence/criteria driven, and this
 * worker never creates acquisition leads.
 */
export async function discoverPublicProperties(now = new Date()) {
  const baseRecords = await searchProperties(undefined, "properties", now);
  const distressObservations = await discoverPhiladelphiaViolationParcels(now, 20);
  const distressRecords = await propertiesByIds(distressObservations.map(observation => observation.propertyId), now);
  const recordsById = new Map([...baseRecords, ...distressRecords].map(property => [property.id, property]));
  const records = [...recordsById.values()].slice(0, 40);

  const discoveryIds = new Map<string, string>();
  for (const property of records) {
    const saved = await recordPropertyObservation(
      property,
      `${property.provider}:${property.id}`,
      "system:property-discovery",
      now,
    );
    discoveryIds.set(property.id, saved.id);
  }

  const matchedIds = new Set(distressRecords.map(property => property.id));
  const unmatchedRetention = await persistUnmatchedPropertySourceObservations(
    distressObservations.filter(observation => !matchedIds.has(observation.propertyId)),
    "system:property-discovery",
    now,
  );
  const linkedPreviouslyUnmatched = await linkUnmatchedPropertySourceObservations(
    discoveryIds,
    "system:property-discovery",
    now,
  );
  const supplemental = await refreshPropertySourceEvidence(records.map(record => record.id), "system:property-discovery", now);
  const staleTargets = await stalePropertySourceRefreshTargets(now);
  const staleRefresh = staleTargets.length
    ? await refreshPropertySourceEvidence(staleTargets, "system:property-discovery", now)
    : { checked: 0, changed: 0, signals: 0 };
  const qualification = await listPropertyDiscoveries({ marketKey: "PHILADELPHIA_PA", limit: 100 });
  const demand = await refreshPropertyBuyerDemandAlignment(now);
  const matchedDistressParcels = distressRecords.length;
  return `Processed ${baseRecords.length} bounded OPA discoveries plus ${matchedDistressParcels} exact-matched parcels independently discovered from recent unresolved L&I records. Retained ${unmatchedRetention.checked} unmatched L&I source observations (no residential OPA record) and linked ${linkedPreviouslyUnmatched.linked} previously unmatched records after exact OPA resolution. Qualification after source refresh: ${qualification.counts.RELEVANT_CANDIDATE} candidates, ${qualification.counts.QUALIFIED_LEAD} qualified, ${qualification.counts.CALL_READY} call ready; these counts do not represent raw discovery volume. Refreshed ${supplemental.checked} exact-parcel L&I/unsafe-building/vacancy observations and rechecked ${staleTargets.length} previously qualified/candidate parcels (${staleRefresh.checked} observations); ${supplemental.signals + staleRefresh.signals} current indicators are present and ${supplemental.changed + staleRefresh.changed} source signals changed. ${demand.message} Raw discoveries remain separate from the active acquisition queue; no active lead was created from a source record.`;
}
