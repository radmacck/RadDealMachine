import { z } from "zod";

export const PHILA_LI_VIOLATIONS_SOURCE = {
  id: "phila-li-violations",
  name: "Philadelphia Licenses and Inspections Code Violations",
  coverage: "Philadelphia parcels discovered from unresolved violations dated within the last two years, then matched to an OPA property only by exact account identifier.",
  termsUrl: "https://www.opendataphilly.org/datasets/licenses-and-inspections-code-violations/",
  capabilities: ["Bounded independent parcel discovery from recent unresolved violations", "Exact OPA-identifier matching", "Violation and case record identities and dates"],
  limitations: [
    "An unresolved public record is not a current inspection, confirmed defect, repair scope, seller motivation, or proof that the property is available.",
    "Old or resolved violations are not used as current relevance signals.",
    "Records are joined only by the source's OPA account identifier; unmatched records are not guessed from nearby addresses.",
  ],
};

export const PHILA_UNSAFE_BUILDINGS_SOURCE = {
  id: "phila-li-unsafe",
  name: "Philadelphia Licenses and Inspections Unsafe Buildings",
  coverage: "Philadelphia parcels matched by OPA account identifier with an unresolved L&I unsafe-building record dated within the last two years.",
  termsUrl: "https://www.opendataphilly.org/datasets/licenses-and-inspections-code-violations/",
  capabilities: ["Unresolved unsafe-building public-record observations", "Case/violation identifiers", "Event dates"],
  limitations: [
    "The source record is a public enforcement observation, not a present-day inspection or engineering conclusion.",
    "It does not establish seller identity, availability, title authority, motivation, or repair cost.",
    "Resolved and older-than-two-year records are retained only by the source and do not contribute current qualification points.",
  ],
};

export const PHILA_VACANCY_SOURCE = {
  id: "phila-vacancy-indicators",
  name: "Philadelphia Vacant Property Indicators — Buildings",
  coverage: "Philadelphia building records that the City includes in its vacant-property indicator dataset.",
  termsUrl: "https://www.opendataphilly.org/datasets/vacant-property-indicators/",
  capabilities: ["OPA parcel indicator matching", "City-maintained indicator update date", "Source feature identity"],
  limitations: [
    "An indicator is not confirmation that a building is vacant now; occupancy must be independently checked.",
    "Only exact OPA identifier matches are attached. Address proximity is not used to infer a match.",
    "A stale or undated indicator is retained as source evidence but cannot score as current vacancy.",
  ],
};

export const PHILA_TRANSFER_SOURCE = {
  id: "phila-real-estate-transfers",
  name: "Philadelphia Real Estate Transfers",
  coverage: "Recorded Philadelphia deed-transfer activity in the last 180 days; buyer prospecting is limited to repeated corporate-style grantee names in deed records.",
  termsUrl: "https://www.opendataphilly.org/datasets/real-estate-transfers/",
  capabilities: ["Recorded grantee activity", "Transfer record identity and date", "Repeated-activity prospect discovery"],
  limitations: [
    "A grantee or repeated deed record is not proof of current buying intent, end-buyer status, identity, funding, criteria, or capacity.",
    "Transfer consideration and document classification are source-reported and are not verified as arm's-length purchases.",
    "Discovered entities remain unverified and excluded from matching until the existing owner-reviewed buyer gates pass.",
  ],
};

export const PHILA_PUBLIC_RECORD_SOURCES = [
  PHILA_LI_VIOLATIONS_SOURCE,
  PHILA_UNSAFE_BUILDINGS_SOURCE,
  PHILA_VACANCY_SOURCE,
  PHILA_TRANSFER_SOURCE,
] as const;

type PublicSignal = {
  id: string;
  key: "OPEN_CODE_VIOLATION" | "UNSAFE_BUILDING_RECORD" | "VACANCY";
  group: "CONDITION" | "DISTRESS" | "VACANCY";
  classification: "OBSERVED" | "INDICATED";
  sourceType: "PUBLIC_RECORD";
  statement: string;
  source: string;
  sourceUrl: string;
  evidenceRef: string;
  capturedAt: string;
  confidence: number;
};

