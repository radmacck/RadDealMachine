import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { eq, sql } from "drizzle-orm";
import { db, buyersTable } from "@workspace/db";
import { DiscoverBuyerBody, RequestBuyerQualificationBody } from "@workspace/api-zod";
import { assertOperationsRole, DomainError, evidenceUrl, pastInstant, qualificationMaintenanceKind, type OfferActor, type Buyer } from "@workspace/deal-domain";
import { searchPublicProperties } from "./property-source-store";
import type { RepeatedTransferBuyer } from "@workspace/property-sources";
import { audit } from "./deal-store";
import { allBuyerRecords, buyerRecord, queueJob } from "./operations-records";
import { allPropertySourceConnectors } from "./property-source-connectors";
import { buyerOutreachReadiness } from "./buyer-outreach";
type Prospect = ReturnType<typeof DiscoverBuyerBody.parse>;
type SourceObservationInput = {
  sourceId: string;
  recordIdentities: string[];
  activityCount: number;
  eventAt: string | null;
};

const normalizeEntityName = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const entityIdentity = (value: string) => createHash("sha256").update(`phila-public-entity:${normalizeEntityName(value)}`).digest("hex");
const publicOwnerKey = (value: string) => createHash("sha256").update(`phila-opa-tax-owner:${value.trim().toUpperCase()}`).digest("hex");
const SOURCE_POLICY_PROPERTY = "phila-property-sources-v2";
const SOURCE_POLICY_BUYER = "phila-buyer-sources-v2";
type BuyerSourceHistory = {
  capturedAt:string;statement:string;confidence:number;recordIdentities:string[];
  activityCount:number;eventAt:string|null;
};

function normalizeSourceObservation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.sourceId !== "string" || typeof row.source !== "string" ||
    typeof row.sourceUrl !== "string" || typeof row.statement !== "string" ||
    typeof row.firstObservedAt !== "string" || typeof row.lastObservedAt !== "string" ||
    typeof row.capturedAt !== "string" || !Array.isArray(row.recordIdentities)) return null;
  const history = Array.isArray(row.history) ? row.history.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.capturedAt !== "string" || typeof entry.statement !== "string") return [];
    return [{
      capturedAt: entry.capturedAt,
      statement: entry.statement,
      confidence: typeof entry.confidence === "number" ? entry.confidence : 0,
      recordIdentities: Array.isArray(entry.recordIdentities)
        ? entry.recordIdentities.filter((id): id is string => typeof id === "string").slice(0, 100)
        : [],
      activityCount: typeof entry.activityCount === "number" ? entry.activityCount : 1,
      eventAt: typeof entry.eventAt === "string" ? entry.eventAt : null,
    }];
  }).slice(-20) : [];
  return {
    sourceId: row.sourceId,
    source: row.source,
    sourceUrl: row.sourceUrl,
    classification: "OBSERVED" as const,
    statement: row.statement,
    confidence: typeof row.confidence === "number" ? row.confidence : 0,
    capturedAt: row.capturedAt,
    firstObservedAt: row.firstObservedAt,
    lastObservedAt: row.lastObservedAt,
    seenCount: typeof row.seenCount === "number" ? row.seenCount : 1,
    recordIdentities: row.recordIdentities.filter((id): id is string => typeof id === "string").slice(0, 100),
    activityCount: typeof row.activityCount === "number" ? row.activityCount : 1,
    eventAt: typeof row.eventAt === "string" ? row.eventAt : null,
    history,
  };
}

function observationContent(row: NonNullable<ReturnType<typeof normalizeSourceObservation>>) {
  return {
    source: row.source,
    sourceUrl: row.sourceUrl,
    statement: row.statement,
    confidence: row.confidence,
    recordIdentities: row.recordIdentities,
    activityCount: row.activityCount,
    eventAt: row.eventAt,
  };
}

