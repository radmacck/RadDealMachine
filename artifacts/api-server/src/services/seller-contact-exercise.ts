import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, auditTable, intelligenceTable, leadsTable } from "@workspace/db";
import { createLead } from "./deal-store";
import { getSellerContactPaths, recordSellerContactObservation } from "./seller-contact-store";

const now = new Date("2026-10-08T15:00:00.000Z");
let clock = 0;
const nextTime = () => new Date(now.getTime() + ++clock * 1000);
const owner = { id: "synthetic-owner", role: "OWNER" as const };
const analyst = { id: "synthetic-analyst", role: "ANALYST" as const };
const lead = await createLead({
  address: "100 Synthetic Lane", city: "Philadelphia", state: "PA", county: "Philadelphia",
  zip: "19103", propertyType: "SINGLE_FAMILY", sqft: 1200, beds: 3, baths: 1, units: 1,
  askingPrice: null, sellerName: "Synthetic recorded owner", source: "Synthetic contact workflow exercise",
  nextAction: "Synthetic contact evidence exercise only.",
}, owner.id, now);

let status = await getSellerContactPaths(lead.id, now);
assert.equal(status.directRouteStatus, "NO_DIRECT_ROUTE");
assert.equal(status.contactSourceProviderStatus, "NOT_CONNECTED");
assert.equal(status.selectedPhonePath, null);

const base = {
  version: lead.version,
  channel: "PHONE" as const,
  routeValue: "(215) 555-0142",
  recipient: "Synthetic recorded owner",
  recipientRole: "RECORDED_OWNER" as const,
  classification: "OBSERVED" as const,
  confidence: 0.65,
  sourceType: "PUBLIC_PAGE" as const,
  sourceId: "synthetic-directory-a",
  sourceName: "Synthetic permitted-directory fixture (not a real source)",
  sourceRecordId: "SYNTHETIC-REC-001",
  sourceUrl: "https://example.invalid/synthetic-contact/1",
  capturedAt: now.toISOString(),
  permissionStatus: "NOT_REVIEWED" as const,
  routeVerificationStatus: "UNREVIEWED" as const,
};
status = await recordSellerContactObservation(lead.id, base, owner, nextTime());
assert.equal(status.directRouteStatus, "NEEDS_REVIEW");
assert.equal(status.selectedPhonePath, null);
let row = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)))[0]!;
assert.equal(row.payload.sellerPhone, "", "An unreviewed route is not copied into the call route.");
const firstObservationAuditCount=(await db.select().from(auditTable).where(eq(auditTable.entityId,lead.id))).length;
status = await recordSellerContactObservation(lead.id,{...base,version:status.leadVersion},owner,nextTime());
assert.equal((await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,lead.id))).length,1,
  "Exact source/route/observed-time replay is deduplicated without deleting provenance.");
assert.equal((await db.select().from(auditTable).where(eq(auditTable.entityId,lead.id))).length,firstObservationAuditCount,
  "Exact replay does not create duplicate audit events.");

status = await recordSellerContactObservation(lead.id, {
  ...base,
  version: status.leadVersion,
  routeValue: "+1 215 555 0142",
  sourceId: "synthetic-directory-b",
  sourceName: "Second synthetic directory fixture (not a real source)",
  sourceRecordId: "SYNTHETIC-REC-002",
}, owner, nextTime());
assert.equal(status.contactPaths.filter(path => path.channel === "PHONE").length, 1, "Normalized duplicate numbers reconcile to one route.");
assert.equal(status.contactPaths.find(path => path.channel === "PHONE")?.supportingObservationCount, 2);
let entries = await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId, lead.id));
assert.equal(entries.length, 2, "Both source observations remain persisted despite route deduplication.");

