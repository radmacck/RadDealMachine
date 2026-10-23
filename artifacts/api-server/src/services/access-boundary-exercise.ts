import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import {
  auditTable, buyersTable, db, jobsTable, pool, propertyDiscoveriesTable, propertySourceObservationsTable,
} from "@workspace/db";
import { DomainError } from "@workspace/deal-domain";
import { stableEvidenceJson } from "./evidence-packet";
import { createDealsRouter } from "../routes/deals";
import { createInternalDistributionRouter } from "../routes/distribution";
import { createOperationsRouter } from "../routes/operations";
import { createPropertySourcesRouter } from "../routes/property-sources";

const fixtureActor = "synthetic-access-boundary-exercise";
const fakeAuth: RequestHandler = (req, res, next) => {
  if (req.header("x-test-auth") !== "authenticated") {
    res.status(401).json({ error: "Synthetic unauthenticated request." });
    return;
  }
  res.locals.actor = fixtureActor;
  next();
};
const fakeMembership: RequestHandler = (req, res, next) => {
  const role = req.header("x-test-role") ?? "VIEWER";
  if (role === "PENDING") {
    res.status(403).json({ error: "Synthetic workspace membership is pending." });
    return;
  }
  res.locals.role = role;
  next();
};

const app = express();
app.use(express.json());
app.use(createDealsRouter(fakeAuth, fakeMembership));
app.use(createOperationsRouter(fakeAuth, fakeMembership));
app.use(createInternalDistributionRouter(fakeAuth, fakeMembership));
app.use(createPropertySourcesRouter(fakeAuth, fakeMembership));
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  if (error instanceof DomainError) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: "Synthetic access-boundary exercise failed." });
});

const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const targetId = "00000000-0000-4000-8000-000000000001";
let createdBuyerId: string | undefined;
let createdDiscoveryId: string | undefined;

async function snapshot() {
  const result = await pool.query<{buyers:string;leads:string;audits:string;evidenceExports:string}>(`
    SELECT
      (SELECT count(*)::text FROM re_buyers) AS buyers,
      (SELECT count(*)::text FROM re_leads) AS leads,
      (SELECT count(*)::text FROM re_property_qualification_criteria) AS "propertyCriteria",
      (SELECT count(*)::text FROM re_audit) AS audits,
      (SELECT count(*)::text FROM re_evidence_packet_exports) AS "evidenceExports"
  `);
  return result.rows[0]!;
}

