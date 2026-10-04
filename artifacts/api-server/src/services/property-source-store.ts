import { and, desc, eq, sql } from "drizzle-orm";
import { db, intelligenceTable, leadsTable } from "@workspace/db";
import { assertOperationsRole, DomainError, validateProvenance, type OfferActor, type IntelligenceInput, type Lead } from "@workspace/deal-domain";
import { GetSourceResearchResponse, RefreshSourceResearchResponse, ImportPublicPropertyResponse, AddSourceCompsBody } from "@workspace/api-zod";
import { PHILA_SOURCE, searchProperties, propertyById, propertyByAddress, nearbySales, type PublicProperty } from "@workspace/property-sources";
import { audit, createLead, getAssumptions, leadDetail, lockedLead, move, saveUnderwriting } from "./deal-store";

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
    const message = error instanceof Error ? error.message : "Unknown source failure";
    throw new DomainError(`Official property source: ${message}. No source success was recorded.`,409);
  }
}
export function listPropertySources() { return [PHILA_SOURCE]; }
export async function searchPublicProperties(zip?: string, lane = "properties", now = new Date()) {
  return {source:PHILA_SOURCE,records:await sourceRequest(()=>searchProperties(zip,lane,now)),capturedAt:now.toISOString()};
}
async function collect(subject: PublicProperty, now: Date): Promise<Research> {
  const assumptions = await getAssumptions();
  const candidates = await sourceRequest(()=>nearbySales(subject,{
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
async function persistResearch(tx: Tx, id: string, research: Research, actor: string, now: Date) {
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
  if (!/^\d{9}$/.test(recordId)) throw new DomainError("Invalid official parcel identifier.");
  const key = `phila-opa:${recordId}`;
  return db.transaction(async tx => {
    // Stable source identity and atomic shared intake, including concurrent imports.
    // Scope the lock to the DB schema so isolated exercises cannot block real intake.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ${key},0))`);
    const [existing] = await tx.select().from(leadsTable).where(sql`${leadsTable.payload}->>'sourceKey' = ${key}`);
    if (existing) {
      const research = await savedResearch(existing.id,tx);
      if (!research) throw new DomainError("Existing source intake lacks its research record. Review before retrying.",409);
      assertSubject(research,{address:String(existing.payload.address),city:String(existing.payload.city),
        state:String(existing.payload.state),zip:String(existing.payload.zip)});
      return ImportPublicPropertyResponse.parse({leadId:existing.id,created:false,research});
    }
    const subject = await sourceRequest(()=>propertyById(recordId,now));
    const research = await collect(subject,now);
    const same = await tx.select().from(leadsTable).where(sql`
      ${leadsTable.payload}->>'state' = 'PA' AND lower(${leadsTable.payload}->>'city') = 'philadelphia'
      AND regexp_replace(upper(${leadsTable.payload}->>'address'),'[^A-Z0-9]','','g') = ${normalizeAddress(subject.address)}
      AND left(${leadsTable.payload}->>'zip',5) = ${subject.zip}`);
    if (same.length>1) throw new DomainError("Multiple existing subject records share this address. Resolve identity before importing.",409);
    let leadId: string, created = false;
    if (same.length===1) {
      const row = await lockedLead(tx,same[0]!.id);
      if (row.payload.sourceKey && row.payload.sourceKey!==key) throw new DomainError("Existing parcel reference conflicts with this source record.",409);
      leadId = row.id;
      // Do not overwrite prior research, asking price, approvals or transaction state.
      await tx.update(leadsTable).set({payload:{...row.payload,sourceKey:key},version:row.version+1,updatedAt:now}).where(eq(leadsTable.id,row.id));
    } else {
      const lead = await createLead({
        address:subject.address,city:subject.city,state:subject.state,county:"Philadelphia",zip:subject.zip,
        propertyType:subject.propertyType,sqft:subject.sqft??0,beds:subject.beds??0,baths:subject.baths??0,units:1,
        sellerName:"Seller not identified",askingPrice:null,urgency:"UNKNOWN",
        source:`${PHILA_SOURCE.name}; ${subject.sourceUrl}. Research intake only; not a listing or identified seller.`,
        nextAction:"Review source parcel, establish actual seller/contact permission, verify renovated comps and inspect repair scope. Do not quote an inferred price.",
      },actor.id,now,tx);
      leadId = lead.id; created = true;
      const [row] = await tx.select().from(leadsTable).where(eq(leadsTable.id,leadId));
      await move(tx,row!,"ENRICHING","Official property record and sale candidates collected; seller, condition and underwriting review remain incomplete.",
        lead.nextAction,actor.id,now);
      await tx.update(leadsTable).set({payload:{...row!.payload,sourceKey:key},stage:row!.stage,nextAction:row!.nextAction,version:row!.version+1}).where(eq(leadsTable.id,leadId));
    }
    await persistResearch(tx,leadId,research,actor.id,now);
    return ImportPublicPropertyResponse.parse({leadId,created,research});
  });
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
  const research = await collect(subject,now);
  await db.transaction(async tx=>{
    const lead = await lockedLead(tx,id,version);
    await persistResearch(tx,id,research,actor.id,now);
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
    version:parsed.version,comps:[...(old?.comps??[]),...append],repairs:old?.repairs??[],
    repairsComplete:old?.repairsComplete??false,conditionConfirmed:old?.conditionConfirmed??false,
  },actor.id,now);
}