status = await recordSellerContactObservation(lead.id, {
  ...base,
  version: status.leadVersion,
  sourceType: "SELLER",
  sourceId: "synthetic-owner-review",
  sourceName: "Synthetic owner route review",
  sourceRecordId: "SYNTHETIC-REVIEW-001",
  sourceUrl: undefined,
  permissionStatus: "PERMITTED",
  contactPermissionEvidenceUrl: "https://example.invalid/synthetic-contact-permission/1",
  routeVerificationStatus: "CONFIRMED",
  verificationNote: "Synthetic route review; no real person or contact data.",
  confidence: 0.95,
}, owner, nextTime());
assert.equal(status.directRouteStatus, "PHONE_ROUTE_AVAILABLE");
assert.equal(status.selectedPhonePath?.identityStatus, "UNVERIFIED");
assert.equal(status.selectedPhonePath?.signingAuthorityStatus, "NOT_ESTABLISHED");
assert.equal(status.selectedPhonePath?.permissionStatus, "PERMITTED");
assert.equal(status.selectedPhonePath?.identityConflictStatus, "NONE");
assert.equal(status.selectedPhonePath?.supportingObservations?.length, 3,
  "Both source observations and the later owner review remain attached to the deduplicated route.");
assert.ok(status.selectedPhonePath?.rankingReasons?.[0]?.includes("Rank 1 of"));
row = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)))[0]!;
assert.equal(row.payload.sellerPhone, "(215) 555-0142", "Only a current owner-confirmed, permission-backed route is selected.");
assert.equal(row.stage, lead.stage, "Contact evidence does not move the deal stage or promote the lead.");
assert.equal(row.nextAction, lead.nextAction, "Contact research preserves the operator's existing next action.");
assert.equal(row.analysis, null, "No analysis exists in this synthetic route-only fixture.");
const underwrite = row.underwriting as Record<string, unknown>;
assert.equal(underwrite.sellerContactEvidenceId, status.selectedPhonePath?.id, "The selected route is carried into underwriting without re-entry.");

const conflictBase = {
  ...base,
  version: status.leadVersion,
  routeValue: "(267) 555-0199",
  sourceType: "SELLER" as const,
  sourceId: "synthetic-owner-review",
  sourceName: "Synthetic owner route review",
  sourceRecordId: "SYNTHETIC-REVIEW-002",
  sourceUrl: undefined,
  permissionStatus: "PERMITTED" as const,
  contactPermissionEvidenceUrl: "https://example.invalid/synthetic-contact-permission/2",
  routeVerificationStatus: "CONFIRMED" as const,
  verificationNote: "Synthetic independent route review; no real person or contact data.",
  confidence: 0.9,
};
status = await recordSellerContactObservation(lead.id, conflictBase, owner, nextTime());
assert.equal(status.directRouteStatus, "CONFLICTING_ROUTE");
assert.equal(status.selectedPhonePath, null, "Two conflicting permitted phones are not selected automatically.");
row = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)))[0]!;
assert.equal(row.payload.sellerPhone, "", "Conflicting routes fail closed in the lead contact field.");

status = await recordSellerContactObservation(lead.id, {
  ...conflictBase,
  version: status.leadVersion,
  routeVerificationStatus: "REJECTED",
  verificationNote: "Synthetic review rejected this conflicting route.",
  sourceRecordId: "SYNTHETIC-REVIEW-002-REJECTED",
}, owner, nextTime());
assert.equal(status.directRouteStatus, "PHONE_ROUTE_AVAILABLE", "An explicit later rejection resolves a route conflict.");
assert.equal(status.selectedPhonePath?.routeValue, "(215) 555-0142");

const staleCapturedAt = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
status = await recordSellerContactObservation(lead.id, {
  ...base,
  version: status.leadVersion,
  routeValue: "(267) 555-0177",
  sourceId: "synthetic-stale-source",
  sourceName: "Synthetic stale contact source",
  sourceRecordId: "SYNTHETIC-STALE-001",
  sourceUrl: undefined,
  sourceType: "SELLER",
  capturedAt: staleCapturedAt.toISOString(),
  freshUntilAt: new Date(staleCapturedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  permissionStatus: "PERMITTED",
  contactPermissionEvidenceUrl: "https://example.invalid/synthetic-contact-permission/stale",
  routeVerificationStatus: "CONFIRMED",
  verificationNote: "Synthetic stale route; recorded only to verify expiry behavior.",
  confidence: 0.99,
}, owner, nextTime());
assert.equal(status.directRouteStatus, "PHONE_ROUTE_AVAILABLE", "A stale route does not displace the single current route.");
assert.equal(status.contactPaths.find(path => path.routeValue === "(267) 555-0177")?.freshnessStatus, "STALE");
assert.equal(status.selectedPhonePath?.routeValue, "(215) 555-0142");
row = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)))[0]!;
assert.equal(row.stage, lead.stage);
assert.equal(row.nextAction, lead.nextAction);