export type PropertySourceRefresh = {
  sourceKey: string;
  sourceId: string;
  propertyId: string;
  sourceName: string;
  sourceUrl: string;
  capturedAt: string;
  payload: Record<string, unknown>;
  signal: PublicSignal | null;
};

type CartoViolation = {
  opa_account_num: string | null;
  parcel_id_num: string | null;
  violationnumber: string | null;
  casenumber: string | null;
  violationdate: string | null;
  violationresolutiondate: string | null;
  violationcode: string | null;
  violationcodetitle: string | null;
};

const nullableText = z.union([z.string(), z.number().transform(String), z.null()]).optional().transform(v => v ?? null);
const violationSchema = z.object({
  opa_account_num: nullableText,
  parcel_id_num: nullableText,
  violationnumber: nullableText,
  casenumber: nullableText,
  violationdate: nullableText,
  violationresolutiondate: nullableText,
  violationcode: nullableText,
  violationcodetitle: nullableText,
});

function validatePropertyIds(ids: string[]) {
  if (ids.length > 40 || ids.some(id => !/^\d{9}$/.test(id))) {
    throw new Error("Philadelphia supplemental research accepts at most 40 exact nine-digit OPA identifiers per request.");
  }
  return [...new Set(ids)].sort();
}

async function boundedJson(response: Response, maxBytes = 1_000_000) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Official City source returned no response body.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("Official City source exceeded the bounded response size.");
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

