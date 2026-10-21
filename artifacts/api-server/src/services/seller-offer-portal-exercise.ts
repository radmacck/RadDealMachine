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
import { authorizeReviewedOffer } from "./offer-exercise-helpers";
import * as portals from "./seller-offer-portals";
import { exerciseEvidence } from "./exercise-evidence";
import { assertSyntheticCallReadyBlocked, seedSyntheticPostGateContacted } from "./synthetic-post-gate-fixture";

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
  await assertSyntheticCallReadyBlocked(lead.id, actorId, now);
  logger.info("EXPECTED SECURITY BLOCK: CALL_READY returned 409; portal downstream checks use a separate synthetic post-gate fixture.");
  detail = await seedSyntheticPostGateContacted(lead.id, actorId, now);
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
  detail = await authorizeReviewedOffer(lead.id, offerId, approval, owner, now);
  detail = await offers.communicateOffer(lead.id, offerId, {
    version: detail.lead.version, amount: 110000, channel: "PHONE",
    evidence: "Synthetic human communication fixture; nothing was sent externally.",
    nextAction: "Await synthetic seller response.", followUpAt: future(1),
  }, operator, now);
  return { leadId: lead.id, offerId, detail, identityEvidenceId: evidence.id };
}

const issueInput = (version: number, identityEvidenceId: string) => ({
  version,
  identityEvidenceId,
  verificationDeliveryMethod: "PHONE" as const,
  verificationNote: "SYNTHETIC only: owner will call the verified exercise seller contact separately.",
});

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
        acceptance.leadId, acceptance.offerId, issueInput(current.lead.version, acceptance.identityEvidenceId), operator, now,
      ),
      (error: unknown) => (error as { status?: number }).status === 403,
      "operators must not issue seller links",
    );
    const issued = await portals.issueSellerOfferPortal(
      acceptance.leadId, acceptance.offerId, issueInput(current.lead.version, acceptance.identityEvidenceId), owner, now,
    );
    current = await store.leadDetail(acceptance.leadId);
    const rotated = await portals.issueSellerOfferPortal(
      acceptance.leadId, acceptance.offerId, issueInput(current.lead.version, acceptance.identityEvidenceId), owner, now,
    );
    const control = await portals.getSellerOfferPortalControl(acceptance.leadId, acceptance.offerId, now);
    assert.equal(control.current?.id, rotated.portal.id);
    assert.equal(JSON.stringify(control).includes(rotated.token), false, "internal control must never return the raw capability");
    assert.equal(JSON.stringify(control).includes(rotated.verificationCode), false, "internal control must not return the one-time code again");
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
        verificationCode: rotated.verificationCode,
      }, new Date(Date.parse(rotated.portal.expiresAt) + 1)),
      (error: unknown) => (error as { status?: number }).status === 410,
      "expired links must not record a response",
    );
    await assert.rejects(
      portals.issueSellerOfferPortal(
        acceptance.leadId, acceptance.offerId, issueInput(current.lead.version, acceptance.identityEvidenceId), owner,
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
    assert.equal(get.value.snapshot.identityVerificationRequired, true);
    assert.equal(get.value.snapshot.verificationDeliveryMethod, "PHONE");
    assert.equal(get.value.canRespond, true);
    assert.equal(JSON.stringify(get.value).includes(rotated.token), false);
    assert.equal(JSON.stringify(get.value).includes(rotated.verificationCode), false, "public portal must never disclose the one-time code");
    assert.equal(JSON.stringify(get.value).includes("codeHash"), false, "public portal must never disclose verifier metadata");
    const transitionsBeforeResponse = (await db.select().from(transitionsTable)
      .where(eq(transitionsTable.leadId, acceptance.leadId))).length;

    const acceptanceInput = {
      eventKey: randomUUID(), action: "ACCEPTED", respondentName: "SYNTHETIC TEST RESPONDER",
      note: "Synthetic acceptance only.",
    };
    current = await store.leadDetail(acceptance.leadId);
    await assert.rejects(
      portals.issueSellerOfferPortal(
        acceptance.leadId, acceptance.offerId,
        issueInput(current.lead.version, randomUUID()), owner, now,
      ),
      (error: unknown) => (error as { status?: number }).status === 409,
      "owner must bind the seller link to verified same-lead authority evidence",
    );
    const wrongCode = rotated.verificationCode === "000000" ? "000001" : "000000";
    const wrongCodeResponse = await respond(rotated.token, { ...acceptanceInput, verificationCode: wrongCode });
    assert.equal(wrongCodeResponse.response.status, 401);
    assert.equal((await db.select().from(sellerOfferPortalEventsTable)
      .where(eq(sellerOfferPortalEventsTable.portalId, rotated.portal.id))).length, 0,
    "wrong code must not create a response event");
    assert.equal((await store.leadDetail(acceptance.leadId)).lead.stage, acceptance.detail.lead.stage,
      "wrong code must not advance the deal");
    const accepted = await respond(rotated.token, { ...acceptanceInput, verificationCode: rotated.verificationCode });
    assert.equal(accepted.response.status, 200, JSON.stringify(accepted.value));
    assert.equal(accepted.value.events.length, 1);
    assert.equal(accepted.value.events[0]?.action, "ACCEPTED");
    assert.equal(accepted.value.events[0]?.identityVerification, "VERIFIED_ONE_TIME_CODE");
    assert.ok(accepted.value.events[0]?.identityVerifiedAt);
    assert.equal(accepted.value.canRespond, false);
    const acceptedRetry = await respond(rotated.token, { ...acceptanceInput, verificationCode: "000000" });
    assert.equal(acceptedRetry.response.status, 200, "same event key and payload must be idempotent");
    assert.equal(acceptedRetry.value.events.length, 1);
    const changedRetry = await respond(rotated.token, {
      ...acceptanceInput, verificationCode: "000000", note: "Altered after recording.",
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
        issueInput(currentAfterResponse.lead.version, acceptance.identityEvidenceId), owner, now),
      (error: unknown) => (error as { status?: number }).status === 409,
      "a new link must not reopen an offer that already has a seller response",
    );

    const rejection = await createCommunicatedOffer("reject");
    current = await store.leadDetail(rejection.leadId);
    const rejectionLink = await portals.issueSellerOfferPortal(
      rejection.leadId, rejection.offerId, issueInput(current.lead.version, rejection.identityEvidenceId), owner, now,
    );
    const rejected = await respond(rejectionLink.token, {
      eventKey: randomUUID(), action: "REJECTED", respondentName: "SYNTHETIC TEST RESPONDER",
      note: "Synthetic rejection only.", verificationCode: rejectionLink.verificationCode,
    });
    assert.equal(rejected.response.status, 200, JSON.stringify(rejected.value));
    assert.equal(rejected.value.events[0]?.action, "REJECTED");
    assert.match((await store.leadDetail(rejection.leadId)).lead.nextAction, /rejection/i);

    const counter = await createCommunicatedOffer("counter");
    current = await store.leadDetail(counter.leadId);
    const counterLink = await portals.issueSellerOfferPortal(
      counter.leadId, counter.offerId, issueInput(current.lead.version, counter.identityEvidenceId), owner, now,
    );
    const counterTerms = {
      amount: 125000, earnestMoney: 2500, closingDays: 45,
      contingencies: "Synthetic seller-proposed terms; owner review required.",
      assignmentIntent: false,
    };
    const countered = await respond(counterLink.token, {
      eventKey: randomUUID(), action: "COUNTERED", respondentName: "SYNTHETIC TEST RESPONDER",
      note: "Synthetic counter proposal only.", counterTerms, verificationCode: counterLink.verificationCode,
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
        verificationCode: counterLink.verificationCode,
      }),
      /counter proposal must include/i,
    );
    await assert.rejects(
      portals.respondToSellerOfferPortal(counterLink.token, {
        eventKey: randomUUID(), action: "ACCEPTED", respondentName: "SYNTHETIC TEST RESPONDER",
        counterTerms, verificationCode: counterLink.verificationCode,
      }),
      /only a counter response/i,
    );

    const staleCase = await createCommunicatedOffer("stale");
    current = await store.leadDetail(staleCase.leadId);
    const staleLink = await portals.issueSellerOfferPortal(
      staleCase.leadId, staleCase.offerId, issueInput(current.lead.version, staleCase.identityEvidenceId), owner, now,
    );
    current = await store.leadDetail(staleCase.leadId);
    await offers.withdrawOffer(staleCase.leadId, staleCase.offerId, {
      version: current.lead.version,
      reason: "Synthetic stale-offer guard exercise.",
      nextAction: "Review a newly authorized offer.",
      followUpAt: future(1),
    }, owner, now);
    const staleView = await portals.getSellerOfferPortal(staleLink.token, now);
    assert.equal(staleView.canRespond, false);
    assert.match(staleView.unavailableReason ?? "", /no longer current/i);
    const staleResponse = await respond(staleLink.token, {
      eventKey: randomUUID(), action: "ACCEPTED", respondentName: "SYNTHETIC TEST RESPONDER",
      verificationCode: staleLink.verificationCode,
    });
    assert.equal(staleResponse.response.status, 409, "a withdrawn offer cannot be accepted through a stale link");
    assert.equal((await db.select().from(sellerOfferPortalEventsTable)
      .where(eq(sellerOfferPortalEventsTable.portalId, staleLink.portal.id))).length, 0);

    const lockCase = await createCommunicatedOffer("lock");
    current = await store.leadDetail(lockCase.leadId);
    const lockLink = await portals.issueSellerOfferPortal(
      lockCase.leadId, lockCase.offerId, issueInput(current.lead.version, lockCase.identityEvidenceId), owner, now,
    );
    const rejectedCode = lockLink.verificationCode === "999999" ? "999998" : "999999";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await respond(lockLink.token, {
        eventKey: randomUUID(), action: "REJECTED", respondentName: "SYNTHETIC TEST RESPONDER",
        verificationCode: rejectedCode,
      });
      assert.equal(failed.response.status, attempt === 4 ? 429 : 401);
      assert.equal((await db.select().from(sellerOfferPortalEventsTable)
        .where(eq(sellerOfferPortalEventsTable.portalId, lockLink.portal.id))).length, 0);
    }
    const lockedView = await portals.getSellerOfferPortal(lockLink.token, now);
    assert.equal(lockedView.canRespond, false);
    assert.match(lockedView.unavailableReason ?? "", /locked/i);
    const lockedSnapshot = await db.select().from(sellerOfferPortalEventsTable)
      .where(eq(sellerOfferPortalEventsTable.portalId, lockLink.portal.id));
    assert.equal(lockedSnapshot.length, 0, "failed code attempts cannot create seller responses");
    const failedCodeAudit = await db.select().from(auditTable)
      .where(and(
        eq(auditTable.entityId, lockCase.leadId),
        eq(auditTable.action, "SELLER_OFFER_PORTAL_VERIFICATION_FAILED"),
      ));
    assert.equal(failedCodeAudit.length, 5, "each failed challenge must be auditable without storing the code");
    current = await store.leadDetail(lockCase.leadId);
    const recoveredLink = await portals.issueSellerOfferPortal(
      lockCase.leadId, lockCase.offerId, issueInput(current.lead.version, lockCase.identityEvidenceId), owner, now,
    );
    assert.equal(recoveredLink.portal.canRespond, true, "owner rotation must recover a locked challenge");
    await assert.rejects(
      portals.getSellerOfferPortal(lockLink.token, now),
      (error: unknown) => (error as { status?: number }).status === 410,
    );

    logger.info({
      checks: "owner-only issue bound to fresh authority evidence, token and code secrecy, phone/in-person challenge, five-attempt lock and owner recovery, expiry, rotation/revocation, exact communicated snapshot, actual unauthenticated API GET/POST, accept/reject/counter evidence, owner-review-only lifecycle, immutable approved terms, no contract/signature, idempotent retry, conflicting replay rejection, no response-based link reopening",
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
