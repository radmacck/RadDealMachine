import { searchProperties } from "@workspace/property-sources";
import { recordPropertyObservation } from "./property-discovery-store";

/**
 * Imports a bounded batch of official Philadelphia OPA records as source
 * observations. Qualification remains evidence/criteria driven, and this
 * worker never creates acquisition leads.
 */
export async function discoverPublicProperties(now = new Date()) {
  const records = await searchProperties(undefined, "properties", now);
  let candidates = 0;
  let qualified = 0;
  let callReady = 0;

  for (const property of records) {
    const observation = await recordPropertyObservation(
      property,
      `${property.provider}:${property.id}`,
      "system:property-discovery",
      now,
    );
    if (observation.status === "RELEVANT_CANDIDATE") candidates++;
    if (observation.status === "QUALIFIED_LEAD") qualified++;
    if (observation.status === "CALL_READY") callReady++;
  }

  return `Processed ${records.length} bounded Philadelphia OPA property records; ${candidates} remain relevant candidates, ${qualified} qualified, ${callReady} call ready. Raw discoveries were deduplicated and persisted as source observations; no active leads were created.`;
}
