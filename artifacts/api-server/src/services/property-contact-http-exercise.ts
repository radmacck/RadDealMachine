import assert from "node:assert/strict";
import { once } from "node:events";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import { DomainError } from "@workspace/deal-domain";
import type { PublicProperty } from "@workspace/property-sources";
import { and, desc, eq } from "drizzle-orm";
import { auditTable, db, propertyDiscoveriesTable } from "@workspace/db";
import { createPropertySourcesRouter } from "../routes/property-sources";
import { recordPropertyObservation } from "./property-discovery-store";
import { hasLegitimateSellerCallRoute } from "./property-contactability-gate";

const now = new Date();
const property = {
  id: "SYNTHETIC-CONTACT-HTTP-PARCEL",
  parcelId: "SYNTHETIC-CONTACT-HTTP-PARCEL",
  provider: "SYNTHETIC contact HTTP exercise",
  classification: "OBSERVED",
  address: "100 SYNTHETIC CONTACT WAY",
  city: "Philadelphia",
  county: "Philadelphia",
  state: "PA",
  zip: "19103",
  propertyType: "SINGLE_FAMILY",
  sqft: 1200,
  beds: 3,
  baths: 2,
  recordedOwner: null,
  entityCandidate: false,
  assessedValue: null,
  lastSalePrice: null,
  lastSaleAt: null,
  interiorCondition: null,
  exteriorCondition: null,
  lat: null,
  lng: null,
  contactPaths: [],
  sourceUrl: "https://example.com/synthetic-contact-http",
  capturedAt: now.toISOString(),
} satisfies PublicProperty;
const discovery = await recordPropertyObservation(
  property, "synthetic-contact-http:parcel", "synthetic-contact-http", now,
);