function sourceObservation(
  p: Prospect,
  context: SourceObservationInput | undefined,
  identity: string,
) {
  const capturedAt = new Date(p.capturedAt).toISOString();
  const ids = context?.recordIdentities ?? [];
  if (context && (context.recordIdentities.length > 100 ||
    context.recordIdentities.some(id => !id.trim() || id.length > 200) ||
    !context.sourceId.trim() || context.sourceId.length > 300 ||
    !Number.isInteger(context.activityCount) || context.activityCount < 1 ||
    (context.eventAt && (!Number.isFinite(Date.parse(context.eventAt)) || Date.parse(context.eventAt) > Date.parse(capturedAt))))) {
    throw new DomainError("Public buyer source observation failed its identity, count, or date checks.", 422);
  }
  return {
    sourceId: context?.sourceId ?? `public-source:${identity}`,
    source: p.source,
    sourceUrl: p.sourceUrl,
    classification: "OBSERVED" as const,
    statement: p.source,
    confidence: p.confidence,
    capturedAt,
    firstObservedAt: capturedAt,
    lastObservedAt: capturedAt,
    seenCount: 1,
    recordIdentities: ids,
    activityCount: context?.activityCount ?? 1,
    eventAt: context?.eventAt ?? null,
    history: [] as BuyerSourceHistory[],
  };
}

function mergeSourceObservation(
  prior: NonNullable<ReturnType<typeof normalizeSourceObservation>> | undefined,
  incoming: ReturnType<typeof sourceObservation>,
) {
  if (!prior) return { observation: incoming, contentChanged: true, captureChanged: true };
  const last = Date.parse(prior.lastObservedAt);
  const captured = Date.parse(incoming.capturedAt);
  if (Number.isFinite(last) && Number.isFinite(captured) && captured < last) {
    return { observation: prior, contentChanged: false, captureChanged: false };
  }
  const captureChanged = Number.isFinite(captured) && captured > last;
  const candidate = {
    ...incoming,
    firstObservedAt: prior.firstObservedAt,
    lastObservedAt: captureChanged ? incoming.capturedAt : prior.lastObservedAt,
    seenCount: prior.seenCount + (captureChanged ? 1 : 0),
  };
  const contentChanged = !isDeepStrictEqual(observationContent(prior), observationContent(candidate));
  candidate.history = contentChanged
    ? [...prior.history, {
        capturedAt: prior.capturedAt,
        statement: prior.statement,
        confidence: prior.confidence,
        recordIdentities: prior.recordIdentities,
        activityCount: prior.activityCount,
        eventAt: prior.eventAt,
      }].slice(-20)
    : prior.history;
  return { observation: candidate, contentChanged, captureChanged };
}
function buyerCriteriaSummary(b: Pick<Buyer,"criteria">) {
  const c = b.criteria;
  if (!c) return "No structured buying criteria are on file yet.";
  const money = (n: number | null | undefined) => n == null ? null : `$${Math.round(n).toLocaleString("en-US")}`;
  const lines = [
    [`Markets`, [c.states, c.counties ?? [], c.cities, c.zipCodes].flat().filter(Boolean).join(", ")],
    ["Property types", c.propertyTypes.join(", ")],
    ["Purchase range", [money(c.minPurchasePrice), money(c.maxPurchasePrice)].filter(Boolean).join("–")],
    ["ARV range", [money(c.minArv), money(c.maxArv)].filter(Boolean).join("–")],
    ["Units", [c.minUnits, c.maxUnits].filter(x => x != null).join("–")],
    ["Beds / baths", [c.minBeds != null ? `${c.minBeds}+ beds` : null, c.maxBeds != null ? `up to ${c.maxBeds} beds` : null,
      c.minBaths != null ? `${c.minBaths}+ baths` : null, c.maxBaths != null ? `up to ${c.maxBaths} baths` : null].filter(Boolean).join(", ")],
    ["Square feet", [c.minSqft, c.maxSqft].filter(x => x != null).join("–")],
    ["Maximum repairs", money(c.maxRepairs)],
    ["Rehab tolerance", c.rehabTolerance],
    ["Strategies", c.strategies?.join(", ")],
    ["Funding types stated", c.fundingTypes?.join(", ")],
    ["Closing speed", `${c.closingDays} days`],
    ["Concurrent capacity", c.maxConcurrentDeals],
    ["Minimum spread", money(c.minSpread)],
    ["Minimum cap rate", c.minCapRate == null ? null : `${(c.minCapRate * 100).toFixed(2)}%`],
    ["Excluded counties", c.excludedCounties?.join(", ")],
    ["Excluded cities", c.excludedCities?.join(", ")],
    ["Excluded ZIP codes", c.excludedZipCodes?.join(", ")],
  ].filter(([, value]) => value != null && value !== "");
  return lines.map(([label, value]) => `${label}: ${value}`).join("\n");
}