const postalLead = await createLead({
  address:"SYNTHETIC POSTAL ONLY",city:"Philadelphia",state:"PA",county:"Philadelphia",zip:"19103",
  propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:1,units:1,sellerName:"SYNTHETIC assessed owner",
  source:"SYNTHETIC postal-only contact exercise",
},owner.id,nextTime());
await db.insert(intelligenceTable).values({
  id:"55000000-0000-4000-8000-000000000001",leadId:postalLead.id,createdBy:owner.id,createdAt:nextTime(),
  payload:{contactPath:{
    id:"SYNTHETIC-POSTAL-ONLY",channel:"POSTAL",recipient:"SYNTHETIC assessed owner",
    addressLines:["100 SYNTHETIC POSTAL TEST ST"],cityState:"Philadelphia PA",postalCode:"19103",
    classification:"OBSERVED",confidence:0.7,sourceId:"synthetic-public-record",sourceName:"SYNTHETIC public-record fixture",
    sourceRecordId:"SYNTHETIC-POSTAL-001",sourceUrl:"https://example.invalid/synthetic-record",
    capturedAt:now.toISOString(),freshUntilAt:new Date(now.getTime()+30*86400000).toISOString(),freshnessStatus:"CURRENT",
    permissionStatus:"NOT_REVIEWED",sourceType:"PUBLIC_RECORD",recipientRole:"RECORDED_OWNER",
    routeVerificationStatus:"UNREVIEWED",identityStatus:"UNVERIFIED",signingAuthorityStatus:"NOT_ESTABLISHED",
  }},
});
const postalStatus=await getSellerContactPaths(postalLead.id,nextTime());
assert.equal(postalStatus.directRouteStatus,"POSTAL_ONLY");
assert.equal(postalStatus.selectedPhonePath,null);
assert.equal(postalStatus.selectedEmailPath,null);
assert.equal(postalStatus.contactPaths[0]?.channel,"POSTAL","Mailing-address evidence remains postal-only.");

const identityConflictLead=await createLead({
  address:"SYNTHETIC IDENTITY CONFLICT",city:"Philadelphia",state:"PA",county:"Philadelphia",zip:"19103",
  propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:1,units:1,sellerName:"SYNTHETIC recipient-conflict subject",
  source:"SYNTHETIC recipient-conflict exercise",
},owner.id,nextTime());
await recordSellerContactObservation(identityConflictLead.id,{
  ...base,version:identityConflictLead.version,sourceType:"SELLER",sourceUrl:undefined,
  sourceId:"synthetic-recipient-source-a",sourceName:"SYNTHETIC recipient source A",
  sourceRecordId:"SYNTHETIC-RECIPIENT-A",permissionStatus:"PERMITTED",
  contactPermissionEvidenceUrl:"https://example.invalid/synthetic-contact-permission/recipient-a",
  routeVerificationStatus:"CONFIRMED",verificationNote:"SYNTHETIC recipient claim A.",
},owner,nextTime());
const identityConflict=await recordSellerContactObservation(identityConflictLead.id,{
  ...base,version:identityConflictLead.version+1,recipient:"SYNTHETIC different recipient",
  sourceType:"SELLER",sourceUrl:undefined,sourceId:"synthetic-recipient-source-b",
  sourceName:"SYNTHETIC recipient source B",sourceRecordId:"SYNTHETIC-RECIPIENT-B",
  permissionStatus:"PERMITTED",contactPermissionEvidenceUrl:"https://example.invalid/synthetic-contact-permission/recipient-b",
  routeVerificationStatus:"CONFIRMED",verificationNote:"SYNTHETIC conflicting recipient claim.",
},owner,nextTime());
assert.equal(identityConflict.directRouteStatus,"CONFLICTING_ROUTE");
assert.equal(identityConflict.selectedPhonePath,null);
assert.equal(identityConflict.contactPaths[0]?.identityConflictStatus,"MULTIPLE_RECIPIENTS");
assert.equal(identityConflict.contactPaths[0]?.recipientIdentityClaimCount,2);
assert.equal(identityConflict.contactPaths[0]?.supportingObservations?.length,2);
const identityConflictRow=(await db.select().from(leadsTable).where(eq(leadsTable.id,identityConflictLead.id)))[0]!;
assert.equal(identityConflictRow.payload.sellerPhone??"","","Conflicting recipient claims never become CALL READY.");

