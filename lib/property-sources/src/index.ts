import { z } from "zod";
export { ConnectorRegistry } from "./connector-registry";
export {
  PHILA_LI_VIOLATIONS_SOURCE,
  PHILA_PUBLIC_RECORD_SOURCES,
  PHILA_TRANSFER_SOURCE,
  PHILA_UNSAFE_BUILDINGS_SOURCE,
  PHILA_VACANCY_SOURCE,
  discoverPhiladelphiaViolationParcels,
  normalizeCorporateGrantee,
  refreshPhiladelphiaEnforcementEvidence,
  refreshPhiladelphiaVacancyEvidence,
  searchRepeatedRecordedBuyers,
  type PropertySourceRefresh,
  type RepeatedTransferBuyer,
} from "./phila-public-records";

export const PHILA_SOURCE = {
  id: "phila-opa",
  name: "Philadelphia Office of Property Assessment",
  coverage: "Philadelphia, PA only; single-family tax-record properties, including row houses.",
  termsUrl: "https://opendataphilly.org/datasets/philadelphia-properties-and-assessment-history",
  capabilities: ["Property characteristics", "Tax-roll owner name", "Tax-roll owner mailing address", "Assessed value", "Reported latest sale", "Nearby sale candidates", "Corporate-owner research candidates"],
  limitations: [
    "Tax records are not listings. Seller identity, availability, contact permission and asking price are unknown.",
    "A tax-roll mailing address is an observed public-record postal route, not proof of current ownership, delivery, consent, or permission for phone/email contact.",
    "This adapter does not return owner phone numbers or email addresses.",
    "Recorded tax owner is not title clearance or proof of signing authority.",
    "Assessment is not ARV. A reported sale is not verified as arm's-length or renovated.",
    "Condition codes are raw assessment codes, not a current inspection or repair estimate.",
    "Corporate-owner candidates are not verified buyers and purchasing intent/funding are unknown.",
    "The City's real-estate-tax-balance dataset is aggregated by geography, not parcel; no individual tax-delinquency signal is inferred. No lien, foreclosure, listing history, photo, equity or nationwide coverage is asserted.",
    "The City supplies data as-is; nightly publication does not guarantee every record is current.",
  ],
};

const nullableNumber = z.number().finite().nonnegative().nullable();
const optionalNullableText = z.string().max(500).nullable().optional();
const rawSchema = z.object({
  parcel_number: z.string().regex(/^\d{9}$/),
  location: z.string().min(3).max(250),
  category_code_description: z.string(),
  building_code_description: z.string().nullable(),
  total_livable_area: nullableNumber,
  number_of_bedrooms: z.number().int().min(0).max(100).nullable(),
  number_of_bathrooms: z.number().min(0).max(100).nullable(),
  zip_code: z.string().regex(/^191\d{2}/),
  owner_1: z.string().max(500).nullable(),
  owner_2: optionalNullableText,
  mailing_address_1: optionalNullableText,
  mailing_address_2: optionalNullableText,
  mailing_care_of: optionalNullableText,
  mailing_city_state: optionalNullableText,
  mailing_street: optionalNullableText,
  mailing_zip: z.string().max(30).nullable().optional(),
  market_value: nullableNumber,
  sale_price: nullableNumber,
  sale_date: z.string().datetime({offset:true}).nullable(),
  interior_condition: z.string().nullable(),
  exterior_condition: z.string().nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
});

export type PropertyContactPath = {
  id: string;
  channel: "POSTAL" | "PHONE" | "EMAIL" | "WEB" | "OTHER";
  recipient: string | null;
  routeValue?: string | null;
  addressLines?: string[];
  cityState?: string | null;
  postalCode: string | null;
  classification: "OBSERVED" | "VERIFIED";
  confidence: number;
  sourceId: string;
  sourceName: string;
  sourceRecordId: string;
  sourceUrl: string;
  capturedAt: string;
  freshUntilAt: string;
  freshnessStatus: "CURRENT" | "STALE";
  permissionStatus: "NOT_REVIEWED" | "PERMITTED" | "PROHIBITED";
};