export function qualificationTask(
  b: Pick<Buyer,"name"|"criteria"|"destinationKind"|"email"|"phone">,
  kind:"QUALIFY"|"REVERIFY",
  now:Date,
) {
  const destination = b.destinationKind && b.destinationKind!=="BUYER";
  return {id:randomUUID(),kind,state:"WAITING_EXTERNAL" as const,
    reason:kind==="REVERIFY"?"Dated buying/criteria or identity/funding evidence expired. Approval and matching are blocked.":"Discovery is not approval. Confirm identity, contact permission, current buying/accepting status and structured criteria.",
    preparedMessage:`We are reviewing the buying profile currently on file. It is not independently re-verified:\n${buyerCriteriaSummary(b)}\n\nPlease confirm or correct only what has changed. Are you currently ${destination?"accepting qualified deals":"buying"}? Please provide current dated evidence for identity/authority, buying status, criteria and funding/capacity; a response alone does not grant approval. ${destination?"Please also confirm any fee terms and who can act as the acquisition buyer.":"Please state current funding arrangements and available closing capacity."}`,
    outreachReadiness:buyerOutreachReadiness(b,now),
    dueAt:now.toISOString(),updatedAt:now.toISOString()};
}
export async function discoverBuyer(
  input: Prospect,
  actor: OfferActor,
  now = new Date(),
  sourceKey?:string,
  observationContext?: SourceObservationInput,
) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  const p = DiscoverBuyerBody.parse(input);
  evidenceUrl(p.sourceUrl); pastInstant(p.capturedAt,now,"Discovery observation");
  const normalizedName = normalizeEntityName(p.name);
  const publicRecord = !!sourceKey || /^Philadelphia (?:official tax record|OPA|Real Estate Transfers)/i.test(p.source);
  const key = sourceKey ?? (publicRecord
    ? publicOwnerKey(p.name)
    : createHash("sha256").update(`${p.sourceUrl}|${p.name.trim().toLowerCase()}`).digest("hex"));
  const identity = publicRecord ? entityIdentity(p.name) : "";
  const incoming = sourceObservation(p, observationContext, identity || key);
  return db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ${`prospect:${identity || key}`},0))`);
    let [existing] = await tx.select().from(buyersTable).where(sql`${buyersTable.payload}->>'discoveryKey' = ${key}`).for("update");
    if (!existing && identity) {
      [existing] = await tx.select().from(buyersTable)
        .where(sql`${buyersTable.payload}->>'discoveryIdentityKey' = ${identity}`).for("update");
    }
    if (!existing && identity && normalizedName) {
      [existing] = await tx.select().from(buyersTable).where(sql`
        ${buyersTable.payload}->>'discoveryKey' IS NOT NULL
        AND regexp_replace(upper(coalesce(${buyersTable.payload}->>'name','')), '[^A-Z0-9]', '', 'g') = ${normalizedName}
      `).for("update");
    }
    if (existing) {
      const oldObservations = Array.isArray(existing.payload.sourceObservations)
        ? existing.payload.sourceObservations.map(normalizeSourceObservation).filter((row): row is NonNullable<ReturnType<typeof normalizeSourceObservation>> => !!row)
        : [];
      if (!oldObservations.length && existing.payload.discoveryEvidence) {
        const legacy = existing.payload.discoveryEvidence as Record<string, unknown>;
        const parsed = normalizeSourceObservation({
          sourceId: `legacy:${createHash("sha256").update(`${String(legacy.sourceUrl)}|${String(legacy.source)}`).digest("hex")}`,
          source: legacy.source, sourceUrl: legacy.sourceUrl, statement: legacy.source,
          confidence: legacy.confidence, classification: "OBSERVED",
          capturedAt: legacy.capturedAt, firstObservedAt: legacy.capturedAt, lastObservedAt: legacy.capturedAt,
          seenCount: 1, recordIdentities: [], activityCount: 1, eventAt: null,
        });
        if (parsed) oldObservations.push(parsed);
      }
      const prior = oldObservations.find(row => row.sourceId === incoming.sourceId);
      const merged = mergeSourceObservation(prior, incoming);
      const sourceObservations = prior
        ? oldObservations.map(row => row.sourceId === incoming.sourceId ? merged.observation : row)
        : [...oldObservations, merged.observation];
      if (sourceObservations.length > 500) sourceObservations.splice(0, sourceObservations.length - 500);
      const changed = !prior || merged.contentChanged || merged.captureChanged || !Array.isArray(existing.payload.sourceObservations);
      if (changed) {
        const [saved] = await tx.update(buyersTable).set({
          payload: {
            ...existing.payload,
            discoveryKey: key,
            ...(identity ? { discoveryIdentityKey: identity } : {}),
            sourceObservations,
            discoveryEvidence: {
              classification: "OBSERVED",
              source: p.source,
              sourceUrl: p.sourceUrl,
              capturedAt: p.capturedAt,
              confidence: p.confidence,
            },
          },
          version: existing.version + 1,
          updatedAt: now,
        }).where(eq(buyersTable.id, existing.id)).returning();
        if (!saved) throw new Error("Buyer source observation update failed.");
        if (!prior || merged.contentChanged) {
          await audit(tx,actor.id,"BUYER_SOURCE_EVIDENCE_REFRESHED",saved.id,
            `${p.source.split(".")[0]}; source-backed buyer discovery evidence changed. Buyer remains subject to current identity, intent, criteria and funding review; no approval or contact was inferred.`);
        }
        return buyerRecord(saved,now);
      }
      return buyerRecord(existing,now);
    }
    const payload = {name:p.name.trim(),email:p.email??"",phone:p.phone??"",source:p.source,
      destinationKind:p.destinationKind??"BUYER",criteria:null,status:"PAUSED",currentBuyingStatus:"UNKNOWN",discoveryKey:key,
      ...(identity ? {discoveryIdentityKey:identity} : {}),
      discoveryEvidence:{classification:"OBSERVED",source:p.source,sourceUrl:p.sourceUrl,capturedAt:p.capturedAt,confidence:p.confidence},
      sourceObservations:[incoming]};
    const [row] = await tx.insert(buyersTable).values({payload:{...payload,qualificationTask:qualificationTask(payload,"QUALIFY",now)},createdAt:now,updatedAt:now}).returning();
    if (!row) throw new Error("Prospect insert failed.");
    await audit(tx,actor.id,"BUYER_DISCOVERED",row.id,"Observed source lead only; no contact permission, criteria, funding or current buying inferred. Qualification waits for evidence; no communication was sent.");
    return buyerRecord(row,now);
  });
}
export async function discoverPublicBuyers(now = new Date()) {
  const feed = await searchPublicProperties(undefined,"buyer_candidates",now);
  const byOwner = new Map<string, { name: string; records: Array<(typeof feed.records)[number]> }>();
  for (const record of feed.records) {
    const owner = record.recordedOwner?.trim().replace(/\s+/g," ");
    if (!owner || owner.length > 200) continue;
    const key = normalizeEntityName(owner);
    const group = byOwner.get(key) ?? { name: owner, records: [] };
    group.records.push(record);
    byOwner.set(key,group);
  }
  let ownerGroups = 0;
  for (const group of byOwner.values()) {
    const recordIds = [...new Set(group.records.map(record => record.id))].slice(0,100);
    const eventAt = group.records.map(record=>record.lastSaleAt).filter((value):value is string=>!!value)
      .sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
    const sourceId = `phila-opa-owner:${entityIdentity(group.name)}`;
    const p = {
      name:group.name,
      source:`Philadelphia OPA corporate tax-roll owner observed on ${recordIds.length} sampled parcel record${recordIds.length===1?"":"s"}. This is ownership-context research, not current buying intent, title verification, seller motivation or acquisition authority.`,
      sourceUrl:group.records[0]!.sourceUrl,
      capturedAt:now.toISOString(),
      confidence:0.55,
    };
    await discoverBuyer(p,{id:"system:buyer-discovery",role:"ANALYST"},now,publicOwnerKey(group.name),{
      sourceId,recordIdentities:recordIds,activityCount:recordIds.length,eventAt,
    });
    ownerGroups++;
  }
  const buyerActivityConnectors = allPropertySourceConnectors().filter(adapter => adapter.discoverBuyerActivity);
  if (!buyerActivityConnectors.length) throw new DomainError("No public buyer-activity source connector is registered.", 503);
  let transferBuyerGroups = 0;
  for (const adapter of buyerActivityConnectors) {
    const transferBuyers: RepeatedTransferBuyer[] = await adapter.discoverBuyerActivity!(now);
    transferBuyerGroups += transferBuyers.length;
    for (const buyer of transferBuyers) {
      const sourceId = `${adapter.observationKeyPrefix ?? adapter.id}:${entityIdentity(buyer.name)}`;
      await discoverBuyer({
        name:buyer.name,
        source:buyer.source,
        sourceUrl:buyer.sourceUrl,
        capturedAt:buyer.capturedAt,
        confidence:buyer.confidence,
      },{id:"system:buyer-discovery",role:"ANALYST"},now,publicOwnerKey(buyer.name),{
        sourceId,
        recordIdentities:buyer.recordIdentities,
        activityCount:buyer.activityCount,
        eventAt:buyer.latestActivityAt,
      });
    }
  }
  return `Refreshed ${ownerGroups} bounded Philadelphia OPA corporate-owner groups and ${transferBuyerGroups} repeated recorded-grantee groups. Source observations are deduplicated by entity and channel; every record remains unverified with UNKNOWN current buying status and is excluded from matching. No criteria, contact permission, funding, current intent or approval inferred.`;
}
export async function reviewBuyerPool(now = new Date()) {
  const rows = await allBuyerRecords(db,now);
  let created = 0;
  for (const b of rows) {
    if (!qualificationMaintenanceKind(b,now)) continue;
    await db.transaction(async tx=>{
      const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id,b.id)).for("update");
      const current = buyerRecord(row!,now);
      const kind = qualificationMaintenanceKind(current,now);
      if (!kind) return;
      const task = qualificationTask(current,kind,now);
      await tx.update(buyersTable).set({payload:{...row!.payload,qualificationTask:task},version:row!.version+1,updatedAt:now}).where(eq(buyersTable.id,b.id));
      await audit(tx,"system:buyer-pool","BUYER_QUALIFICATION_QUEUED",b.id,`${task.kind}: ${task.reason} External execution is pending, not sent.`);
      created++;
    });
  }
  return `${created} durable qualification/reverification tasks prepared; current approval is computed from dated evidence. No messages sent.`;
}
export async function requestBuyerQualification(id:string,input:unknown,actor:OfferActor,now = new Date()) {
  assertOperationsRole(actor,["OWNER"]);
  const p = RequestBuyerQualificationBody.parse(input);
  return db.transaction(async tx=>{
    const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id,id)).for("update");
    if (!row) throw new DomainError("Buyer not found.",404);
    if (row.version!==p.version) throw new DomainError("Buyer changed. Reload before requesting additional evidence.",409);
    const b = buyerRecord(row,now);
    if (b.qualificationTask&&["WAITING_EXTERNAL","PENDING_EXECUTION"].includes(b.qualificationTask.state))
      throw new DomainError("An outreach/evidence request is already pending. Use its current handoff.",409);
    const task = qualificationTask(b,b.approvalStatus==="REVERIFICATION_REQUIRED"?"REVERIFY":"QUALIFY",now);
    task.reason = `Explicit additional-evidence request: ${p.note}. Approval remains subject to owner evidence review.`;
    task.preparedMessage = `${task.preparedMessage}\n\nAdditional evidence requested by the reviewer: ${p.note}`;
    const history = Array.isArray(row.payload.qualificationTaskHistory)?row.payload.qualificationTaskHistory:[];
    const [saved] = await tx.update(buyersTable).set({payload:{...row.payload,qualificationTask:task,
      qualificationTaskHistory:[...history,...(b.qualificationTask?[b.qualificationTask]:[])]},version:row.version+1,updatedAt:now})
      .where(eq(buyersTable.id,id)).returning();
    if (!saved) throw new Error("Qualification request failed.");
    await queueJob(tx,"REVIEW_HANDOFFS",null,`qualification-request:${id}:${saved.version}`,actor.id);
    await queueJob(tx,"MATCH_BUYERS",null,`qualification-block:${id}:${saved.version}`,actor.id);
    await audit(tx,actor.id,"BUYER_MORE_EVIDENCE_REQUESTED",id,`${p.note}; informational qualification request only, no message sent or approval granted.`);
    return buyerRecord(saved,now);
  });
}