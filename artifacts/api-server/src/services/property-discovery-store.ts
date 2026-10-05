import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, propertyDiscoveriesTable, propertySourceObservationsTable, propertyQualificationCriteriaTable,
  leadsTable, intelligenceTable,
} from "@workspace/db";
import {
  AddPropertyRelevanceSignalBody, AddPropertyRelevanceSignalResponse,
  DisqualifyPropertyDiscoveryBody, DisqualifyPropertyDiscoveryResponse,
  GetPropertyDiscoveryCriteriaResponse, ListPropertyDiscoveriesResponse,
  PromotePropertyDiscoveryBody, PromotePropertyDiscoveryResponse,
  RecordPublicPropertyDiscoveryResponse, SavePropertyDiscoveryCriteriaBody,
  SavePropertyDiscoveryCriteriaResponse,
} from "@workspace/api-zod";
import {
  DEFAULT_PROPERTY_QUALIFICATION_CRITERIA, DomainError, PROPERTY_SIGNAL_GROUP_BY_KEY,
  evaluatePropertyRelevance, validateProvenance,
  type EvidenceClassification, type IntelligenceInput, type PropertyQualificationCriteria, type PropertyRelevanceSignal,
  type PropertySignalGroup, type PropertyDiscoveryStatus, type OfferActor,
} from "@workspace/deal-domain";
import { propertyById } from "@workspace/property-sources";
import { audit, createLead, move } from "./deal-store";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = typeof db | Tx;
type PropertyRecord = Awaited<ReturnType<typeof propertyById>>;
type DiscoveryPayload = {
  property: PropertyRecord;
  opaProperty?: PropertyRecord;
  signals: PropertyRelevanceSignal[];
  firstObservedAt: string;
  promotion?: { actor: string; at: string; reviewReason: string };
  disposition?: { actor: string; at: string; reason: string };
};

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const normalAddress = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizedOwner = (value: string | null) => value?.trim().replace(/\s+/g, " ").toUpperCase() ?? "";
const jsonRecord = (value: object): Record<string, unknown> => ({ ...value });
const iso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString();

function marketKeyFor(property: PropertyRecord) {
  return `${property.city.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${property.state.trim().toUpperCase()}`;
}

function propertyIdentity(property: PropertyRecord) {
  const postal = property.zip.trim().slice(0, 5);
  return sha(`${property.state.toUpperCase()}|${property.city.toUpperCase()}|${postal}|${normalAddress(property.address)}`);
}

function ownerIdentity(property: PropertyRecord) {
  const owner = normalizedOwner(property.recordedOwner);
  return owner ? sha(owner) : null;
}

function requireReviewer(actor: OfferActor) {
  if (!["OWNER", "OPERATOR", "ANALYST"].includes(actor.role)) {
    throw new DomainError("Only an owner, operator, or analyst can review property discovery.", 403);
  }
}

function requireSourceTerms(actor: OfferActor, termsReviewed: boolean) {
  requireReviewer(actor);
  if (!termsReviewed) throw new DomainError("Confirm the source's permitted use before saving a property observation.", 403);
}

function generatedOpaSignals(
  property: PropertyRecord,
  criteria: PropertyQualificationCriteria,
  capturedAt: string,
): PropertyRelevanceSignal[] {
  const base = {
    sourceType: "PUBLIC_RECORD" as const,
    source: property.provider,
    sourceUrl: property.sourceUrl,
    capturedAt,
    evidenceRef: `phila-opa:${property.id}`,
  };
  const signals: PropertyRelevanceSignal[] = [];
  if (property.entityCandidate) {
    signals.push({
      ...base,
      id: `phila-opa:${property.id}:ENTITY_OWNER`,
      key: "ENTITY_OWNER",
      group: "OWNERSHIP_CONTEXT",
      classification: "INDICATED",
      confidence: 0.55,
      statement: "Recorded owner name has an entity-style suffix; this is an ownership-context clue, not verified seller identity or authority.",
    });
  }
  if (property.lastSaleAt) {
    const yearsHeld = (Date.parse(capturedAt) - Date.parse(property.lastSaleAt)) / (365.2425 * 24 * 60 * 60 * 1000);
    if (yearsHeld >= criteria.longHoldYears) {
      signals.push({
        ...base,
        id: `phila-opa:${property.id}:LONG_TERM_HOLD`,
        key: "LONG_TERM_HOLD",
        group: "OWNERSHIP_CONTEXT",
        classification: "INDICATED",
        confidence: 0.65,
        statement: `OPA reports a last sale on ${property.lastSaleAt}; the elapsed period is at least ${criteria.longHoldYears} years. This does not establish motivation or equity.`,
      });
    }
  }
  const rawCondition = [property.interiorCondition, property.exteriorCondition].filter(Boolean).join("; ");
  if (rawCondition && /\b(poor|below average|unsound|deteriorated)\b/i.test(rawCondition)) {
    signals.push({
      ...base,
      id: `phila-opa:${property.id}:REPORTED_POOR_CONDITION`,
      key: "REPORTED_POOR_CONDITION",
      group: "CONDITION",
      classification: "INDICATED",
      confidence: 0.4,
      statement: `OPA carries the raw condition code "${rawCondition}". It is an assessment-record clue, not a current inspection or repair estimate.`,
    });
  }
  return signals;
}