async function request(
  path: string,
  options: { role?: string; authenticated?: boolean; method?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.authenticated !== false) headers["x-test-auth"] = "authenticated";
  if (options.role) headers["x-test-role"] = options.role;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

try {
  const privateReadPaths = [
    "/buyers",
    "/leads",
    "/property-discoveries?marketKey=PHILADELPHIA_PA&limit=1",
    "/audit",
  ];
  const ownerOnlyBuyerReadPaths = [`/buyers/${targetId}`, `/buyers/${targetId}/contact-research`];
  const privateDealDetailPaths = [
    `/leads/${targetId}`,
    `/deals/${targetId}/operations`,
    `/leads/${targetId}/offers/${targetId}/review`,
    `/leads/${targetId}/contact-paths`,
  ];
  const privateWritePaths = [
    { path: "/buyers", method: "POST", role: "OPERATOR" },
    { path: "/leads", method: "POST", role: "OPERATOR" },
    { path: "/property-discovery-criteria/PHILADELPHIA_PA", method: "PUT", role: "VIEWER" },
  ];
  const privateExportPaths = [
    `/leads/${targetId}/evidence-packet?purpose=INTERNAL_REVIEW`,
    `/buyers/${targetId}/export`,
    `/property-discoveries/${targetId}/export`,
    `/deals/${targetId}/distribution`,
  ];
  const ownerOnlyRecordExportPaths = [
    `/buyers/${targetId}/export`,
    `/property-discoveries/${targetId}/export`,
  ];
  const beforeDeniedRequests = await snapshot();

  for (const path of [...privateReadPaths, ...privateExportPaths, ...ownerOnlyBuyerReadPaths]) {
    const response = await request(path, { authenticated: false });
    assert.equal(response.status, 401, `Unauthenticated request must not access ${path}.`);
  }
  for (const path of privateDealDetailPaths) {
    const response = await request(path, { authenticated: false });
    assert.equal(response.status, 401, `Unauthenticated request must not access private deal detail ${path}.`);
  }
  const pending = await request("/buyers", { role: "PENDING" });
  assert.equal(pending.status, 403, "An authenticated account without approved membership cannot read buyer records.");

  for (const path of [...privateReadPaths, ...privateExportPaths, ...ownerOnlyBuyerReadPaths]) {
    const response = await request(path, { role: "VIEWER" });
    assert.equal(response.status, 403, `A viewer must not access private workspace data at ${path}.`);
  }
  for (const path of ownerOnlyRecordExportPaths) {
    for (const role of ["ANALYST", "OPERATOR"]) {
      const response = await request(path, { role });
      assert.equal(response.status, 403, `${role} must not export owner-only records at ${path}.`);
    }
  }
  for (const path of privateDealDetailPaths) {
    const response = await request(path, { role: "VIEWER" });
    assert.equal(response.status, 403, `A viewer must not access private deal detail at ${path}.`);
  }

  for (const item of privateWritePaths) {
    const response = await request(item.path, { method: item.method, role: item.role, body: {} });
    assert.equal(response.status, 403, `Unauthorized ${item.method} ${item.path} must be denied before body validation.`);
  }

  const afterDeniedRequests = await snapshot();
  assert.deepEqual(afterDeniedRequests, beforeDeniedRequests,
    "Denied reads, writes, and exports must not create records, export packets, or audit entries in the isolated schema.");

  for (const path of ["/buyers", "/buyers/capacity", `/buyers/${targetId}`, `/buyers/${targetId}/contact-research`, "/audit"]) {
    for (const role of ["ANALYST", "OPERATOR"]) {
      const response = await request(path, { role });
      assert.equal(response.status, 403, `${role} must not read founder-only buyer data at ${path}.`);
    }
  }
  for (const item of [
    { path: "/buyers", method: "POST", role: "ANALYST" },
    { path: "/buyers/discovered", method: "POST", role: "ANALYST" },
    { path: `/buyers/${targetId}`, method: "PATCH", role: "ANALYST" },
    { path: `/buyers/${targetId}`, method: "PATCH", role: "OPERATOR" },
    { path: `/buyers/${targetId}/qualification`, method: "POST", role: "ANALYST" },
  ]) {
    const response = await request(item.path, { method: item.method, role: item.role, body: {} });
    assert.equal(response.status, 403, `${item.role} must not ${item.method} founder-only buyer records.`);
  }

  for (const path of privateReadPaths) {
    const response = await request(path, { role: "OWNER" });
    assert.equal(response.status, 200, `An authenticated Owner can read ${path}.`);
  }

  const createBody = {
    name: "SYNTHETIC D26 HTTP BUYER",
    email: "private-export@example.invalid",
    phone: "+1-555-0100",
    source: "Synthetic D26 HTTP exercise only",
    status: "ACTIVE",
    criteria: null,
  };
  const createdResponse = await request("/buyers", { role: "OWNER", method: "POST", body: createBody });
  assert.equal(createdResponse.status, 201, "An Owner can create a buyer record.");
  const created = await createdResponse.json() as { id: string; version: number; name: string; contactObservedAt?: string | null };
  createdBuyerId = created.id;
  assert.equal(created.name, createBody.name);
  assert.ok(!created.contactObservedAt, "Optional contact observation time must remain absent when not supplied.");

  const duplicate = await request("/buyers", { role: "OWNER", method: "POST", body: createBody });
  assert.equal(duplicate.status, 409, "Exact replay without any contact route must not create a duplicate buyer.");
  const invalid = await request("/buyers", { role: "OWNER", method: "POST", body: { ...createBody, name: "" } });
  assert.equal(invalid.status, 400, "Invalid required fields must be rejected.");
  const whitespaceRequired = await request("/buyers", {
    role: "OWNER",
    method: "POST",
    body: { ...createBody, name: "   ", source: "   " },
  });
  assert.equal(whitespaceRequired.status, 400, "Whitespace-only required fields must be rejected after normalization.");

  const detail = await request(`/buyers/${created.id}`, { role: "OWNER" });
  assert.equal(detail.status, 200, "Owner can reload the created record.");
  const versionedCreate = await detail.json() as typeof created & { source: string; email: string; phone: string; status: "ACTIVE" | "PAUSED"; criteria: null };
  const edit = await request(`/buyers/${created.id}`, {
    role: "OWNER",
    method: "PATCH",
    body: { ...versionedCreate, name: "SYNTHETIC D26 EDITED BUYER", version: versionedCreate.version },
  });
  assert.equal(edit.status, 200, "Owner can edit an existing buyer with its current version.");
  const edited = await edit.json() as { name: string; version: number };
  assert.equal(edited.name, "SYNTHETIC D26 EDITED BUYER");
  assert.equal(edited.version, versionedCreate.version + 1);

  const [buyerRow] = await db.select().from(buyersTable).where(eq(buyersTable.id, created.id));
  assert.ok(buyerRow);
  await db.update(buyersTable).set({ payload: { ...buyerRow.payload, synthetic: true } })
    .where(eq(buyersTable.id, created.id));
  const buyerExportResponse = await request(`/buyers/${created.id}/export`, { role: "OWNER" });
  assert.equal(buyerExportResponse.status, 200);
  const buyerExport = await buyerExportResponse.json() as {
    recordClass: string; redactionLevel: string; contentHash: string; snapshot: { payload: Record<string, unknown> };
  };
  assert.equal(buyerExport.recordClass, "SYNTHETIC");
  assert.equal(buyerExport.redactionLevel, "PRIVATE_FIELDS_REDACTED");
  assert.equal(buyerExport.snapshot.payload.name, "[REDACTED]");
  assert.equal(buyerExport.snapshot.payload.email, "[REDACTED]");
  assert.equal(buyerExport.snapshot.payload.phone, "[REDACTED]");
  assert.equal(buyerExport.contentHash,
    createHash("sha256").update(stableEvidenceJson(Object.fromEntries(
      Object.entries(buyerExport).filter(([key]) => key !== "contentHash"),
    ))).digest("hex"));

  const [discovery] = await db.insert(propertyDiscoveriesTable).values({
    identityKey: `synthetic-private-export:${fixtureActor}`,
    marketKey: "PHILADELPHIA_PA",
    status: "RELEVANT_CANDIDATE",
    score: 1,
    confidence: 0.5,
    payload: {
      synthetic: true,
      property: { address: "123 Synthetic Private St", recordedOwner: "Synthetic Seller", sourceUrl: "https://example.invalid/parcel" },
      signals: [{ statement: "Synthetic note mentions 123 Synthetic Private St", evidenceRef: "synthetic:source:1" }],
    },
  }).returning({ id: propertyDiscoveriesTable.id });
  assert.ok(discovery);
  createdDiscoveryId = discovery.id;
  const now = new Date();
  await db.insert(propertySourceObservationsTable).values({
    discoveryId: discovery.id,
    sourceKey: `synthetic-private-export:${fixtureActor}`,
    sourceId: "synthetic-parcel-1",
    sourceUrl: "https://example.invalid/parcel",
    firstObservedAt: now,
    lastObservedAt: now,
    seenCount: 1,
    payload: { address: "123 Synthetic Private St", recordedOwner: "Synthetic Seller", sourceRecordId: "synthetic-parcel-1" },
  });
  const propertyExportResponse = await request(`/property-discoveries/${discovery.id}/export`, { role: "OWNER" });
  assert.equal(propertyExportResponse.status, 200);
  const propertyExport = await propertyExportResponse.json() as {
    recordClass: string; contentHash: string; snapshot: { payload: Record<string, unknown>; sourceObservations: Array<{ payload: Record<string, unknown> }> };
  };
  assert.equal(propertyExport.recordClass, "SYNTHETIC");
  assert.equal(propertyExport.snapshot.payload.property && (propertyExport.snapshot.payload.property as Record<string, unknown>).address, "[REDACTED]");
  assert.equal(propertyExport.snapshot.sourceObservations.length, 1, "Property source lineage must remain in the export.");
  assert.equal(propertyExport.snapshot.sourceObservations[0]?.payload.recordedOwner, "[REDACTED]");
  assert.equal(propertyExport.contentHash,
    createHash("sha256").update(stableEvidenceJson(Object.fromEntries(
      Object.entries(propertyExport).filter(([key]) => key !== "contentHash"),
    ))).digest("hex"));

  const audits = await db.select({ action: auditTable.action }).from(auditTable)
    .where(and(eq(auditTable.actor, fixtureActor), eq(auditTable.entityId, created.id)));
  assert.deepEqual(new Set(audits.map((entry) => entry.action)),
    new Set(["BUYER_CREATED", "BUYER_UPDATED", "FOUNDER_RECORD_EXPORTED"]),
    "Create, edit and export audit history must persist for the synthetic buyer.");
  const propertyExportAudit = await db.select({ action: auditTable.action, detail: auditTable.detail }).from(auditTable)
    .where(and(eq(auditTable.actor, fixtureActor), eq(auditTable.entityId, discovery.id)));
  assert.equal(propertyExportAudit[0]?.action, "FOUNDER_RECORD_EXPORTED");
  assert.match(propertyExportAudit[0]?.detail ?? "", new RegExp(propertyExport.contentHash));
  const buyerCount = await db.select({ id: buyersTable.id }).from(buyersTable).where(eq(buyersTable.id, created.id));
  assert.equal(buyerCount.length, 1, "Replay and invalid submissions must not create extra records.");

  console.log("Private workspace HTTP exercise PASSED (isolated synthetic schema): OWNER buyer create/read/edit/reload; unauthenticated and VIEWER denials for deal detail, operations, offer review, contact paths, list, and export endpoints; buyer validation/replay/audit checks; ANALYST/OPERATOR buyer denials. Identity middleware was synthetic; production role middleware and handlers were used unchanged.");
} finally {
  if (createdBuyerId) await db.delete(buyersTable).where(eq(buyersTable.id, createdBuyerId));
  if (createdDiscoveryId) {
    await db.delete(propertySourceObservationsTable).where(eq(propertySourceObservationsTable.discoveryId, createdDiscoveryId));
    await db.delete(propertyDiscoveriesTable).where(eq(propertyDiscoveriesTable.id, createdDiscoveryId));
  }
  await db.delete(jobsTable).where(eq(jobsTable.requestedBy, fixtureActor));
  await db.delete(auditTable).where(eq(auditTable.actor, fixtureActor));
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
}