const fakeAuth: RequestHandler = (_req, res, next) => {
  res.locals.actor = "synthetic-contact-http-actor";
  next();
};
const fakeMembership: RequestHandler = (req, res, next) => {
  res.locals.role = req.header("x-test-role") ?? "VIEWER";
  next();
};
const app = express();
app.use(express.json());
app.use(createPropertySourcesRouter(fakeAuth, fakeMembership));
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  if (error instanceof DomainError) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: "Synthetic HTTP exercise failed." });
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${address.port}`;
try {
  const request = (role: string, body: unknown) => fetch(
    `${baseUrl}/property-discoveries/${discovery.id}/contact-research`,
    { method: "POST", headers: { "content-type": "application/json", "x-test-role": role }, body: JSON.stringify(body) },
  );
  const baseCase = {
    version: discovery.version, status: "EVIDENCE_RECORDED", confidence: 0.96,
    sourceName: "SYNTHETIC HTTP owner-consent evidence", sourceType: "OWNER_SUPPLIED",
    sourceUrl: "https://example.com/synthetic-source", observedAt: now.toISOString(),
    identityMatch: "SELLER_SELF_IDENTIFIED", permissionBasis: "CONSENT",
    evidenceReference: "SYNTHETIC-HTTP-REF",
    note: "Synthetic role-check fixture only; no seller was contacted.",
  };
  const denied = await request("VIEWER", baseCase);
  assert.equal(denied.status, 403, "The actual route rejects viewer-role contact research.");
  assert.equal((await denied.text()).includes("(215) 555-0147"), false,
    "A denied response never echoes a submitted private contact route.");
  const evidenceOnlyResponse = await request("OWNER", {
    ...baseCase, status: "OPEN", identityMatch: "RECORDED_OWNER_ONLY", permissionBasis: "UNKNOWN",
  });
  assert.equal(evidenceOnlyResponse.status, 200);
  const evidenceOnly = await evidenceOnlyResponse.json() as {
    version: number;
    contactResearchCase?: { missingRequirements: string[]; identityMatch: string; permissionBasis: string; auditHistory: Array<{reason:string}> };
  };
  assert.ok(evidenceOnly.contactResearchCase?.missingRequirements.some(item => /does not establish seller identity/i.test(item)));
  assert.ok(evidenceOnly.contactResearchCase?.missingRequirements.some(item => /lawful basis/i.test(item)));
  assert.ok(evidenceOnly.contactResearchCase?.missingRequirements.some(item => /No direct phone route/i.test(item)));
  assert.equal(evidenceOnly.contactResearchCase?.missingRequirements.some(item => /Add the exact ownership\/identity source record/i.test(item)), false,
    "A saved evidence reference satisfies only the reference requirement, not identity, permission, or route gates.");
  assert.match(evidenceOnly.contactResearchCase?.auditHistory.at(-1)?.reason ?? "", /status=NONE->OPEN/);
  assert.match(evidenceOnly.contactResearchCase?.auditHistory.at(-1)?.reason ?? "", /evidenceReference=SYNTHETIC-HTTP-REF/);
  const ownerInput = {
    ...baseCase,
    version: evidenceOnly.version,
    signingAuthorityReview: {
      status: "ESTABLISHED",
      sourceName: "SYNTHETIC authority record",
      sourceUrl: "https://example.com/synthetic-authority",
      evidenceReference: "SYNTHETIC-AUTHORITY-PAGE-1",
      observedAt: now.toISOString(),
      note: "Synthetic exercise only; no actual authority was verified.",
    },
    candidateRoute: {
      channel: "PHONE", routeValue: "(215) 555-0147",
      recipient: "SYNTHETIC HTTP seller", recipientRole: "SELLER_SELF_IDENTIFIED",
      sourceId: "synthetic-contact-http", sourceName: "SYNTHETIC owner consent fixture",
      sourceRecordId: "SYNTHETIC-HTTP-ROUTE-1",
      sourceUrl: "https://example.com/synthetic-route", sourceType: "SELLER",
      capturedAt: now.toISOString(), confidence: 0.96,
      permissionStatus: "PERMITTED", permissionBasis: "CONSENT",
      permissionScope: "Synthetic test only",
      permissionEvidenceUrl: "https://example.com/synthetic-permission",
      identityEvidenceStatus: "SUPPORTING_RECORD", identityEvidenceRef: "SYNTHETIC-HTTP-IDENTITY",
      routeVerificationStatus: "CONFIRMED",
      verificationNote: "Synthetic exercise only; no actual call or message.",
    },
  };
  const analystAuthorityReview = await request("ANALYST", ownerInput);
  assert.equal(analystAuthorityReview.status, 403, "Only an Owner can record a signing-authority review.");
  const unsupportedAuthority = await request("OWNER", {
    ...ownerInput,
    identityMatch: "UNKNOWN",
  });
  assert.equal(unsupportedAuthority.status, 409, "Signing authority cannot be marked established without seller identity evidence.");
  const accepted = await request("OWNER", ownerInput);
  const acceptedText = await accepted.text();
  assert.equal(accepted.status, 200, `An owner can save permitted, supported, confirmed route evidence through HTTP: ${acceptedText}`);
  const saved = JSON.parse(acceptedText) as {
    version: number;
    contactResearchCase?: {
      status: "OPEN" | "EVIDENCE_RECORDED" | "NO_DIRECT_ROUTE_FOUND" | "NEEDS_REVIEW" | "BLOCKED";
      candidateRoutes?: Array<{ sourceRecordId: string; routeVerificationStatus: string }>;
      auditHistory: Array<{reason:string}>;
      synthetic: boolean;
      missingRequirements: string[];
      sourceName: string;
      sourceType: "PUBLIC_RECORD" | "PUBLIC_PAGE" | "OWNER_SUPPLIED" | "SELLER_PROVIDED" | "MANUAL_RESEARCH" | "INFERRED" | "OTHER";
      sourceUrl: string | null;
      observedAt: string;
      confidence: number;
      identityMatch: "UNKNOWN" | "RECORDED_OWNER_ONLY" | "SELLER_SELF_IDENTIFIED" | "CONFLICTING" | "NOT_MATCHED";
      permissionBasis: "UNKNOWN" | "PUBLIC_SOURCE_TERMS" | "CONSENT" | "OTHER_DOCUMENTED" | "PROHIBITED";
      evidenceReference: string | null;
      signingAuthorityReview?: { status: string; evidenceReference: string; reviewedBy: string; reviewedAt: string; freshnessStatus: string };
    };
  };
  assert.equal(saved.contactResearchCase?.candidateRoutes?.length, 1);
  assert.equal(saved.contactResearchCase?.candidateRoutes?.[0]?.routeVerificationStatus, "CONFIRMED");
  assert.equal(saved.contactResearchCase?.signingAuthorityReview?.status, "ESTABLISHED");
  assert.equal(saved.contactResearchCase?.signingAuthorityReview?.reviewedBy, "synthetic-contact-http-actor");
  assert.equal(saved.contactResearchCase?.signingAuthorityReview?.freshnessStatus, "CURRENT");
  assert.equal(saved.contactResearchCase?.synthetic, true);
  assert.ok(saved.contactResearchCase?.missingRequirements.some(item => /synthetic or fixture evidence/i.test(item)));
  assert.equal(hasLegitimateSellerCallRoute(saved.contactResearchCase as NonNullable<Parameters<typeof hasLegitimateSellerCallRoute>[0]>, now), false,
    "A synthetic route with test-shaped consent/identity evidence cannot pass the seller-call gate.");
  const routeAuditReason = saved.contactResearchCase?.auditHistory.at(-1)?.reason ?? "";
  assert.match(routeAuditReason, /status=OPEN->EVIDENCE_RECORDED/);
  assert.match(routeAuditReason, /sourceRecordId=SYNTHETIC-HTTP-ROUTE-1/);
  const [auditEvent] = await db.select().from(auditTable)
    .where(and(eq(auditTable.entityId, discovery.id), eq(auditTable.action, "PROPERTY_CONTACT_RESEARCH_RECORDED")))
    .orderBy(desc(auditTable.createdAt)).limit(1);
  assert.ok(auditEvent);
  assert.match(auditEvent.detail, /identity SELLER_SELF_IDENTIFIED; permission CONSENT; candidate routes 1/);
  for (const privateValue of [
    "(215) 555-0147", "SYNTHETIC HTTP seller", "SYNTHETIC-HTTP-REF", "SYNTHETIC-HTTP-ROUTE-1",
    "Synthetic role-check fixture only", "synthetic-permission",
  ]) {
    assert.equal(auditEvent.detail.includes(privateValue), false,
      `Global audit summary must not duplicate private evidence value: ${privateValue}`);
  }
  const [storedDiscovery] = await db.select().from(propertyDiscoveriesTable).where(eq(propertyDiscoveriesTable.id, discovery.id));
  const storedCase = storedDiscovery?.payload.contactResearchCase as { note?: string; evidenceReference?: string };
  assert.equal(storedCase.note, "Synthetic role-check fixture only; no seller was contacted.",
    "Detailed note remains persisted on the access-controlled source record.");
  assert.equal(storedCase.evidenceReference, "SYNTHETIC-HTTP-REF",
    "The evidence reference remains persisted with the private record.");
  const auditCount = saved.contactResearchCase?.auditHistory.length;
  const replay = await request("OWNER", { ...ownerInput, version: saved.version });
  assert.equal(replay.status, 200);
  const replayed = await replay.json() as typeof saved;
  assert.equal(replayed.contactResearchCase?.candidateRoutes?.length, 1);
  assert.equal(replayed.contactResearchCase?.auditHistory.length, auditCount,
    "Exact HTTP replay remains idempotent and does not add audit events.");
  const operatorCannotApprove = await request("OPERATOR", {
    ...ownerInput, version: replayed.version,
    candidateRoute: {
      ...ownerInput.candidateRoute, routeValue: "(215) 555-0158",
      sourceRecordId: "SYNTHETIC-HTTP-OPERATOR-ROUTE",
    },
  });
  assert.equal(operatorCannotApprove.status, 403,
    "The real route handler and service reject operator permission approval.");
  const viewerRead = await fetch(
    `${baseUrl}/property-discoveries?marketKey=PHILADELPHIA_PA&limit=50`,
    { headers: { "x-test-role": "VIEWER" } },
  );
  assert.equal(viewerRead.status, 403,
    "A viewer cannot read discovery records containing private contact-research evidence.");
  const reloadResponse = await fetch(
    `${baseUrl}/property-discoveries?marketKey=PHILADELPHIA_PA&limit=50`,
    { headers: { "x-test-role": "OWNER" } },
  );
  assert.equal(reloadResponse.status, 200);
  const reload = await reloadResponse.json() as {
    records: Array<{ id: string; contactResearchCase?: { evidenceReference?: string | null; candidateRoutes?: Array<{ sourceRecordId: string; routeValue?: string }> } }>;
  };
  const retainedCase = reload.records.find(row => row.id === discovery.id)?.contactResearchCase;
  assert.ok(retainedCase?.candidateRoutes
    ?.some(route => route.sourceRecordId === "SYNTHETIC-HTTP-ROUTE-1"),
  "A separate HTTP read reloads the persisted contact route.");
  assert.equal(retainedCase?.candidateRoutes?.[0]?.routeValue, "(215) 555-0147");
  assert.equal(retainedCase?.evidenceReference, "SYNTHETIC-HTTP-REF");
  console.log("Contact-research HTTP role, owner approval, replay, and persisted reload exercise PASSED (isolated synthetic property; fake identity middleware only; production role and route handlers unchanged).");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