function parsePayload(value: Record<string, unknown>): DiscoveryPayload {
  const property = value.property as PropertyRecord;
  const signals = Array.isArray(value.signals) ? value.signals as PropertyRelevanceSignal[] : [];
  return {
    property,
    ...(value.opaProperty ? { opaProperty: value.opaProperty as PropertyRecord } : {}),
    signals,
    firstObservedAt: typeof value.firstObservedAt === "string" ? value.firstObservedAt : new Date().toISOString(),
    ...(value.promotion ? { promotion: value.promotion as DiscoveryPayload["promotion"] } : {}),
    ...(value.disposition ? { disposition: value.disposition as DiscoveryPayload["disposition"] } : {}),
  };
}

async function getCriteriaFrom(database: Database, marketKey: string) {
  const [row] = await database.select().from(propertyQualificationCriteriaTable)
    .where(eq(propertyQualificationCriteriaTable.marketKey, marketKey));
  const criteria = row
    ? { ...(row.criteria as Record<string, unknown>), marketKey, version: row.version }
    : { ...DEFAULT_PROPERTY_QUALIFICATION_CRITERIA, marketKey, version: 1 };
  return GetPropertyDiscoveryCriteriaResponse.parse(criteria) as PropertyQualificationCriteria;
}

export async function getPropertyDiscoveryCriteria(marketKey: string) {
  return GetPropertyDiscoveryCriteriaResponse.parse(await getCriteriaFrom(db, marketKey));
}

function factCompletenessBlockers(property: PropertyRecord) {
  const blockers = [];
  if (property.sqft == null) blockers.push("Living area is not present in this public record; verify it before lead creation.");
  if (property.beds == null) blockers.push("Bedroom count is not present in this public record; verify it before lead creation.");
  if (property.baths == null) blockers.push("Bathroom count is not present in this public record; verify it before lead creation.");
  return blockers;
}

async function toDiscoveryResponse(
  row: typeof propertyDiscoveriesTable.$inferSelect,
  criteria: PropertyQualificationCriteria,
  sourceObservationCount: number,
  relatedOwnerPropertyCount: number,
  database: Database = db,
) {
  const payload = parsePayload(row.payload);
  const evaluation = evaluatePropertyRelevance(payload.signals, criteria);
  const factBlockers = factCompletenessBlockers(payload.property);
  const status = row.status as PropertyDiscoveryStatus;
  const promotionBlockers = status === "QUALIFIED_LEAD" || status === "CALL_READY" || status === "DISQUALIFIED"
    ? []
    : [...evaluation.promotionBlockers, ...factBlockers];
  const canPromote = status === "RELEVANT_CANDIDATE" && evaluation.canPromote && factBlockers.length === 0 && !row.leadId;
  let reason = evaluation.reason;
  if (payload.disposition) reason = `Passed by ${payload.disposition.actor}: ${payload.disposition.reason}`;
  else if (payload.promotion) reason = `Human-reviewed lead promotion: ${payload.promotion.reviewReason}. ${evaluation.reason}`;
  const missingInformation = [
    ...evaluation.missingInformation,
    ...(payload.property.sqft == null ? ["Living area is missing from the source record."] : []),
    ...(payload.property.beds == null ? ["Bedroom count is missing from the source record."] : []),
    ...(payload.property.baths == null ? ["Bathroom count is missing from the source record."] : []),
  ];
  const [linkedLead] = row.leadId
    ? await database.select({ nextAction: leadsTable.nextAction }).from(leadsTable).where(eq(leadsTable.id, row.leadId))
    : [];
  return RecordPublicPropertyDiscoveryResponse.parse({
    id: row.id,
    marketKey: row.marketKey,
    status,
    score: row.score,
    confidence: row.confidence,
    version: row.version,
    property: payload.property,
    signals: evaluation.scoredSignals.map(({ points, ...signal }) => ({ ...signal, scoreContribution: points })),
    reason,
    missingInformation: [...new Set(missingInformation)],
    nextAction: status === "DISQUALIFIED"
      ? "Keep the source observation for audit; do not place it in active acquisition follow-up."
      : status === "QUALIFIED_LEAD" || status === "CALL_READY"
        ? linkedLead?.nextAction ?? "Open the linked lead and follow its persisted next action; call readiness remains gated by contact, authority, and underwriting evidence."
        : canPromote
          ? "Review the evidence and record why this opportunity should enter the acquisition queue."
          : evaluation.nextAction,
    sourceObservationCount,
    relatedOwnerPropertyCount,
    leadId: row.leadId,
    criteriaVersion: criteria.version,
    canPromote,
    promotionBlockers,
    firstObservedAt: payload.firstObservedAt,
    lastObservedAt: iso(row.updatedAt),
  });
}