const staleOnlyLead=await createLead({
  address:"SYNTHETIC STALE ONLY",city:"Philadelphia",state:"PA",county:"Philadelphia",zip:"19103",
  propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:1,units:1,sellerName:"SYNTHETIC stale-route subject",
  source:"SYNTHETIC stale contact exercise",
},owner.id,nextTime());
const expiredCapture=new Date(now.getTime()-40*86400000);
const staleOnly=await recordSellerContactObservation(staleOnlyLead.id,{
  ...base,version:staleOnlyLead.version,routeValue:"(267) 555-0178",
  sourceId:"synthetic-stale-only",sourceRecordId:"SYNTHETIC-STALE-ONLY-001",
  capturedAt:expiredCapture.toISOString(),freshUntilAt:new Date(expiredCapture.getTime()+30*86400000).toISOString(),
  sourceType:"SELLER",sourceUrl:undefined,permissionStatus:"PERMITTED",
  contactPermissionEvidenceUrl:"https://example.invalid/synthetic-contact-permission/stale-only",
  routeVerificationStatus:"CONFIRMED",verificationNote:"SYNTHETIC stale route only; no real contact.",
},owner,nextTime());
assert.equal(staleOnly.directRouteStatus,"STALE_ROUTE");
assert.equal(staleOnly.selectedPhonePath,null);
const staleOnlyRow=(await db.select().from(leadsTable).where(eq(leadsTable.id,staleOnlyLead.id)))[0]!;
assert.equal(staleOnlyRow.payload.sellerPhone??"","","Stale contact evidence cannot populate the call route.");

async function routeTypeStatus(channel:"EMAIL"|"WEB"|"OTHER",routeValue:string) {
  const routeLead=await createLead({
    address:`SYNTHETIC ${channel} ROUTE`,city:"Philadelphia",state:"PA",county:"Philadelphia",zip:"19103",
    propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:1,units:1,sellerName:`SYNTHETIC ${channel} route subject`,
    source:`SYNTHETIC ${channel} contact exercise`,
  },owner.id,nextTime());
  return recordSellerContactObservation(routeLead.id,{
    ...base,version:routeLead.version,channel,routeValue,sourceType:"PUBLIC_PAGE",
    sourceId:`synthetic-${channel.toLowerCase()}-source`,sourceName:`SYNTHETIC ${channel} route source`,
    sourceRecordId:`SYNTHETIC-${channel}-001`,sourceUrl:"https://example.invalid/synthetic-listing",
    permissionStatus:"PERMITTED",contactPermissionEvidenceUrl:"https://example.invalid/synthetic-contact-permission",
    routeVerificationStatus:"CONFIRMED",verificationNote:`SYNTHETIC ${channel} route; no message sent.`,
  },owner,nextTime());
}
const emailOnly=await routeTypeStatus("EMAIL","seller@example.invalid");
assert.equal(emailOnly.directRouteStatus,"EMAIL_ONLY");
assert.equal(emailOnly.selectedPhonePath,null,"Email never becomes a phone route.");
const webOnly=await routeTypeStatus("WEB","https://example.invalid/synthetic-contact-form");
assert.equal(webOnly.directRouteStatus,"WEB_ROUTE_AVAILABLE");
assert.equal(webOnly.selectedPhonePath,null,"Web route never becomes a phone route or sends a form.");
const webInvalidLead=await createLead({
  address:"SYNTHETIC INVALID WEB ROUTE",city:"Philadelphia",state:"PA",county:"Philadelphia",zip:"19103",
  propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:1,units:1,sellerName:"SYNTHETIC invalid-web subject",
  source:"SYNTHETIC invalid web route exercise",
},owner.id,nextTime());
const beforeInvalidWeb=(await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,webInvalidLead.id))).length;
await assert.rejects(recordSellerContactObservation(webInvalidLead.id,{
  ...base,version:webInvalidLead.version,channel:"WEB",routeValue:"http://example.invalid/contact",
  sourceId:"synthetic-invalid-web",sourceName:"SYNTHETIC invalid web route",sourceRecordId:"SYNTHETIC-WEB-INVALID",
  sourceType:"PUBLIC_PAGE",sourceUrl:"https://example.invalid/listing",
},owner,nextTime()),/HTTPS/i);
assert.equal((await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,webInvalidLead.id))).length,beforeInvalidWeb,
  "An HTTP contact form is rejected before persistence.");
