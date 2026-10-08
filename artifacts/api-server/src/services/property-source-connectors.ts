import { ConnectorRegistry } from "@workspace/property-sources";
import {
  PHILA_DEMOLITIONS_SOURCE,
  PHILA_LI_PERMITS_SOURCE,
  PHILA_LI_VIOLATIONS_SOURCE,
  PHILA_PUBLIC_RECORD_SOURCES,
  PHILA_SOURCE,
  PHILA_TRANSFER_SOURCE,
  PHILA_UNSAFE_BUILDINGS_SOURCE,
  PHILA_VACANCY_SOURCE,
  discoverPhiladelphiaDemolitionParcels,
  discoverPhiladelphiaPermitParcels,
  discoverPhiladelphiaViolationParcels,
  nearbySales,
  propertiesByIds,
  propertyByAddress,
  propertyById,
  refreshPhiladelphiaDemolitionEvidence,
  refreshPhiladelphiaEnforcementEvidence,
  refreshPhiladelphiaPermitEvidence,
  refreshPhiladelphiaVacancyEvidence,
  searchProperties,
  searchRepeatedRecordedBuyers,
  type PropertySourceRefresh,
  type PublicProperty,
  type RepeatedTransferBuyer,
} from "@workspace/property-sources";

export type PropertySourceDescriptor = {
  id: string;
  name: string;
  coverage: string;
  termsUrl: string;
  capabilities: string[];
  limitations: string[];
};

export type PropertyDiscoveryBatch = {
  properties: PublicProperty[];
  unmatchedObservations: PropertySourceRefresh[];
};

export type SourceConnectorFailure = {
  connectorId: string;
  sourceIds: string[];
  operation: "DISCOVER" | "REFRESH";
  message: string;
};

export type PropertySourceConnector = {
  id: string;
  observationKeyPrefix?: string;
  maxRefreshBatchSize?: number;
  sources: PropertySourceDescriptor[];
  searchProperties?: (zip: string | undefined, lane: string, now: Date) => Promise<PublicProperty[]>;
  propertyById?: (id: string, now: Date) => Promise<PublicProperty>;
  propertyByAddress?: (address: string, now: Date) => Promise<PublicProperty>;
  propertiesByIds?: (ids: string[], now: Date) => Promise<PublicProperty[]>;
  nearbySales?: (
    subject: PublicProperty,
    options: { radius: number; ageDays: number; sizeTolerance: number },
    now: Date,
  ) => Promise<Awaited<ReturnType<typeof nearbySales>>>;
  discoverProperties?: (now: Date) => Promise<PropertyDiscoveryBatch>;
  refreshEvidence?: (ids: string[], now: Date) => Promise<PropertySourceRefresh[]>;
  discoverBuyerActivity?: (now: Date) => Promise<RepeatedTransferBuyer[]>;
};

export const propertySourceConnectors = new ConnectorRegistry<PropertySourceConnector>();

export function registerPropertySourceConnector(connector: PropertySourceConnector) {
  if (connector.maxRefreshBatchSize !== undefined &&
    (!Number.isInteger(connector.maxRefreshBatchSize) || connector.maxRefreshBatchSize < 1)) {
    throw new Error(`Connector "${connector.id}" has an invalid source-specific refresh batch size.`);
  }
  if (!connector.sources.length) throw new Error(`Connector "${connector.id}" must expose at least one live source descriptor.`);
  if (![connector.searchProperties, connector.propertyById, connector.propertyByAddress, connector.propertiesByIds,
    connector.nearbySales, connector.discoverProperties, connector.refreshEvidence, connector.discoverBuyerActivity]
    .some((operation) => typeof operation === "function")) {
    throw new Error(`Connector "${connector.id}" must implement at least one live source operation; metadata-only connectors are not supported.`);
  }
  const sourceIds = new Set<string>();
  for (const source of connector.sources) {
    if (!source.id.trim() || !source.name.trim() || !source.coverage.trim() ||
      !/^https:\/\//.test(source.termsUrl) || !source.capabilities.length || !source.limitations.length) {
      throw new Error(`Connector "${connector.id}" has incomplete source access or provenance metadata.`);
    }
    if (sourceIds.has(source.id) || allPropertySourceConnectors().some(existing =>
      existing.sources.some(existingSource => existingSource.id === source.id))) {
      throw new Error(`Source id "${source.id}" is already registered.`);
    }
    sourceIds.add(source.id);
  }
  propertySourceConnectors.register(connector);
}

registerPropertySourceConnector({
  id: PHILA_SOURCE.id,
  sources: [PHILA_SOURCE],
  searchProperties,
  propertyById,
  propertyByAddress,
  propertiesByIds,
  nearbySales,
  discoverProperties: async (now) => ({
    properties: await searchProperties(undefined, "properties", now),
    unmatchedObservations: [],
  }),
});