async function discoveryResponse(row: typeof propertyDiscoveriesTable.$inferSelect, database: Database = db) {
  const criteria = await getCriteriaFrom(database, row.marketKey);
  const [observations] = await database.select({ total: count() }).from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.discoveryId, row.id));
  const [owners] = row.ownerKey
    ? await database.select({ total: count() }).from(propertyDiscoveriesTable).where(and(
      eq(propertyDiscoveriesTable.marketKey, row.marketKey),
      eq(propertyDiscoveriesTable.ownerKey, row.ownerKey),
    ))
    : [{ total: 1 }];
  return toDiscoveryResponse(row, criteria, observations?.total ?? 1, owners?.total ?? 1, database);
}

export async function listPropertyDiscoveries(options: {
  marketKey?: string;
  status?: string;
  limit?: number;
} = {}, database: Database = db) {
  const marketKey = options.marketKey || DEFAULT_PROPERTY_QUALIFICATION_CRITERIA.marketKey;
  const criteria = await getCriteriaFrom(database, marketKey);
  const conditions = [eq(propertyDiscoveriesTable.marketKey, marketKey)];
  if (options.status) conditions.push(eq(propertyDiscoveriesTable.status, options.status));
  const rows = await database.select().from(propertyDiscoveriesTable)
    .where(and(...conditions))
    .orderBy(desc(propertyDiscoveriesTable.score), desc(propertyDiscoveriesTable.updatedAt))
    .limit(Math.max(1, Math.min(options.limit ?? 50, 100)));
  const countsRows = await database.select({
    status: propertyDiscoveriesTable.status,
    total: count(),
  }).from(propertyDiscoveriesTable)
    .where(eq(propertyDiscoveriesTable.marketKey, marketKey))
    .groupBy(propertyDiscoveriesTable.status);
  const counts = {
    DISCOVERED_PROPERTY: 0,
    RELEVANT_CANDIDATE: 0,
    QUALIFIED_LEAD: 0,
    CALL_READY: 0,
    DISQUALIFIED: 0,
  };
  for (const item of countsRows) {
    if (item.status in counts) counts[item.status as keyof typeof counts] = item.total;
  }
  const ids = rows.map((row) => row.id);
  const observations = ids.length
    ? await database.select({
      discoveryId: propertySourceObservationsTable.discoveryId,
      total: count(),
    }).from(propertySourceObservationsTable)
      .where(inArray(propertySourceObservationsTable.discoveryId, ids))
      .groupBy(propertySourceObservationsTable.discoveryId)
    : [];
  const observationCount = new Map(observations.map((item) => [item.discoveryId, item.total]));
  const owners = await database.select({
    id: propertyDiscoveriesTable.id,
    ownerKey: propertyDiscoveriesTable.ownerKey,
  }).from(propertyDiscoveriesTable)
    .where(eq(propertyDiscoveriesTable.marketKey, marketKey));
  const ownerCount = new Map<string, number>();
  for (const item of owners) {
    if (item.ownerKey) ownerCount.set(item.ownerKey, (ownerCount.get(item.ownerKey) ?? 0) + 1);
  }
  const records = await Promise.all(rows.map((row) => toDiscoveryResponse(
    row,
    criteria,
    observationCount.get(row.id) ?? 1,
    row.ownerKey ? ownerCount.get(row.ownerKey) ?? 1 : 1,
  )));
  return ListPropertyDiscoveriesResponse.parse({ records, counts, criteria });
}

