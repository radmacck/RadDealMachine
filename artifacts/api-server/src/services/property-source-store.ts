import { and, desc, eq, sql } from "drizzle-orm";
import { db, intelligenceTable, jobsTable, leadsTable } from "@workspace/db";
import { assertOperationsRole, DomainError, validateProvenance, type OfferActor, type IntelligenceInput, type Lead } from "@workspace/deal-domain";
import { GetSourceResearchResponse, RefreshSourceResearchResponse, ImportPublicPropertyResponse, AddSourceCompsBody } from "@workspace/api-zod";
import {
  PHILA_SOURCE, propertyById, propertyByAddress,
  type PublicProperty,
} from "@workspace/property-sources";
import { audit, getAssumptions, leadDetail, lockedLead, saveUnderwriting } from "./deal-store";
import { allPropertySourceConnectors, getPropertySourceConnector, listPropertySourceDescriptors, PROPERTY_SOURCE_POLICY_VERSION } from "./property-source-connectors";
import { NOT_CONNECTED_PROPERTY_SOURCE_CAPABILITIES } from "./property-source-availability";
import { sanitizeOperationalError } from "./operational-error-sanitizer";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Research = ReturnType<typeof RefreshSourceResearchResponse.parse>;
const normalizeAddress = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g,"");
function assertSubject(research: Research, lead: Pick<Lead,"address"|"city"|"state"|"zip">) {
  if (normalizeAddress(research.subject.address)!==normalizeAddress(lead.address) ||
    research.subject.zip!==lead.zip.slice(0,5) || lead.state!=="PA" || lead.city.toLowerCase()!=="philadelphia") {
    throw new DomainError("Saved source research belongs to a different subject identity. Resolve the parcel/address conflict before reusing records or transferring comparables.",409);
  }
}
function requireReview(actor: OfferActor, termsReviewed: boolean) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  if (!termsReviewed) throw new DomainError("Review the source license and limitations before importing or refreshing records.",400);
}
async function sourceRequest<T>(action: () => Promise<T>) {
  try { return await action(); }
  catch (error) {
    const message = sanitizeOperationalError(error, "Property source request failed.");
    throw new DomainError(`Official property source: ${message}. No source success was recorded.`,409);
  }
}
export function listPropertySources() { return listPropertySourceDescriptors(); }
export async function getPropertySourceCoverage(now = new Date()) {
  const jobs = await db.select().from(jobsTable)
    .where(eq(jobsTable.kind, "DISCOVER_PROPERTIES"))
    .orderBy(desc(jobsTable.createdAt)).limit(100);
  const latestPolicy = jobs.find(job => job.payload.termsReviewed === true);
  const currentPolicyJobs = jobs.filter(job => job.payload.termsReviewed === true &&
    job.payload.sourcePolicyVersion === PROPERTY_SOURCE_POLICY_VERSION);
  const nextSixHourBoundary = new Date((Math.floor(now.getTime() / 21_600_000) + 1) * 21_600_000);
  const operations = listPropertySourceDescriptors().map(source => {
    const connector = allPropertySourceConnectors().find(item => item.sources.some(candidate => candidate.id === source.id));
    const enabled = !!connector && [connector.searchProperties, connector.discoverProperties, connector.refreshEvidence,
      connector.propertyById, connector.propertiesByIds, connector.nearbySales].some(Boolean);
    const connectorId = connector?.id;
    const attempt = connectorId ? currentPolicyJobs.find(job =>
      job.message.includes(`${connectorId}:`) || job.message.includes(`${connectorId}/`)) : undefined;
    const success = connectorId ? currentPolicyJobs.find(job =>
      job.message.includes(`${connectorId}:`) && !job.message.includes(`${connectorId}/`) &&
      ["SUCCEEDED", "PARTIAL"].includes(job.state)) : undefined;
    const errorMatch = attempt?.message.match(new RegExp(`${connectorId}/(?:DISCOVER|REFRESH):\\s*([^.|]+)`));
    const error = errorMatch?.[1]?.trim() || (attempt?.state === "FAILED" ? attempt.message : null);
    const rateLimited = !!error && /429|rate.?limit|too many requests/i.test(error);
    const summaryMatch = connectorId ? attempt?.message.match(new RegExp(`${connectorId}: (\\d+) property record\\(s\\), (\\d+) unmatched observation\\(s\\)`)) : null;
    const resultCount = summaryMatch ? Number(summaryMatch[1]) + Number(summaryMatch[2]) : null;
    const age = success ? now.getTime() - success.updatedAt.getTime() : null;
    const recurring = latestPolicy?.payload.sourcePolicyVersion === PROPERTY_SOURCE_POLICY_VERSION &&
      latestPolicy.payload.recurringPropertyDiscovery === true;
    const freshness = age == null ? "NEVER_RUN" : age <= 6 * 60 * 60_000 ? "CURRENT" : "STALE";
    let state: string = !enabled ? "UNCONFIGURED" : !attempt ? "ENABLED_NOT_RUN" :
      rateLimited ? "RATE_LIMITED" : error ? "FAILED" :
      attempt.state === "PARTIAL" ? "PARTIAL" : success ? (freshness === "STALE" ? "STALE" : "SUCCEEDED") :
      "ENABLED_NOT_RUN";
    if (latestPolicy && latestPolicy.payload.sourcePolicyVersion !== PROPERTY_SOURCE_POLICY_VERSION && !currentPolicyJobs.length) {
      state = enabled ? "ENABLED_NOT_RUN" : "UNCONFIGURED";
    }
    const manualNextStep = !enabled
      ? "No permitted adapter is registered. Review intended-use terms and access permissions, then register a compliant adapter; do not scrape or infer coverage."
      : latestPolicy && latestPolicy.payload.sourcePolicyVersion !== PROPERTY_SOURCE_POLICY_VERSION
        ? "Review the current source terms and queue a new property discovery job; prior consent does not extend to changed source coverage."
        : rateLimited
          ? "Wait for the provider's permitted retry window, review its current rate limits, then queue a new terms-reviewed job."
          : error
            ? "Open Worker activity, inspect the source-specific error, confirm terms and rate limits, then retry only the permitted source."
            : !success
              ? "Review the linked terms and queue a property discovery job. Until execution evidence appears here, no source refresh is claimed."
              : "Review the persisted raw observations and their provenance; qualifying a discovery remains a separate human-reviewed step.";
    return {
      id: source.id, name: source.name, enabled,
      state: state as "ENABLED_NOT_RUN" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "RATE_LIMITED" | "STALE" | "UNCONFIGURED",
      termsStatus: !latestPolicy ? "REVIEW_REQUIRED" :
        latestPolicy.payload.sourcePolicyVersion === PROPERTY_SOURCE_POLICY_VERSION ? "REVIEWED_AT_QUEUE" : "OUTDATED",
      termsUrl: source.termsUrl,
      lastAttemptAt: attempt?.updatedAt.toISOString() ?? null,
      lastSuccessfulAt: success?.updatedAt.toISOString() ?? null,
      resultCount,
      resultCountBasis: resultCount == null
        ? "No source-specific result count is available; absence is not a zero-result check."
        : "Connector batch count (matched property records plus unmatched observations); not qualified leads.",
      freshness,
      error: error ? error.slice(0, 300) : null,
      rateLimit: connector?.maxRefreshBatchSize
        ? `Adapter batch cap: ${connector.maxRefreshBatchSize}. Provider request quota is not encoded; follow linked source terms.`
        : "Provider request quota is not encoded; follow linked source terms and adapter pagination limits.",
      nextEligibleAt: recurring ? nextSixHourBoundary.toISOString() : null,
      manualNextStep,
    };
  });
  return {
    registeredSources: listPropertySourceDescriptors(),
    notConnectedProviders: NOT_CONNECTED_PROPERTY_SOURCE_CAPABILITIES,
    operations,
  };
}
export async function searchPublicProperties(zip?: string, lane = "properties", now = new Date()) {
  const connector = getPropertySourceConnector(PHILA_SOURCE.id);
  if (!connector?.searchProperties) throw new DomainError("The Philadelphia OPA search adapter is not registered.", 503);
  return {source:PHILA_SOURCE,records:await sourceRequest(()=>connector.searchProperties!(zip,lane,now)),capturedAt:now.toISOString()};
}
export async function collectPublicSourceResearch(subject: PublicProperty, now: Date): Promise<Research> {
  const assumptions = await getAssumptions();
  const connector = getPropertySourceConnector(PHILA_SOURCE.id);
  if (!connector?.nearbySales) throw new DomainError("The Philadelphia OPA comp adapter is not registered.", 503);
  const candidates = await sourceRequest(()=>connector.nearbySales!(subject,{
    radius:assumptions.maxDistanceMiles,ageDays:assumptions.maxCompAgeDays,sizeTolerance:assumptions.maxSqftDifferencePct,
  },now));
  return RefreshSourceResearchResponse.parse({
    source:PHILA_SOURCE,subject,candidates,capturedAt:now.toISOString(),
    limitations:[...PHILA_SOURCE.limitations,"Candidate lookup is bounded to the nearest 40 source records and at most five miles; it is not an exhaustive comp search."],
  });
}
async function savedResearch(id: string, database: typeof db | Tx = db): Promise<Research | null> {
  const [row] = await database.select().from(intelligenceTable)
    .where(and(eq(intelligenceTable.leadId,id),sql`${intelligenceTable.payload}->>'category' = 'source_property_snapshot'`))
    .orderBy(desc(intelligenceTable.createdAt)).limit(1);
  return row ? RefreshSourceResearchResponse.parse(row.payload.sourceResearch) : null;
}
export async function getSourceResearch(id: string) {
  const detail = await leadDetail(id);
  const research = await savedResearch(id);
  if (research) assertSubject(research,detail.lead);
  return GetSourceResearchResponse.parse({research});
}
export async function persistPublicSourceResearch(tx: Tx, id: string, research: Research, actor: string, now: Date) {
  const s = research.subject;
  const entries: IntelligenceInput[] = [{
    classification:"OBSERVED",category:"source_property_snapshot",sourceType:"PUBLIC_RECORD",
    statement:`Official OPA parcel ${s.id} reports ${s.address}; living area ${s.sqft??"unknown"} sqft, bedrooms ${s.beds??"unknown"}, bathrooms ${s.baths??"unknown"}. These are tax-record observations, not an inspection or verified legal use.`,
    source:PHILA_SOURCE.name,sourceUrl:s.sourceUrl,confidence:0.55,capturedAt:research.capturedAt,
    question:"Does this parcel match the subject and do the reported characteristics match current condition?",
    action:"Check parcel identity and current condition before relying on the record.",
  },{
    classification:"OBSERVED",category:"tax_roll_and_reported_sale",sourceType:"PUBLIC_RECORD",
    statement:`OPA record lists tax-roll owner "${s.recordedOwner??"not provided"}", assessed value ${s.assessedValue??"not provided"}, last reported sale ${s.lastSaleAt??"unknown"} for ${s.lastSalePrice??"unknown"}. Assessment is NOT ARV; prior sale is NOT asking price; tax owner is NOT verified seller/title authority.`,
    source:PHILA_SOURCE.name,sourceUrl:s.sourceUrl,confidence:0.55,capturedAt:research.capturedAt,
    question:"Who is authorized to sell, is the property available, and what is the current seller expectation?",
    action:"Verify actual seller, title/signing authority and contact permission separately.",
  }];
  for (const [index,entry] of entries.entries()) {
    validateProvenance(entry,now);
    await tx.insert(intelligenceTable).values({leadId:id,createdBy:actor,createdAt:now,
      payload:{...entry,...(index===0?{sourceResearch:research}:{})}});
  }
  await audit(tx,actor,"PUBLIC_SOURCE_RESEARCH_SAVED",id,
    `${research.candidates.length} reported sale candidates; OBSERVED only. No verified renovation, repaired condition, seller price, title authority or buyer approval inferred.`);
}
export async function importPublicProperty(recordId: string, termsReviewed: boolean, actor: OfferActor, now = new Date()) {
  requireReview(actor,termsReviewed);
  void recordId;
  void now;
  throw new DomainError("Direct property-to-lead import is disabled. Record the source observation, review relevance evidence, and promote only after the market qualification gate passes.",409);
}
export async function refreshSourceResearch(id: string, version: number, termsReviewed: boolean, actor: OfferActor, now = new Date()) {
  requireReview(actor,termsReviewed);
  const detail = await leadDetail(id);
  if (detail.lead.state!=="PA" || detail.lead.city.toLowerCase()!=="philadelphia") throw new DomainError("No permitted property adapter is installed for this subject's jurisdiction. Census geography is not parcel research.",409);
  if (["CLOSED","DEAD_DEAL"].includes(detail.lead.stage)) throw new DomainError("Terminal deals are read-only.",409);
  if (detail.lead.version!==version) throw new DomainError("This lead changed; reload before refreshing source research.",409);
  const [row] = await db.select().from(leadsTable).where(eq(leadsTable.id,id));
  const key = String(row!.payload.sourceKey??"");
  const subject = await sourceRequest(()=> /^phila-opa:\d{9}$/.test(key) ? propertyById(key.slice(10),now) : propertyByAddress(detail.lead.address,now));
  if (normalizeAddress(subject.address)!==normalizeAddress(detail.lead.address) || subject.zip!==detail.lead.zip.slice(0,5)) throw new DomainError("Source parcel conflicts with the subject address. No facts were attached.",409);
  const research = await collectPublicSourceResearch(subject,now);
  await db.transaction(async tx=>{
    const lead = await lockedLead(tx,id,version);
    await persistPublicSourceResearch(tx,id,research,actor.id,now);
    await tx.update(leadsTable).set({payload:{...lead.payload,sourceKey:`phila-opa:${subject.id}`},version:lead.version+1,updatedAt:now}).where(eq(leadsTable.id,id));
  });
  return research;
}
export async function addSourceComps(id: string, input: ReturnType<typeof AddSourceCompsBody.parse>, actor: OfferActor, now = new Date()) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  const parsed = AddSourceCompsBody.parse(input);
  const [detail,research] = await Promise.all([leadDetail(id),savedResearch(id)]);
  if (!research || now.getTime()-Date.parse(research.capturedAt)>7*86400000 || Date.parse(research.capturedAt)>now.getTime()+60000) throw new DomainError("Collect current permitted source research before transferring candidates.",409);
  assertSubject(research,detail.lead);
  const chosen = [...new Set(parsed.recordIds)].map(recordId=>{
    const candidate = research.candidates.find(c=>c.record.id===recordId);
    if (!candidate) throw new DomainError("Selected comparable was not supplied by the persisted source research.",409);
    return {...candidate.comp,verified:false,condition:"UNKNOWN" as const};
  });
  const old = detail.underwriting;
  const seen = new Set((old?.comps??[]).map(c=>c.id));
  const append = chosen.filter(c=>!seen.has(c.id));
  if (!append.length) {
    if (detail.lead.version!==parsed.version) throw new DomainError("This lead changed; reload before saving.",409);
    return detail;
  }
  // Reuse the existing snapshot, deterministic engine and reapproval boundaries.
  return saveUnderwriting(id,{
    ...old,version:parsed.version,comps:[...(old?.comps??[]),...append],repairs:old?.repairs??[],
    repairsComplete:old?.repairsComplete??false,conditionConfirmed:old?.conditionConfirmed??false,
  },actor.id,now);
}