import assert from "node:assert/strict";
import { once } from "node:events";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import { DomainError } from "@workspace/deal-domain";
import type { PublicProperty } from "@workspace/property-sources";
import { createPropertySourcesRouter } from "../routes/property-sources";
import { recordPropertyObservation } from "./property-discovery-store";

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
  const ownerInput = {
    ...baseCase,
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
  const accepted = await request("OWNER", ownerInput);
  const acceptedText = await accepted.text();
  assert.equal(accepted.status, 200, `An owner can save permitted, supported, confirmed route evidence through HTTP: ${acceptedText}`);
  const saved = JSON.parse(acceptedText) as {
    version: number;
    contactResearchCase?: { candidateRoutes?: Array<{ sourceRecordId: string; routeVerificationStatus: string }>; auditHistory: unknown[] };
  };
  assert.equal(saved.contactResearchCase?.candidateRoutes?.length, 1);
  assert.equal(saved.contactResearchCase?.candidateRoutes?.[0]?.routeVerificationStatus, "CONFIRMED");
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
  const reloadResponse = await fetch(
    `${baseUrl}/property-discoveries?marketKey=PHILADELPHIA_PA&limit=50`,
    { headers: { "x-test-role": "OWNER" } },
  );
  assert.equal(reloadResponse.status, 200);
  const reload = await reloadResponse.json() as {
    records: Array<{ id: string; contactResearchCase?: { candidateRoutes?: Array<{ sourceRecordId: string }> } }>;
  };
  assert.ok(reload.records.find(row => row.id === discovery.id)?.contactResearchCase?.candidateRoutes
    ?.some(route => route.sourceRecordId === "SYNTHETIC-HTTP-ROUTE-1"),
  "A separate HTTP read reloads the persisted contact route.");
  console.log("Contact-research HTTP role, owner approval, replay, and persisted reload exercise PASSED (isolated synthetic property; fake identity middleware only; production role and route handlers unchanged).");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
