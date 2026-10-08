import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, intelligenceTable, leadsTable } from "@workspace/db";
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
  permissionStatus: "NOT_REVIEWED" as const,
  routeVerificationStatus: "UNREVIEWED" as const,
};
status = await recordSellerContactObservation(lead.id, base, owner, nextTime());
assert.equal(status.directRouteStatus, "REVIEW_REQUIRED");
assert.equal(status.selectedPhonePath, null);
let row = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)))[0]!;
assert.equal(row.payload.sellerPhone, "", "An unreviewed route is not copied into the call route.");

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
row = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)))[0]!;
assert.equal(row.payload.sellerPhone, "(215) 555-0142", "Only a current owner-confirmed, permission-backed route is selected.");
assert.equal(row.stage, "ENRICHING", "Contact evidence never promotes the lead directly to CALL READY.");
assert.equal(row.analysis, null, "Contact evidence invalidates stale analysis.");
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
assert.equal(status.directRouteStatus, "CONFLICT_REVIEW_REQUIRED");
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

console.log("PASS synthetic persisted seller-contact exercise: provenance, dedupe, conflicts, expiry, authority boundary, no provider, fail-closed selection");