let cartoQueue: Promise<void> = Promise.resolve();
let cartoLastRequestAt = 0;
async function cartoRows(query: string, limit: number) {
  const work = cartoQueue.then(async () => {
    const wait = Math.max(0, 1_200 - (Date.now() - cartoLastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    cartoLastRequestAt = Date.now();
    const url = new URL("https://phl.carto.com/api/v2/sql");
    url.searchParams.set("q", query);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Official Philadelphia public-record API returned HTTP ${response.status}.`);
    const body = z.object({ rows: z.array(z.unknown()).max(limit) }).parse(await boundedJson(response));
    return body.rows;
  });
  cartoQueue = work.then(() => undefined, () => undefined);
  return work;
}

function parcelFor(row: CartoViolation): string | null {
  for (const value of [row.opa_account_num, row.parcel_id_num]) {
    const normalized = value?.replace(/\D/g, "");
    if (normalized && /^\d{9}$/.test(normalized)) return normalized;
  }
  return null;
}

function eventDate(value: string | null) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function violationRows(rows: unknown[], propertyIds: string[], now: Date) {
  const allowed = new Set(propertyIds);
  const byProperty = new Map<string, CartoViolation[]>();
  for (const value of rows) {
    const row = violationSchema.parse(value) as CartoViolation;
    if (row.violationresolutiondate) continue;
    const parcel = parcelFor(row);
    const date = eventDate(row.violationdate);
    if (!parcel || !allowed.has(parcel) || !date || date.getTime() > now.getTime() ||
      date.getTime() < now.getTime() - 730 * 86_400_000) continue;
    const current = byProperty.get(parcel) ?? [];
    current.push(row);
    byProperty.set(parcel, current);
  }
  return byProperty;
}

function idsFor(rows: CartoViolation[]) {
  return [...new Set(rows.map(r => r.violationnumber || r.casenumber).filter((v): v is string => !!v))]
    .sort().slice(0, 20);
}

function violationEvidence(
  propertyId: string,
  source: typeof PHILA_LI_VIOLATIONS_SOURCE | typeof PHILA_UNSAFE_BUILDINGS_SOURCE,
  rows: CartoViolation[],
  now: Date,
  key: PublicSignal["key"],
  group: PublicSignal["group"],
): PropertySourceRefresh {
  const capturedAt = now.toISOString();
  const recordIds = idsFor(rows);
  const latestDate = rows.map(r => eventDate(r.violationdate)).filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const ageDays = latestDate ? Math.max(0, (now.getTime() - latestDate.getTime()) / 86_400_000) : Infinity;
  const classification = ageDays <= 365 ? "OBSERVED" as const : "INDICATED" as const;
  const confidence = ageDays <= 365 ? 0.85 : 0.45;
  const signalId = `${source.id}:${propertyId}:unresolved`;
  const eventLabel = latestDate?.toISOString().slice(0, 10) ?? "date unavailable";
  const signal: PublicSignal | null = rows.length ? {
    id: signalId,
    key,
    group,
    classification,
    sourceType: "PUBLIC_RECORD",
    statement: `${source.name} reports ${rows.length} unresolved record${rows.length === 1 ? "" : "s"} for OPA parcel ${propertyId}; newest source event ${eventLabel}. This is a public-record observation, not a current inspection, confirmed repair scope, seller motivation, or availability.`,
    source: source.name,
    sourceUrl: source.termsUrl,
    evidenceRef: `${source.id}:${propertyId}:${recordIds.join(",") || "no-record-id"}`,
    capturedAt,
    confidence,
  } : null;
  return {
    sourceKey: `${source.id}:${propertyId}`,
    sourceId: `${source.id}:${propertyId}`,
    propertyId,
    sourceName: source.name,
    sourceUrl: source.termsUrl,
    capturedAt,
    payload: {
      state: rows.length ? "UNRESOLVED_RECORDS_REPORTED" : "NO_CURRENT_MATCH",
      recordCount: rows.length,
      recordIdentities: recordIds,
      latestSourceEventAt: latestDate?.toISOString() ?? null,
      classification: signal?.classification ?? null,
    },
    signal,
  };
}

async function searchEnforcementTable(table: "violations" | "unsafe", propertyIds: string[], now: Date) {
  if (!propertyIds.length) return new Map<string, CartoViolation[]>();
  const cutoff = new Date(now.getTime() - 730 * 86_400_000).toISOString().slice(0, 10);
  const list = propertyIds.map(id => `'${id}'`).join(",");
  const query = `SELECT opa_account_num, parcel_id_num, violationnumber, casenumber, violationdate, violationresolutiondate, violationcode, violationcodetitle
    FROM ${table}
    WHERE opa_account_num IN (${list}) AND violationresolutiondate IS NULL
      AND violationdate >= '${cutoff}' AND violationdate <= '${now.toISOString().slice(0, 10)}'
    ORDER BY violationdate DESC, opa_account_num LIMIT 1000`;
  const rows = await cartoRows(query, 1000);
  return violationRows(rows, propertyIds, now);
}

export async function refreshPhiladelphiaEnforcementEvidence(ids: string[], now = new Date()): Promise<PropertySourceRefresh[]> {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid source capture time.");
  const propertyIds = validatePropertyIds(ids);
  if (!propertyIds.length) return [];
  const violations = await searchEnforcementTable("violations", propertyIds, now);
  const unsafe = await searchEnforcementTable("unsafe", propertyIds, now);
  return propertyIds.flatMap(propertyId => {
    const unsafeRows = unsafe.get(propertyId) ?? [];
    const unsafeIds = new Set(unsafeRows.flatMap(row => [row.violationnumber, row.casenumber].filter((v): v is string => !!v)));
    const violationOnlyRows = (violations.get(propertyId) ?? []).filter(row =>
      ![row.violationnumber, row.casenumber].some(id => !!id && unsafeIds.has(id)));
    return [
      violationEvidence(propertyId, PHILA_LI_VIOLATIONS_SOURCE, violationOnlyRows, now, "OPEN_CODE_VIOLATION", "CONDITION"),
      violationEvidence(propertyId, PHILA_UNSAFE_BUILDINGS_SOURCE, unsafeRows, now, "UNSAFE_BUILDING_RECORD", "DISTRESS"),
    ];
  });
}

export async function discoverPhiladelphiaViolationParcels(now = new Date(), limit = 20): Promise<PropertySourceRefresh[]> {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid source capture time.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Philadelphia L&I discovery accepts a bounded batch of 1–20 parcels.");
  }
  const cutoff = new Date(now.getTime() - 730 * 86_400_000).toISOString().slice(0, 10);
  const query = `SELECT opa_account_num, MAX(violationdate)::text AS latest_violation
    FROM violations
    WHERE opa_account_num ~ '^[0-9]{9}$' AND violationresolutiondate IS NULL
      AND violationdate >= '${cutoff}' AND violationdate <= '${now.toISOString().slice(0, 10)}'
    GROUP BY opa_account_num
    ORDER BY latest_violation DESC, opa_account_num LIMIT ${limit}`;
  const rows = await cartoRows(query, limit);
  const parcelIds = [...new Set(rows.flatMap(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const rawId = (value as Record<string, unknown>).opa_account_num;
    const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).replace(/\D/g, "") : "";
    return /^\d{9}$/.test(id) ? [id] : [];
  }))].slice(0, limit);
  if (!parcelIds.length) return [];
  const byParcel = await searchEnforcementTable("violations", parcelIds, now);
  return parcelIds.flatMap(id => {
    const rows = byParcel.get(id) ?? [];
    return rows.length ? [violationEvidence(id, PHILA_LI_VIOLATIONS_SOURCE, rows, now, "OPEN_CODE_VIOLATION", "CONDITION")] : [];
  });
}

const arcgisRow = z.object({
  attributes: z.object({
    objectid: z.number().int().nonnegative(),
    opa_id: z.string().nullable().optional(),
    date_update: z.union([z.string(), z.number()]).nullable().optional(),
  }),
});
let arcgisQueue: Promise<void> = Promise.resolve();
let arcgisLastRequestAt = 0;
async function arcgisFeatures(ids: string[]) {
  const work = arcgisQueue.then(async () => {
    const wait = Math.max(0, 1_200 - (Date.now() - arcgisLastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    arcgisLastRequestAt = Date.now();
    const url = new URL("https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Vacant_Indicators_Bldg/FeatureServer/0/query");
    url.searchParams.set("where", `opa_id IN (${ids.map(id => `'${id}'`).join(",")})`);
    url.searchParams.set("outFields", "objectid,opa_id,date_update");
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultRecordCount", "1000");
    url.searchParams.set("f", "json");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Official Philadelphia vacancy API returned HTTP ${response.status}.`);
    const body = z.object({ features: z.array(z.unknown()).max(1000) }).parse(await boundedJson(response));
    return body.features.map(value => arcgisRow.parse(value).attributes);
  });
  arcgisQueue = work.then(() => undefined, () => undefined);
  return work;
}

function dateUpdate(value: string | number | null | undefined) {
  if (value == null) return null;
  const millis = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

export async function refreshPhiladelphiaVacancyEvidence(ids: string[], now = new Date()): Promise<PropertySourceRefresh[]> {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid source capture time.");
  const propertyIds = validatePropertyIds(ids);
  if (!propertyIds.length) return [];
  const rows = await arcgisFeatures(propertyIds);
  const allowed = new Set(propertyIds);
  const byProperty = new Map<string, ReturnType<typeof arcgisRow.parse>["attributes"]>();
  for (const row of rows) {
    const parcel = row.opa_id?.replace(/\D/g, "");
    if (parcel && allowed.has(parcel) && !byProperty.has(parcel)) byProperty.set(parcel, row);
  }
  return propertyIds.map(propertyId => {
    const row = byProperty.get(propertyId);
    const capturedAt = now.toISOString();
    const sourceUpdatedAt = dateUpdate(row?.date_update);
    const sourceAgeDays = sourceUpdatedAt ? (now.getTime() - Date.parse(sourceUpdatedAt)) / 86_400_000 : Infinity;
    const currentIndicator = !!row && sourceAgeDays >= 0 && sourceAgeDays <= 365;
    const signal: PublicSignal | null = currentIndicator ? {
      id: `${PHILA_VACANCY_SOURCE.id}:${propertyId}:indicator`,
      key: "VACANCY",
      group: "VACANCY",
      classification: "INDICATED",
      sourceType: "PUBLIC_RECORD",
      statement: `Philadelphia's Vacant Property Indicators — Buildings dataset includes OPA parcel ${propertyId}; source feature ${row!.objectid} was updated ${sourceUpdatedAt}. An indicator does not confirm current occupancy; verify in person or with the owner.`,
      source: PHILA_VACANCY_SOURCE.name,
      sourceUrl: PHILA_VACANCY_SOURCE.termsUrl,
      evidenceRef: `${PHILA_VACANCY_SOURCE.id}:${row!.objectid}:${propertyId}`,
      capturedAt,
      confidence: 0.65,
    } : null;
    return {
      sourceKey: `${PHILA_VACANCY_SOURCE.id}:${propertyId}`,
      sourceId: row ? `${PHILA_VACANCY_SOURCE.id}:${row.objectid}` : `${PHILA_VACANCY_SOURCE.id}:${propertyId}`,
      propertyId,
      sourceName: PHILA_VACANCY_SOURCE.name,
      sourceUrl: PHILA_VACANCY_SOURCE.termsUrl,
      capturedAt,
      payload: {
        state: !row ? "NO_CURRENT_MATCH" : currentIndicator ? "INDICATOR_CURRENT" : "INDICATOR_STALE_OR_UNDATED",
        recordIdentities: row ? [String(row.objectid)] : [],
        sourceUpdatedAt,
        sourceAgeDays: Number.isFinite(sourceAgeDays) ? Math.floor(sourceAgeDays) : null,
        classification: signal?.classification ?? null,
      },
      signal,
    };
  });
}

export type RepeatedTransferBuyer = {
  name: string;
  activityCount: number;
  latestActivityAt: string;
  recordIdentities: string[];
  source: string;
  sourceUrl: string;
  capturedAt: string;
  confidence: number;
};

const transferRow = z.object({
  grantees: z.string().min(2).max(250),
  transaction_count: z.preprocess(value => Number(value), z.number().int().min(2)),
  latest_activity: z.string().min(4),
  record_ids: z.array(z.union([z.string(), z.number().transform(String)])).min(2).max(5),
});

export function normalizeCorporateGrantee(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length > 200 || /[;|&]/.test(name) || /\bAND\b/i.test(name)) return null;
  if (!/(?:\bLLC\b|\bL\.L\.C\.?\b|\bINC\.?\b|\bCORP(?:ORATION)?\.?\b|\bLTD\.?\b|\bLP\b)$/i.test(name)) return null;
  return name;
}

export async function searchRepeatedRecordedBuyers(now = new Date()): Promise<RepeatedTransferBuyer[]> {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid source capture time.");
  const cutoff = new Date(now.getTime() - 180 * 86_400_000).toISOString().slice(0, 10);
  const query = `SELECT grantees, COUNT(DISTINCT record_id) AS transaction_count, MAX(display_date)::text AS latest_activity,
      (ARRAY_AGG(DISTINCT record_id))[1:5] AS record_ids
    FROM RTT_SUMMARY
    WHERE display_date >= '${cutoff}' AND display_date <= '${now.toISOString().slice(0, 10)}'
      AND total_consideration > 0
      AND document_type IN ('DEED','MISCELLANEOUS DEED','SHERIFF''S DEED','DEED LAND BANK')
      AND grantees ~* '(LLC|L\\.L\\.C\\.?|INC\\.?|CORP|LTD\\.?|LP)$'
    GROUP BY grantees
    HAVING COUNT(DISTINCT record_id) >= 2
    ORDER BY latest_activity DESC, transaction_count DESC LIMIT 100`;
  const rows = await cartoRows(query, 100);
  const capturedAt = now.toISOString();
  const sourceUrl = PHILA_TRANSFER_SOURCE.termsUrl;
  return rows.flatMap(value => {
    const row = transferRow.safeParse(value);
    if (!row.success) return [];
    const name = normalizeCorporateGrantee(row.data.grantees);
    const activityAt = Date.parse(row.data.latest_activity);
    if (!name || !Number.isFinite(activityAt) || activityAt > now.getTime() ||
      activityAt < now.getTime() - 180 * 86_400_000) return [];
    return [{
      name,
      activityCount: row.data.transaction_count,
      latestActivityAt: new Date(activityAt).toISOString(),
      recordIdentities: [...new Set(row.data.record_ids.map(id => id.trim()).filter(Boolean))].slice(0, 5),
      source: `${PHILA_TRANSFER_SOURCE.name} reports ${row.data.transaction_count} recorded deed transfers for this grantee in the last 180 days; the latest source date is ${new Date(activityAt).toISOString().slice(0, 10)}. This is historical activity, not verified current intent, identity, funding, or buyer capacity.`,
      sourceUrl,
      capturedAt,
      confidence: 0.7,
    }];
  });
}