/** Sorts connector-supplied paths without converting public availability into contact permission. */
export function rankContactPaths(paths: PropertyContactPath[], now = new Date()) {
  const normalize = (value: string) => value.normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  const routeKey = (path: PropertyContactPath) => {
    if (path.channel === "POSTAL") {
      return [path.channel, normalize(path.recipient ?? ""), ...(path.addressLines ?? []).map(normalize),
        normalize(path.cityState ?? ""), normalize(path.postalCode ?? "")].join("|");
    }
    const value = path.routeValue?.trim() ?? "";
    if (path.channel === "PHONE") return `${path.channel}|${value.replace(/\D/g, "")}`;
    if (path.channel === "EMAIL") return `${path.channel}|${value.toLocaleLowerCase("en-US")}`;
    if (path.channel === "WEB") {
      try {
        const url = new URL(value);
        return `${path.channel}|${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
      } catch {
        return `${path.channel}|invalid|${path.id}`;
      }
    }
    return `${path.channel}|${normalize(value)}`;
  };
  const freshness = (path: PropertyContactPath) =>
    Number.isFinite(Date.parse(path.freshUntilAt)) && Date.parse(path.freshUntilAt) > now.getTime();
  const permissionRank = (status: PropertyContactPath["permissionStatus"]) =>
    status === "PERMITTED" ? 2 : status === "NOT_REVIEWED" ? 1 : 0;
  const better = (a: PropertyContactPath, b: PropertyContactPath) => {
    const permission = permissionRank(a.permissionStatus) - permissionRank(b.permissionStatus);
    if (permission) return permission;
    const current = Number(freshness(a)) - Number(freshness(b));
    if (current) return current;
    const verified = Number(a.classification === "VERIFIED") - Number(b.classification === "VERIFIED");
    if (verified) return verified;
    if (a.confidence !== b.confidence) return a.confidence - b.confidence;
    const captured = Date.parse(a.capturedAt) - Date.parse(b.capturedAt);
    if (Number.isFinite(captured) && captured) return captured;
    return b.id.localeCompare(a.id);
  };
  const unique = new Map<string, PropertyContactPath>();
  for (const path of paths) {
    if (path.channel !== "POSTAL" && !path.routeValue?.trim()) continue;
    if (path.channel === "POSTAL" && (!(path.addressLines?.length) || !path.cityState?.trim())) continue;
    const key = routeKey(path);
    const prior = unique.get(key);
    if (!prior || better(path, prior) > 0) unique.set(key, path);
  }
  return [...unique.values()].map(path => ({
    ...path,
    freshnessStatus: freshness(path) ? "CURRENT" as const : "STALE" as const,
  })).sort((a, b) => {
    const permitted = permissionRank(b.permissionStatus) - permissionRank(a.permissionStatus);
    const fresh = Number(b.freshnessStatus === "CURRENT") - Number(a.freshnessStatus === "CURRENT");
    const verified = Number(b.classification === "VERIFIED") - Number(a.classification === "VERIFIED");
    return permitted || fresh || verified || b.confidence - a.confidence ||
      Date.parse(b.capturedAt) - Date.parse(a.capturedAt) || a.id.localeCompare(b.id);
  });
}

export function normalizeProperty(value: unknown, now: Date) {
  const r = rawSchema.parse(value);
  if (r.category_code_description.trim().toUpperCase() !== "SINGLE FAMILY") throw new Error("Source property type is not supported by this adapter.");
  if (r.sale_date && !Number.isFinite(Date.parse(r.sale_date))) throw new Error("Source sale date is invalid.");
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid capture time.");
  const sourceUrl = `https://property.phila.gov/?p=${r.parcel_number}`;
  const ownerNames = [r.owner_1, r.owner_2].map(owner => owner?.trim()).filter((owner): owner is string => !!owner);
  const addressLines = [
    r.mailing_care_of?.trim(),
    r.mailing_address_1?.trim(),
    r.mailing_address_2?.trim() || r.mailing_street?.trim(),
  ].filter((line): line is string => !!line);
  const uniqueAddressLines = addressLines.filter((line, index) =>
    addressLines.findIndex(candidate => candidate.toUpperCase() === line.toUpperCase()) === index);
  const cityState = r.mailing_city_state?.trim() ?? "";
  const contactPaths: PropertyContactPath[] = ownerNames.length && uniqueAddressLines.length && cityState
    ? rankContactPaths([{
      id: `phila-opa:${r.parcel_number}:owner-mailing`,
      channel: "POSTAL",
      recipient: ownerNames.join(" / "),
      addressLines: uniqueAddressLines,
      cityState,
      postalCode: r.mailing_zip?.trim() || null,
      classification: "OBSERVED",
      confidence: 0.7,
      sourceId: PHILA_SOURCE.id,
      sourceName: PHILA_SOURCE.name,
      sourceRecordId: r.parcel_number,
      sourceUrl,
      capturedAt: now.toISOString(),
      freshUntilAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      freshnessStatus: "CURRENT",
      permissionStatus: "NOT_REVIEWED",
    }], now)
    : [];
  return {
    id: r.parcel_number, parcelId: r.parcel_number, provider: PHILA_SOURCE.id, classification: "OBSERVED" as const, address: r.location.trim(),
    city: "Philadelphia", county: "Philadelphia", state: "PA", zip: r.zip_code.slice(0,5),
    propertyType: /^ROW\b/i.test(r.building_code_description ?? "") ? "TOWNHOUSE" as const : "SINGLE_FAMILY" as const,
    sqft: r.total_livable_area, beds: r.number_of_bedrooms, baths: r.number_of_bathrooms,
    recordedOwner: r.owner_1?.trim() || null,
    entityCandidate: /\b(?:LLC|L\.?L\.?C\.?|INC|CORP|LTD|LP)\b/i.test(r.owner_1 ?? ""),
    assessedValue: r.market_value, lastSalePrice: r.sale_price,
    lastSaleAt: r.sale_date?.slice(0,10) ?? null,
    interiorCondition: r.interior_condition, exteriorCondition: r.exterior_condition,
    lat: r.lat, lng: r.lng,
    contactPaths,
    sourceUrl,
    capturedAt: now.toISOString(),
  };
}
export type PublicProperty = ReturnType<typeof normalizeProperty>;
export function distanceMiles(a: PublicProperty, b: PublicProperty) {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return null;
  const radians = (n: number) => n * Math.PI / 180;
  const h = Math.sin(radians(b.lat-a.lat)/2)**2 +
    Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(radians(b.lng-a.lng)/2)**2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1,h)));
}
export function candidateSales(subject: PublicProperty, records: PublicProperty[], options: {
  radius: number; ageDays: number; sizeTolerance: number;
}, now: Date) {
  const seen = new Set<string>();
  return records.flatMap(record => {
    const distance = distanceMiles(subject,record);
    const age = record.lastSaleAt ? (now.getTime()-Date.parse(`${record.lastSaleAt}T00:00:00Z`))/86400000 : Infinity;
    if (seen.has(record.id) || record.id === subject.id) return [];
    seen.add(record.id);
    if (distance === null || distance > options.radius || age < 0 || age > options.ageDays ||
      record.propertyType !== subject.propertyType || !subject.sqft || !record.sqft ||
      Math.abs(record.sqft-subject.sqft)/subject.sqft > options.sizeTolerance ||
      !record.lastSalePrice || !record.lastSaleAt ||
      (subject.beds !== null && record.beds !== null && Math.abs(record.beds-subject.beds)>1) ||
      (subject.baths !== null && record.baths !== null && Math.abs(record.baths-subject.baths)>1)) return [];
    return [{
      record,
      comp: { id:`phila-opa:${record.id}`, address:record.address, salePrice:record.lastSalePrice,
        sqft:record.sqft, soldAt:record.lastSaleAt, distanceMiles:distance,
        propertyType:record.propertyType, condition:"UNKNOWN" as const, source:record.sourceUrl, verified:false },
      reasons: [
        `Same record property type; ${distance.toFixed(2)} miles; reported sale ${Math.floor(age)} days ago; within configured size tolerance.`,
        "Review transfer and arm's-length status. Renovation/condition is unverified; this candidate cannot support ARV yet.",
        ...(record.beds === null || record.baths === null ? ["Beds or baths are missing; verify before relying on the match."] : []),
      ],
    }];
  }).sort((a,b) => a.comp.distanceMiles-b.comp.distanceMiles).slice(0,30);
}