async function persistObservation(
  property: PropertyRecord,
  sourceKey: string,
  now: Date,
  database: Tx,
) {
  const marketKey = marketKeyFor(property);
  const identityKey = propertyIdentity(property);
  await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ${identityKey},0))`);
  const criteria = await getCriteriaFrom(database, marketKey);
  const isOpa = sourceKey.startsWith("phila-opa:");
  const generated = isOpa ? generatedOpaSignals(property, criteria, now.toISOString()) : [];
  const [existing] = await database.select().from(propertyDiscoveriesTable)
    .where(eq(propertyDiscoveriesTable.identityKey, identityKey)).for("update");
  let discoveryId: string;
  let payload: DiscoveryPayload;
  let existingObservation = await database.select().from(propertySourceObservationsTable)
    .where(eq(propertySourceObservationsTable.sourceKey, sourceKey));
  if (existingObservation[0] && existingObservation[0].discoveryId !== existing?.id) {
    throw new DomainError("This source record is already attached to a different property identity; resolve the source identity before retrying.", 409);
  }
  if (existing) {
    discoveryId = existing.id;
    const current = parsePayload(existing.payload);
    const retainedSignals = isOpa
      ? current.signals.filter((signal) => !signal.id.startsWith("phila-opa:"))
      : current.signals;
    const mergedSignals = [...retainedSignals, ...generated];
    payload = {
      ...current,
      property: isOpa ? property : current.property,
      ...(isOpa ? { opaProperty: property } : {}),
      signals: mergedSignals,
    };
    const evaluation = evaluatePropertyRelevance(mergedSignals, criteria);
    const nextStatus = ["QUALIFIED_LEAD", "CALL_READY", "DISQUALIFIED"].includes(existing.status)
      ? existing.status
      : evaluation.status;
    await database.update(propertyDiscoveriesTable).set({
      ownerKey: isOpa ? ownerIdentity(property) : existing.ownerKey ?? ownerIdentity(property),
      status: nextStatus,
      score: evaluation.score,
      confidence: evaluation.confidence,
      payload: jsonRecord(payload),
      version: existing.version + 1,
      updatedAt: now,
    }).where(eq(propertyDiscoveriesTable.id, discoveryId));
  } else {
    payload = {
      property,
      ...(isOpa ? { opaProperty: property } : {}),
      signals: generated,
      firstObservedAt: now.toISOString(),
    };
    const evaluation = evaluatePropertyRelevance(generated, criteria);
    const [inserted] = await database.insert(propertyDiscoveriesTable).values({
      identityKey,
      ownerKey: ownerIdentity(property),
      marketKey,
      status: evaluation.status,
      score: evaluation.score,
      confidence: evaluation.confidence,
      payload: jsonRecord(payload),
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!inserted) throw new DomainError("Could not save the property discovery.", 500);
    discoveryId = inserted.id;
  }
  const priorObservation = existingObservation[0];
  if (priorObservation) {
    await database.update(propertySourceObservationsTable).set({
      lastObservedAt: now,
      seenCount: priorObservation.seenCount + 1,
      payload: jsonRecord(property),
    }).where(eq(propertySourceObservationsTable.id, priorObservation.id));
  } else {
    await database.insert(propertySourceObservationsTable).values({
      discoveryId,
      sourceKey,
      sourceId: property.id,
      sourceUrl: property.sourceUrl,
      firstObservedAt: now,
      lastObservedAt: now,
      seenCount: 1,
      payload: jsonRecord(property),
    });
  }
  const [saved] = await database.select().from(propertyDiscoveriesTable)
    .where(eq(propertyDiscoveriesTable.id, discoveryId));
  if (!saved) throw new DomainError("Saved property discovery could not be reloaded.", 500);
  return saved;
}

export async function recordPropertyObservation(
  property: PropertyRecord,
  sourceKey: string,
  actor: string,
  now = new Date(),
) {
  if (!sourceKey.trim()) throw new DomainError("A stable source identity is required.");
  const saved = await db.transaction(async (tx) => {
    const row = await persistObservation(property, sourceKey, now, tx);
    await audit(tx, actor, "PROPERTY_DISCOVERED", row.id, `${property.provider} source observation saved; active lead not created.`);
    return row;
  });
  return RecordPublicPropertyDiscoveryResponse.parse(await discoveryResponse(saved));
}

export async function recordPublicPropertyDiscovery(recordId: string, termsReviewed: boolean, actor: OfferActor, now = new Date()) {
  requireSourceTerms(actor, termsReviewed);
  if (!/^\d{9}$/.test(recordId)) throw new DomainError("Invalid official parcel identifier.");
  let property: PropertyRecord;
  try {
    property = await propertyById(recordId, now);
  } catch (error) {
    throw new DomainError(error instanceof Error ? error.message : "Official property source could not be read.", 502);
  }
  const sourceKey = `phila-opa:${recordId}`;
  const saved = await db.transaction(async (tx) => {
    const row = await persistObservation(property, sourceKey, now, tx);
    await audit(tx, actor.id, "PROPERTY_DISCOVERED", row.id, "Philadelphia OPA source observation saved. Qualification remains separate from discovery.");
    return row;
  });
  return RecordPublicPropertyDiscoveryResponse.parse(await discoveryResponse(saved));
}

function validateSignal(input: ReturnType<typeof AddPropertyRelevanceSignalBody.parse>, now: Date): PropertyRelevanceSignal {
  if (PROPERTY_SIGNAL_GROUP_BY_KEY[input.key] !== input.group) {
    throw new DomainError(`Signal ${input.key} belongs to the ${PROPERTY_SIGNAL_GROUP_BY_KEY[input.key]} group; it cannot be relabeled to bypass independent-evidence thresholds.`);
  }
  if (!input.sourceUrl && !input.evidenceRef) {
    throw new DomainError("A source link or specific evidence reference is required for every relevance signal.");
  }
  if (input.sourceUrl) {
    let url: URL;
    try { url = new URL(input.sourceUrl); } catch { throw new DomainError("Signal source URL must be a valid HTTP(S) link."); }
    if (!["http:", "https:"].includes(url.protocol)) throw new DomainError("Signal source URL must use HTTP or HTTPS.");
  }
  if (input.sourceType === "MODEL" && input.classification !== "AI_HYPOTHESIS") {
    throw new DomainError("Model-originated signals must remain AI HYPOTHESIS.");
  }
  if (input.classification === "AI_HYPOTHESIS" && input.sourceType !== "MODEL") {
    throw new DomainError("AI HYPOTHESIS signals must be labeled as model-originated.");
  }
  if (input.classification === "VERIFIED" && !["PUBLIC_RECORD", "INSPECTION"].includes(input.sourceType)) {
    throw new DomainError("VERIFIED signals require a public-record or inspection source; seller statements remain indicated.");
  }
  if (Date.parse(input.capturedAt) > now.getTime() + 60_000) {
    throw new DomainError("Signal capture time cannot be in the future.");
  }
  return {
    id: randomUUID(),
    key: input.key,
    group: input.group as PropertySignalGroup,
    classification: input.classification as EvidenceClassification,
    sourceType: input.sourceType,
    statement: input.statement.trim(),
    source: input.source.trim(),
    sourceUrl: input.sourceUrl,
    evidenceRef: input.evidenceRef,
    capturedAt: input.capturedAt,
    confidence: input.confidence,
  };
}

export async function addPropertyRelevanceSignal(
  discoveryId: string,
  input: unknown,
  actor: OfferActor,
  now = new Date(),
) {
  requireReviewer(actor);
  const request = AddPropertyRelevanceSignalBody.parse(input);
  const signal = validateSignal(request, now);
  const row = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(propertyDiscoveriesTable)
      .where(eq(propertyDiscoveriesTable.id, discoveryId)).for("update");
    if (!current) throw new DomainError("Property discovery not found.", 404);
    if (current.version !== request.version) throw new DomainError("This property discovery changed in another session. Reload before saving.", 409);
    if (["QUALIFIED_LEAD", "CALL_READY", "DISQUALIFIED"].includes(current.status)) {
      throw new DomainError("Evidence is locked after promotion or pass; update the linked lead through its existing evidence workflow.", 409);
    }
    const criteria = await getCriteriaFrom(tx, current.marketKey);
    const payload = parsePayload(current.payload);
    payload.signals = [...payload.signals, signal];
    const evaluation = evaluatePropertyRelevance(payload.signals, criteria);
    const [saved] = await tx.update(propertyDiscoveriesTable).set({
      status: evaluation.status,
      score: evaluation.score,
      confidence: evaluation.confidence,
      payload: jsonRecord(payload),
      version: current.version + 1,
      updatedAt: now,
    }).where(eq(propertyDiscoveriesTable.id, discoveryId)).returning();
    await audit(tx, actor.id, "PROPERTY_RELEVANCE_SIGNAL_ADDED", discoveryId, `${signal.key} ${signal.classification} from ${signal.source}; contribution ${evaluation.scoredSignals.at(-1)?.points ?? 0}.`);
    if (!saved) throw new DomainError("Could not save the relevance evidence.", 500);
    return saved;
  });
  return AddPropertyRelevanceSignalResponse.parse(await discoveryResponse(row));
}

export async function disqualifyPropertyDiscovery(
  discoveryId: string,
  input: unknown,
  actor: OfferActor,
  now = new Date(),
) {
  requireReviewer(actor);
  const request = DisqualifyPropertyDiscoveryBody.parse(input);
  const saved = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(propertyDiscoveriesTable)
      .where(eq(propertyDiscoveriesTable.id, discoveryId)).for("update");
    if (!current) throw new DomainError("Property discovery not found.", 404);
    if (current.version !== request.version) throw new DomainError("This property discovery changed in another session. Reload before saving.", 409);
    if (current.leadId || ["QUALIFIED_LEAD", "CALL_READY"].includes(current.status)) {
      throw new DomainError("A promoted lead cannot be passed from the discovery queue; use the existing lead disposition workflow.", 409);
    }
    const payload = parsePayload(current.payload);
    payload.disposition = { actor: actor.id, at: now.toISOString(), reason: request.reason.trim() };
    const [row] = await tx.update(propertyDiscoveriesTable).set({
      status: "DISQUALIFIED", payload: jsonRecord(payload), version: current.version + 1, updatedAt: now,
    }).where(eq(propertyDiscoveriesTable.id, discoveryId)).returning();
    await audit(tx, actor.id, "PROPERTY_DISCOVERY_PASSED", discoveryId, request.reason.trim());
    if (!row) throw new DomainError("Could not save the pass decision.", 500);
    return row;
  });
  return DisqualifyPropertyDiscoveryResponse.parse(await discoveryResponse(saved));
}

export async function promotePropertyDiscovery(
  discoveryId: string,
  input: unknown,
  actor: OfferActor,
  now = new Date(),
) {
  requireReviewer(actor);
  const request = PromotePropertyDiscoveryBody.parse(input);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(propertyDiscoveriesTable)
      .where(eq(propertyDiscoveriesTable.id, discoveryId)).for("update");
    if (!current) throw new DomainError("Property discovery not found.", 404);
    if (current.version !== request.version) throw new DomainError("This property discovery changed in another session. Reload before promoting.", 409);
    if (current.leadId) {
      return PromotePropertyDiscoveryResponse.parse({ discovery: await toDiscoveryResponse(current, await getCriteriaFrom(tx, current.marketKey), 1, 1, tx), leadId: current.leadId });
    }
    if (current.status === "DISQUALIFIED") throw new DomainError("A passed property must be explicitly restored before it can be promoted.", 409);
    const payload = parsePayload(current.payload);
    const criteria = await getCriteriaFrom(tx, current.marketKey);
    const evaluation = evaluatePropertyRelevance(payload.signals, criteria);
    const missingFacts = factCompletenessBlockers(payload.property);
    if (!evaluation.canPromote || missingFacts.length) {
      throw new DomainError([...evaluation.promotionBlockers, ...missingFacts].join(" "), 409);
    }
    const sourceKey = `phila-opa:${payload.property.id}`;
    const identity = normalAddress(payload.property.address);
    const possibleExisting = await tx.select().from(leadsTable).where(sql`
      upper(${leadsTable.payload}->>'state') = ${payload.property.state.toUpperCase()}
      AND upper(${leadsTable.payload}->>'city') = ${payload.property.city.toUpperCase()}
      AND left(${leadsTable.payload}->>'zip',5) = ${payload.property.zip.slice(0,5)}
      AND regexp_replace(upper(${leadsTable.payload}->>'address'),'[^A-Z0-9]','','g') = ${identity}
    `).for("update");
    if (possibleExisting.length > 1) {
      throw new DomainError("Multiple active lead records already match this property. Resolve that duplicate before promotion.", 409);
    }
    if (possibleExisting.length === 1) {
      const existing = possibleExisting[0]!;
      if (existing.payload.sourceKey && !existing.payload.propertyQualification) {
        throw new DomainError("An earlier unqualified source import already created a lead for this property. Review and reconcile that record rather than creating a duplicate.", 409);
      }
      throw new DomainError("A lead already exists for this property. Link the observation to that lead instead of creating a duplicate.", 409);
    }
    const lead = await createLead({
      address: payload.property.address,
      city: payload.property.city,
      state: payload.property.state,
      county: "Philadelphia",
      zip: payload.property.zip,
      propertyType: payload.property.propertyType,
      sqft: payload.property.sqft!,
      beds: payload.property.beds!,
      baths: payload.property.baths!,
      units: 1,
      sellerName: "Seller not yet identified",
      askingPrice: null,
      urgency: "UNKNOWN",
      source: `${payload.property.provider}; ${payload.property.sourceUrl}. Qualified from discovery ${discoveryId}; seller identity and authority remain unverified.`,
      nextAction: "Verify seller identity and contact permission, then establish condition and underwriting inputs before any offer.",
    }, actor.id, now, tx);
    const [leadRow] = await tx.select().from(leadsTable).where(eq(leadsTable.id, lead.id)).for("update");
    if (!leadRow) throw new DomainError("Promoted lead could not be reloaded.", 500);
    await move(tx, leadRow, "ENRICHING",
      `Human-reviewed qualified opportunity. ${evaluation.reason}`,
      lead.nextAction, actor.id, now);
    const qualification = {
      discoveryId,
      status: "QUALIFIED_LEAD",
      score: evaluation.score,
      confidence: evaluation.confidence,
      criteriaVersion: criteria.version,
      reviewReason: request.reviewReason.trim(),
      qualifiedBy: actor.id,
      qualifiedAt: now.toISOString(),
      sourceKey,
      reason: evaluation.reason,
      signals: evaluation.scoredSignals.map(({ points, ...signal }) => ({ ...signal, scoreContribution: points })),
      missingInformation: [...evaluation.missingInformation, ...missingFacts],
      nextAction: lead.nextAction,
    };
    await tx.update(leadsTable).set({
      payload: { ...leadRow.payload, sourceKey, propertyQualification: qualification },
      stage: leadRow.stage,
      nextAction: leadRow.nextAction,
      version: leadRow.version + 1,
      updatedAt: now,
    }).where(eq(leadsTable.id, lead.id));
    for (const signal of payload.signals) {
      const classification = signal.classification === "VERIFIED" ? "VERIFIED_FACTS" : signal.classification;
      if (classification === "VERIFIED_FACTS" && !["PUBLIC_RECORD", "INSPECTION"].includes(signal.sourceType)) {
        throw new DomainError("Verified seller motivation is not allowed; record a seller statement as indicated evidence.");
      }
      const entry: IntelligenceInput = {
        category: `property_relevance:${signal.key.toLowerCase()}`,
        statement: signal.statement,
        source: signal.source,
        sourceType: signal.sourceType,
        classification,
        confidence: signal.confidence,
        capturedAt: signal.capturedAt,
        ...(signal.sourceUrl ? { sourceUrl: signal.sourceUrl } : {}),
        ...(classification === "VERIFIED_FACTS"
          ? { verificationNote: `Reviewed evidence reference: ${signal.evidenceRef ?? signal.sourceUrl}` }
          : {}),
        ...(classification === "AI_HYPOTHESIS"
          ? { question: "What source-backed evidence can corroborate this hypothesis?", action: "Corroborate with the cited evidence before relying on it." }
          : {}),
      };
      validateProvenance(entry, now);
      await tx.insert(intelligenceTable).values({
        leadId: lead.id,
        payload: jsonRecord(entry),
        createdBy: actor.id,
        createdAt: now,
      });
    }
    payload.promotion = { actor: actor.id, at: now.toISOString(), reviewReason: request.reviewReason.trim() };
    const [updated] = await tx.update(propertyDiscoveriesTable).set({
      status: "QUALIFIED_LEAD",
      score: evaluation.score,
      confidence: evaluation.confidence,
      leadId: lead.id,
      payload: jsonRecord(payload),
      version: current.version + 1,
      updatedAt: now,
    }).where(eq(propertyDiscoveriesTable.id, discoveryId)).returning();
    await audit(tx, actor.id, "PROPERTY_DISCOVERY_PROMOTED", discoveryId, `Created active lead ${lead.id}; qualification score ${evaluation.score}. ${request.reviewReason}`);
    if (!updated) throw new DomainError("Promoted discovery could not be saved.", 500);
    const observations = await tx.select({ total: count() }).from(propertySourceObservationsTable)
      .where(eq(propertySourceObservationsTable.discoveryId, discoveryId));
    const ownerCount = current.ownerKey
      ? await tx.select({ total: count() }).from(propertyDiscoveriesTable).where(and(
        eq(propertyDiscoveriesTable.marketKey, current.marketKey),
        eq(propertyDiscoveriesTable.ownerKey, current.ownerKey),
      ))
      : [{ total: 1 }];
    const discovery = await toDiscoveryResponse(updated, criteria, observations[0]?.total ?? 1, ownerCount[0]?.total ?? 1, tx);
    return PromotePropertyDiscoveryResponse.parse({ discovery, leadId: lead.id });
  });
}

export async function savePropertyDiscoveryCriteria(
  marketKey: string,
  input: unknown,
  actor: OfferActor,
  now = new Date(),
) {
  requireReviewer(actor);
  const body = SavePropertyDiscoveryCriteriaBody.parse(input);
  if (body.candidateThreshold >= body.qualifiedLeadThreshold) {
    throw new DomainError("Candidate threshold must stay below the qualified-lead threshold.");
  }
  if (body.minimumIndependentSignalGroups < 2) {
    throw new DomainError("At least two independent evidence groups are required for qualification.");
  }
  if (new Set(body.signalRules.map((rule) => rule.key)).size !== body.signalRules.length) {
    throw new DomainError("Each relevance signal can have only one market-specific weight.");
  }
  return db.transaction(async (tx) => {
    const [prior] = await tx.select().from(propertyQualificationCriteriaTable)
      .where(eq(propertyQualificationCriteriaTable.marketKey, marketKey)).for("update");
    const version = (prior?.version ?? 0) + 1;
    const criteria = GetPropertyDiscoveryCriteriaResponse.parse({ ...body, marketKey, version });
    if (prior) {
      await tx.update(propertyQualificationCriteriaTable).set({
        version, criteria: jsonRecord(criteria), updatedAt: now,
      }).where(eq(propertyQualificationCriteriaTable.id, prior.id));
    } else {
      await tx.insert(propertyQualificationCriteriaTable).values({
        marketKey, version, criteria: jsonRecord(criteria), updatedAt: now,
      });
    }
    const rows = await tx.select().from(propertyDiscoveriesTable)
      .where(eq(propertyDiscoveriesTable.marketKey, marketKey)).for("update");
    for (const row of rows) {
      if (!["DISCOVERED_PROPERTY", "RELEVANT_CANDIDATE"].includes(row.status)) continue;
      const payload = parsePayload(row.payload);
      const nonOpa = payload.signals.filter((signal) => !signal.id.startsWith("phila-opa:"));
      const opa = payload.opaProperty
        ? generatedOpaSignals(payload.opaProperty, criteria, row.updatedAt.toISOString())
        : [];
      payload.signals = [...nonOpa, ...opa];
      const evaluation = evaluatePropertyRelevance(payload.signals, criteria);
      await tx.update(propertyDiscoveriesTable).set({
        status: evaluation.status,
        score: evaluation.score,
        confidence: evaluation.confidence,
        payload: jsonRecord(payload),
        version: row.version + 1,
        updatedAt: now,
      }).where(eq(propertyDiscoveriesTable.id, row.id));
    }
    await audit(tx, actor.id, "PROPERTY_QUALIFICATION_CRITERIA_UPDATED", marketKey, `Saved market qualification rules at version ${version}.`);
    return SavePropertyDiscoveryCriteriaResponse.parse(criteria);
  });
}
