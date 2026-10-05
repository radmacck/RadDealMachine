import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import type { SellerOfferPortal } from "@workspace/api-zod";
import {
  db, pool, leadsTable, contractsTable, transitionsTable, auditTable, sellerOfferPortalEventsTable,
} from "@workspace/db";
import type { LeadInput, UnderwritingInput, OfferApprovalInput } from "@workspace/deal-domain";
import { logger } from "../lib/logger";
import app from "../app";
import * as store from "./deal-store";
import * as offers from "./offer-store";
import * as portals from "./seller-offer-portals";
import { exerciseEvidence } from "./exercise-evidence";

const now = new Date();
const actorId = `synthetic-seller-portal-exercise:${randomUUID()}`;
const owner = { id: actorId, role: "OWNER" };
const operator = { id: actorId, role: "OPERATOR" };
const future = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
const leadIds: string[] = [];
const server = createServer(app);

async function createCommunicatedOffer(label: string) {
  const payload: LeadInput = {
    address: `SYNTHETIC PORTAL ${label} ${randomUUID()} Example Lane`,
    city: "Synthetic City", state: "TX", county: "Synthetic County", zip: "75001",
    propertyType: "SINGLE_FAMILY", sqft: 1000, beds: 3, baths: 2, units: 1,
    askingPrice: 100000, sellerName: "SYNTHETIC EXERCISE ONLY", sellerPhone: "000-000-0000",
    source: "Synthetic seller-portal exercise; no real property",
  };
  const lead = await store.createLead(payload, actorId, now);
  leadIds.push(lead.id);
  const evidence = await store.addIntelligence(lead.id, {
    classification: "VERIFIED_FACTS", category: "ownership",
    statement: "Synthetic exercise seller is record owner.",
    source: "Synthetic public-record fixture only", sourceType: "PUBLIC_RECORD", confidence: 0.9,
    capturedAt: now.toISOString(), verificationNote: "Synthetic fixture only; not real title evidence.",
  }, actorId, now);
  let detail = await store.leadDetail(lead.id);
  const underwriting: UnderwritingInput = {
    version: detail.lead.version, repairsComplete: true, conditionConfirmed: true,
    comps: [290000, 300000, 310000].map((salePrice, i) => ({
      id: `synthetic-portal-${label}-comp-${i}`, address: `SYNTHETIC PORTAL COMP ${i}`,
      salePrice, sqft: 1000, soldAt: new Date(now.getTime() - 10 * 86_400_000).toISOString().slice(0, 10),
      distanceMiles: 0.5, propertyType: "SINGLE_FAMILY", condition: "RENOVATED",
      source: "Synthetic verified-sale fixture", verified: true,
    })),
    repairs: [{
      category: "Whole synthetic scope", low: 10000, expected: 20000, high: 30000,
      confidence: 0.8, source: "Synthetic repair quote",
    }],
  };
  detail = await store.saveUnderwriting(
    lead.id, await exerciseEvidence(lead.id, underwriting, actorId, now), actorId, now,
  );
  detail = await store.transitionLead(lead.id, {
    version: detail.lead.version, to: "CALL_READY", reason: "Synthetic seller portal fixture.",
    nextAction: "Run synthetic seller conversation.",
  }, actorId, now);
  detail = await store.recordCall(lead.id, {
    version: detail.lead.version, outcome: "CONNECTED", notes: "Synthetic conversation fixture.",
    nextAction: "Review synthetic offer.", followUpAt: future(1),
  }, actorId, now);
  detail = await offers.createOfferDraft(lead.id, {
    version: detail.lead.version, amount: 110000, earnestMoney: 1000, closingDays: 30,
    contingencies: "Subject to diligence, title and executed contract.",
    assignmentIntent: true, reason: "Synthetic seller portal fixture.",
  }, owner, now);
  const offerId = detail.offers[0]!.id;
  const approval: OfferApprovalInput = {
    version: detail.lead.version, maximumApprovedAcquisitionPrice: 120000,
    expiresAt: future(48), authorityEvidenceId: evidence.id,
    reason: "Synthetic owner approval fixture.", nextAction: "Record synthetic communication.",
    followUpAt: future(1),
  };
  detail = await offers.authorizeOffer(lead.id, offerId, approval, owner, now);
  detail = await offers.communicateOffer(lead.id, offerId, {
    version: detail.lead.version, amount: 110000, channel: "PHONE",
    evidence: "Synthetic human communication fixture; nothing was sent externally.",
    nextAction: "Await synthetic seller response.", followUpAt: future(1),
  }, operator, now);
  return { leadId: lead.id, offerId, detail };
}