const otherOnly=await routeTypeStatus("OTHER","SYNTHETIC manual route note");
assert.equal(otherOnly.directRouteStatus,"OTHER_ROUTE_AVAILABLE");
assert.equal(otherOnly.selectedPhonePath,null,"Other route evidence never becomes a phone route.");

const transactionMarker = { synthetic: true, snapshot: "must-remain-untouched" };
await db.update(leadsTable).set({
  stage: "UNDER_CONTRACT",
  analysis: transactionMarker,
  nextAction: "Synthetic closing milestone must remain next.",
}).where(eq(leadsTable.id, lead.id));
row = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)))[0]!;
status = await recordSellerContactObservation(lead.id, {
  ...base,
  version: row.version,
  sourceId: "synthetic-transaction-research",
  sourceName: "Synthetic post-contract contact observation",
  sourceRecordId: "SYNTHETIC-TRANSACTION-001",
}, owner, nextTime());
row = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)))[0]!;
assert.equal(row.stage, "UNDER_CONTRACT");
assert.deepEqual(row.analysis, transactionMarker, "New contact research cannot clear an executed analysis snapshot.");
assert.equal(row.nextAction, "Synthetic closing milestone must remain next.", "Contact research cannot replace transaction next actions.");
assert.equal(row.payload.sellerPhone, "(215) 555-0142", "Research does not rewrite executed transaction contact fields.");

const beforeDenied = (await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId, lead.id))).length;
await assert.rejects(
  recordSellerContactObservation(lead.id, {
    ...base,
    version: status.leadVersion,
    permissionStatus: "PERMITTED",
    contactPermissionEvidenceUrl: "https://example.invalid/synthetic-contact-permission/analyst",
  }, analyst, nextTime()),
  /Only an owner can make a contact-source permission decision/,
);
assert.equal((await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId, lead.id))).length, beforeDenied,
  "Unauthorized permission review persists no contact observation.");
await assert.rejects(
  recordSellerContactObservation(lead.id, base, owner, nextTime()),
  /changed in another session/,
  "Optimistic lead version prevents replay of an old contact-observation request.",
);

console.log("PASS SYNTHETIC persisted seller-contact exercise: provenance, dedupe and ranking; NO_DIRECT_ROUTE, NEEDS_REVIEW, CONFLICTING_ROUTE, STALE_ROUTE, POSTAL_ONLY, EMAIL_ONLY, WEB_ROUTE_AVAILABLE, OTHER_ROUTE_AVAILABLE and PHONE_ROUTE_AVAILABLE; identity/signing authority remain unverified; finance, offer authority, stage, and next action preserved; permissions and replay protection; no outreach.");