registerPropertySourceConnector({
  id: "phila-li-enforcement",
  maxRefreshBatchSize: 40,
  sources: [PHILA_LI_VIOLATIONS_SOURCE, PHILA_UNSAFE_BUILDINGS_SOURCE],
  discoverProperties: async (now) => {
    const unmatchedObservations = await discoverPhiladelphiaViolationParcels(now, 20);
    const propertyIds = [...new Set(unmatchedObservations.map((observation) => observation.propertyId))];
    const properties = await propertiesByIds(propertyIds, now);
    const resolved = new Set(properties.map((property) => property.id));
    return {
      properties,
      unmatchedObservations: unmatchedObservations.filter((observation) => !resolved.has(observation.propertyId)),
    };
  },
  refreshEvidence: refreshPhiladelphiaEnforcementEvidence,
});

registerPropertySourceConnector({
  id: PHILA_VACANCY_SOURCE.id,
  maxRefreshBatchSize: 40,
  sources: [PHILA_VACANCY_SOURCE],
  refreshEvidence: refreshPhiladelphiaVacancyEvidence,
});

registerPropertySourceConnector({
  id: PHILA_LI_PERMITS_SOURCE.id,
  maxRefreshBatchSize: 40,
  sources: [PHILA_LI_PERMITS_SOURCE],
  discoverProperties: async (now) => {
    const observations = await discoverPhiladelphiaPermitParcels(now);
    const propertyIds = [...new Set(observations.map(observation => observation.propertyId))];
    const properties = propertyIds.length ? await propertiesByIds(propertyIds, now) : [];
    const resolved = new Set(properties.map(property => property.id));
    return {
      properties,
      unmatchedObservations: observations.filter(observation => !resolved.has(observation.propertyId)),
    };
  },
  refreshEvidence: refreshPhiladelphiaPermitEvidence,
});

registerPropertySourceConnector({
  id: PHILA_DEMOLITIONS_SOURCE.id,
  maxRefreshBatchSize: 40,
  sources: [PHILA_DEMOLITIONS_SOURCE],
  discoverProperties: async (now) => {
    const observations = await discoverPhiladelphiaDemolitionParcels(now);
    const propertyIds = [...new Set(observations.map(observation => observation.propertyId))];
    const properties = propertyIds.length ? await propertiesByIds(propertyIds, now) : [];
    const resolved = new Set(properties.map(property => property.id));
    return {
      properties,
      unmatchedObservations: observations.filter(observation => !resolved.has(observation.propertyId)),
    };
  },
  refreshEvidence: refreshPhiladelphiaDemolitionEvidence,
});

registerPropertySourceConnector({
  id: PHILA_TRANSFER_SOURCE.id,
  observationKeyPrefix: "phila-transfer-grantee",
  sources: [PHILA_TRANSFER_SOURCE],
  discoverBuyerActivity: searchRepeatedRecordedBuyers,
});

export function allPropertySourceConnectors() {
  return propertySourceConnectors.all();
}

export function getPropertySourceConnector(id: string) {
  return propertySourceConnectors.get(id);
}

export function listPropertySourceDescriptors(): PropertySourceDescriptor[] {
  const unique = new Map<string, PropertySourceDescriptor>();
  for (const connector of allPropertySourceConnectors()) {
    for (const source of connector.sources) unique.set(source.id, source);
  }
  // Preserve descriptors for evidence subtypes emitted by the shared L&I feed.
  for (const source of PHILA_PUBLIC_RECORD_SOURCES) unique.set(source.id, source);
  return [...unique.values()];
}

export async function runPropertyDiscoveryConnectors(
  connectors: readonly PropertySourceConnector[],
  now: Date,
) {
  const batches: Array<PropertyDiscoveryBatch & { connectorId: string }> = [];
  const failures: SourceConnectorFailure[] = [];
  for (const connector of connectors) {
    if (!connector.discoverProperties) continue;
    try {
      batches.push({ connectorId: connector.id, ...await connector.discoverProperties(now) });
    } catch (error) {
      failures.push({
        connectorId: connector.id,
        sourceIds: connector.sources.map(source => source.id),
        operation: "DISCOVER",
        message: (error instanceof Error ? error.message : "Unknown source error").slice(0, 300),
      });
    }
  }
  return { batches, failures };
}

export async function discoverPropertiesFromRegisteredSources(now: Date) {
  return runPropertyDiscoveryConnectors(allPropertySourceConnectors(), now);
}

export async function runPropertyEvidenceRefresh(
  connectors: readonly PropertySourceConnector[],
  ids: string[],
  now: Date,
) {
  const observations: PropertySourceRefresh[] = [];
  const failures: SourceConnectorFailure[] = [];
  for (const connector of connectors) {
    if (!connector.refreshEvidence) continue;
    const batchSize = connector.maxRefreshBatchSize ?? Math.max(ids.length, 1);
    for (let offset = 0; offset < ids.length; offset += batchSize) {
      const batch = ids.slice(offset, offset + batchSize);
      try {
        observations.push(...await connector.refreshEvidence(batch, now));
      } catch (error) {
        failures.push({
          connectorId: connector.id,
          sourceIds: connector.sources.map(source => source.id),
          operation: "REFRESH",
          message: (error instanceof Error ? error.message : "Unknown source error").slice(0, 300),
        });
      }
    }
  }
  return { observations, failures };
}

export async function refreshEvidenceFromRegisteredSources(ids: string[], now: Date) {
  return runPropertyEvidenceRefresh(allPropertySourceConnectors(), ids, now);
}