const fields = "parcel_number, location, category_code_description, building_code_description, total_livable_area, number_of_bedrooms, number_of_bathrooms, zip_code, owner_1, market_value, sale_price, sale_date, interior_condition, exterior_condition, ST_Y(the_geom) AS lat, ST_X(the_geom) AS lng";
let busy = false;
let lastRequestAt = 0;
async function query(where: string, now: Date, order = "sale_date DESC NULLS LAST, parcel_number") {
  if (busy) throw new Error("Public source is busy; retry shortly. No success was recorded.");
  busy = true;
  try {
    const wait = Math.max(0,1500-(Date.now()-lastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve,wait));
    lastRequestAt = Date.now();
    const url = new URL("https://phl.carto.com/api/v2/sql");
    url.searchParams.set("q", `SELECT ${fields} FROM opa_properties_public WHERE category_code='1' AND (${where}) ORDER BY ${order} LIMIT 40`);
    const response = await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Accept:"application/json"},redirect:"error"});
    if (!response.ok) throw new Error(`Official property API returned HTTP ${response.status}.`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Official property API returned no body.");
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 384000) { await reader.cancel(); throw new Error("Official source response exceeded the bounded size."); }
      chunks.push(part.value);
    }
    const body = z.object({rows:z.array(z.unknown()).max(40)}).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return body.rows.map(row => normalizeProperty(row,now));
  } finally { busy = false; }
}
export async function searchProperties(zip: string | undefined, lane: string, now = new Date()) {
  if (zip && !/^191\d{2}$/.test(zip)) throw new Error("This adapter supports Philadelphia ZIP codes only.");
  if (!["properties","buyer_candidates"].includes(lane)) throw new Error("Unknown source discovery lane.");
  const clauses = ["total_livable_area>0"];
  if (zip) clauses.push(`zip_code LIKE '${zip}%'`);
  if (lane === "buyer_candidates") {
    const from = new Date(now.getTime()-180*86400000).toISOString().slice(0,10);
    clauses.push(`sale_price>10000 AND sale_date>='${from}' AND sale_date<='${now.toISOString().slice(0,10)}'`);
    clauses.push("(owner_1 ~* '(LLC|L\\.L\\.C|INC|CORP|LTD| LP)$')");
  }
  return (await query(clauses.join(" AND "),now)).filter(r => lane !== "buyer_candidates" || r.entityCandidate).slice(0,20);
}
export async function propertyById(id: string, now = new Date()) {
  if (!/^\d{9}$/.test(id)) throw new Error("Invalid official parcel identifier.");
  const rows = await query(`parcel_number='${id}'`,now);
  if (rows.length!==1) throw new Error(`Official parcel lookup returned ${rows.length} records; a unique subject was not established.`);
  return rows[0]!;
}
export async function propertiesByIds(ids: string[], now = new Date()) {
  if (ids.length > 40 || ids.some(id => !/^\d{9}$/.test(id))) throw new Error("Batch property lookup accepts at most 40 exact nine-digit parcel identifiers.");
  const parcelIds = [...new Set(ids)].sort();
  if (!parcelIds.length) return [];
  return query(`parcel_number IN (${parcelIds.map(id => `'${id}'`).join(",")})`, now);
}
export async function propertyByAddress(address: string, now = new Date()) {
  const key = address.toUpperCase().replace(/[^A-Z0-9]/g,"");
  if (key.length<3 || key.length>250) throw new Error("Invalid subject address.");
  const rows = await query(`regexp_replace(upper(location),'[^A-Z0-9]','','g')='${key}'`,now);
  if (rows.length!==1) throw new Error(`Official address lookup returned ${rows.length} records; resolve the parcel identity before importing facts.`);
  return rows[0]!;
}
export async function nearbySales(subject: PublicProperty, options: {radius:number;ageDays:number;sizeTolerance:number}, now = new Date()) {
  if (subject.lat===null || subject.lng===null) throw new Error("Official subject coordinates are missing; nearby sales cannot be asserted.");
  if (![options.radius,options.ageDays,options.sizeTolerance].every(Number.isFinite) || options.radius<=0 || options.ageDays<1 || options.sizeTolerance<0) throw new Error("Invalid source matching configuration.");
  const radius = Math.min(options.radius,5);
  const from = new Date(now.getTime()-options.ageDays*86400000).toISOString().slice(0,10);
  const rows = await query(`sale_price>10000 AND sale_date>='${from}' AND sale_date<='${now.toISOString().slice(0,10)}' AND
    ST_DWithin(the_geom::geography,ST_SetSRID(ST_MakePoint(${subject.lng},${subject.lat}),4326)::geography,${radius*1609.344})`,
    now,`ST_Distance(the_geom::geography,ST_SetSRID(ST_MakePoint(${subject.lng},${subject.lat}),4326)::geography), parcel_number`);
  return candidateSales(subject,rows,{...options,radius},now);
}