async function request<T>(path: string, token: string, method = "GET", body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api${path}`, {
    method,
    headers: {
      "X-Seller-Offer-Token": token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  const value = await response.json() as T & { error?: string };
  return { response, value };
}

async function respond(token: string, input: Record<string, unknown>) {
  return request<SellerOfferPortal>("/portal/seller-offer/response", token, "POST", input);
}

async function exercise() {
  let serverStarted = false;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    serverStarted = true;

    const acceptance = await createCommunicatedOffer("accept");
    let current = await store.leadDetail(acceptance.leadId);
    await assert.rejects(
      portals.issueSellerOfferPortal(
        acceptance.leadId, acceptance.offerId, { version: current.lead.version }, operator, now,
      ),
      (error: unknown) => (error as { status?: number }).status === 403,
      "operators must not issue seller links",
    );
    const issued = await portals.issueSellerOfferPortal(
      acceptance.leadId, acceptance.offerId, { version: current.lead.version }, owner, now,
    );
    current = await store.leadDetail(acceptance.leadId);
    const rotated = await portals.issueSellerOfferPortal(
      acceptance.leadId, acceptance.offerId, { version: current.lead.version }, owner, now,
    );
    const control = await portals.getSellerOfferPortalControl(acceptance.leadId, acceptance.offerId, now);
    assert.equal(control.current?.id, rotated.portal.id);
    assert.equal(JSON.stringify(control).includes(rotated.token), false, "internal control must never return the raw capability");
    await assert.rejects(portals.getSellerOfferPortal(issued.token, now), (error: unknown) =>
      (error as { status?: number }).status === 410, "rotation must revoke the earlier capability");
    const expiredView = await portals.getSellerOfferPortal(
      rotated.token, new Date(Date.parse(rotated.portal.expiresAt) + 1),
    );
    assert.equal(expiredView.canRespond, false);
    assert.match(expiredView.unavailableReason ?? "", /expired/i);
    await assert.rejects(
      portals.respondToSellerOfferPortal(rotated.token, {
        eventKey: randomUUID(), action: "ACCEPTED", respondentName: "SYNTHETIC TEST RESPONDER",
      }, new Date(Date.parse(rotated.portal.expiresAt) + 1)),
      (error: unknown) => (error as { status?: number }).status === 410,
      "expired links must not record a response",
    );
    await assert.rejects(
      portals.issueSellerOfferPortal(
        acceptance.leadId, acceptance.offerId, { version: current.lead.version }, owner,
        new Date(Date.parse(rotated.portal.expiresAt) + 1),
      ),
      (error: unknown) => (error as { status?: number }).status === 409,
    );

    const get = await request<SellerOfferPortal>("/portal/seller-offer", rotated.token);
    assert.equal(get.response.status, 200, JSON.stringify(get.value));
    assert.equal(get.response.headers.get("cache-control"), "no-store");
    assert.equal(get.response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(get.value.snapshot.terms.amount, 110000);
    assert.equal(get.value.snapshot.terms.earnestMoney, 1000);
    assert.equal(get.value.snapshot.propertyAddress, acceptance.detail.lead.address);
    assert.equal(get.value.canRespond, true);
    assert.equal(JSON.stringify(get.value).includes(rotated.token), false);
    const transitionsBeforeResponse = (await db.select().from(transitionsTable)
      .where(eq(transitionsTable.leadId, acceptance.leadId))).length;

    const acceptanceInput = {
      eventKey: randomUUID(), action: "ACCEPTED", respondentName: "SYNTHETIC TEST RESPONDER",
      note: "Synthetic acceptance only.",
    };
    const accepted = await respond(rotated.token, acceptanceInput);
    assert.equal(accepted.response.status, 200, JSON.stringify(accepted.value));
    assert.equal(accepted.value.events.length, 1);
    assert.equal(accepted.value.events[0]?.action, "ACCEPTED");
    assert.equal(accepted.value.canRespond, false);
    const acceptedRetry = await respond(rotated.token, acceptanceInput);
    assert.equal(acceptedRetry.response.status, 200, "same event key and payload must be idempotent");
    assert.equal(acceptedRetry.value.events.length, 1);
    const changedRetry = await respond(rotated.token, {
      ...acceptanceInput, note: "Altered after recording.",
    });
    assert.equal(changedRetry.response.status, 409, "same key with changed intent must be rejected");
    const acceptanceAfter = await store.leadDetail(acceptance.leadId);
    assert.equal(acceptanceAfter.lead.stage, "NEGOTIATING");
    assert.match(acceptanceAfter.lead.nextAction, /Owner review/);
    assert.equal(acceptanceAfter.offers.find((offer) => offer.id === acceptance.offerId)?.amount, 110000);
    assert.equal(acceptanceAfter.offers.find((offer) => offer.id === acceptance.offerId)?.effectiveStatus, "COMMUNICATED");
    assert.equal((await db.select().from(contractsTable).where(eq(contractsTable.leadId, acceptance.leadId))).length, 0);
    assert.equal(
      (await db.select().from(transitionsTable).where(eq(transitionsTable.leadId, acceptance.leadId))).length,
      transitionsBeforeResponse + 1,
      "a seller response adds exactly one lifecycle event",
    );
    assert.equal((await db.select().from(sellerOfferPortalEventsTable)
      .where(eq(sellerOfferPortalEventsTable.portalId, rotated.portal.id))).length, 1);
    const acceptanceAudit = await db.select().from(auditTable)
      .where(and(eq(auditTable.entityId, acceptance.leadId), eq(auditTable.action, "SELLER_OFFER_PORTAL_RESPONSE")));
    assert.equal(acceptanceAudit.length, 1, "retry must not duplicate evidence or lifecycle transition");
    const currentAfterResponse = await store.leadDetail(acceptance.leadId);
    await assert.rejects(
      portals.issueSellerOfferPortal(acceptance.leadId, acceptance.offerId,
        { version: currentAfterResponse.lead.version }, owner, now),
      (error: unknown) => (error as { status?: number }).status === 409,
      "a new link must not reopen an offer that already has a seller response",
    );

    const rejection = await createCommunicatedOffer("reject");
    current = await store.leadDetail(rejection.leadId);
    const rejectionLink = await portals.issueSellerOfferPortal(
      rejection.leadId, rejection.offerId, { version: current.lead.version }, owner, now,
    );
    const rejected = await respond(rejectionLink.token, {
      eventKey: randomUUID(), action: "REJECTED", respondentName: "SYNTHETIC TEST RESPONDER",
      note: "Synthetic rejection only.",
    });
    assert.equal(rejected.response.status, 200, JSON.stringify(rejected.value));
    assert.equal(rejected.value.events[0]?.action, "REJECTED");
    assert.match((await store.leadDetail(rejection.leadId)).lead.nextAction, /rejection/i);

    const counter = await createCommunicatedOffer("counter");
    current = await store.leadDetail(counter.leadId);
    const counterLink = await portals.issueSellerOfferPortal(
      counter.leadId, counter.offerId, { version: current.lead.version }, owner, now,
    );
    const counterTerms = {
      amount: 125000, earnestMoney: 2500, closingDays: 45,
      contingencies: "Synthetic seller-proposed terms; owner review required.",
      assignmentIntent: false,
    };
    const countered = await respond(counterLink.token, {
      eventKey: randomUUID(), action: "COUNTERED", respondentName: "SYNTHETIC TEST RESPONDER",
      note: "Synthetic counter proposal only.", counterTerms,
    });
    assert.equal(countered.response.status, 200, JSON.stringify(countered.value));
    assert.deepEqual(countered.value.events[0]?.counterTerms, counterTerms);
    const counterAfter = await store.leadDetail(counter.leadId);
    const unchanged = counterAfter.offers.find((offer) => offer.id === counter.offerId)!;
    assert.equal(unchanged.amount, 110000);
    assert.equal(unchanged.maximumApprovedAcquisitionPrice, 120000);
    assert.equal(unchanged.effectiveStatus, "COMMUNICATED");
    assert.match(counterAfter.lead.nextAction, /authorize a new offer/i);
    assert.equal((await db.select().from(contractsTable).where(eq(contractsTable.leadId, counter.leadId))).length, 0);
    await assert.rejects(
      portals.respondToSellerOfferPortal(counterLink.token, {
        eventKey: randomUUID(), action: "COUNTERED", respondentName: "SYNTHETIC TEST RESPONDER",
      }),
      /counter proposal must include/i,
    );
    await assert.rejects(
      portals.respondToSellerOfferPortal(counterLink.token, {
        eventKey: randomUUID(), action: "ACCEPTED", respondentName: "SYNTHETIC TEST RESPONDER",
        counterTerms,
      }),
      /only a counter response/i,
    );

    logger.info({
      checks: "owner-only one-time issue, token secrecy, expiry, rotation and revocation, exact communicated snapshot, actual unauthenticated API GET/POST, accept/reject/counter evidence, owner-review-only lifecycle, immutable approved terms, no contract/signature, idempotent retry, conflicting replay rejection, no response-based link reopening",
    }, "Seller offer portal API and PostgreSQL exercise PASSED (isolated synthetic data; no real seller or external message)");
  } finally {
    if (serverStarted) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    if (leadIds.length) {
      await db.transaction(async (tx) => {
        await tx.delete(auditTable).where(inArray(auditTable.entityId, leadIds));
        await tx.delete(leadsTable).where(inArray(leadsTable.id, leadIds));
      });
    }
    await pool.end();
  }
}

exercise().catch((error: unknown) => {
  logger.error({ err: error }, "Seller offer portal exercise FAILED");
  process.exitCode = 1;
});
