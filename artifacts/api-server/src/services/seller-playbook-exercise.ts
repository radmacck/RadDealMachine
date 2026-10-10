/**
 * Persists a labeled synthetic conversation/playbook revision in the isolated DB
 * schema. It never creates or represents a real seller, call, offer, or outcome.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditTable, db, leadsTable, offersTable, pool, sellerPlaybookRevisionsTable, membersTable } from "@workspace/db";
import type { LeadInput } from "@workspace/deal-domain";
import type { SellerPlaybookSource } from "@workspace/deal-domain";
import { logger } from "../lib/logger";
import * as dealStore from "./deal-store";
import { getSellerPlaybook, updateSellerPlaybookEntry } from "./seller-playbook-store";
import { dealOperations } from "./matching-store";
import dealsRouter from "../routes/deals";
import { membership } from "../middlewares/access";

type TestResponse = { locals: Record<string, string>; statusCode: number; body?: unknown; status(code: number): TestResponse; json(value: unknown): TestResponse };
type TestRequest = { params: Record<string, string>; body?: unknown };
type RouteLayer = { route?: { path?: string; methods?: Record<string, boolean>; stack: Array<{ handle(req: TestRequest, res: TestResponse, next: (error?: unknown) => void): unknown }> } };
type PlaybookEndpointEntry = { slug: string; sourceProvenance: SellerPlaybookSource[] };

async function invokePlaybookRoute(method: "get" | "put", path: string, role: string, actor: string, params: Record<string, string>, body?: unknown) {
  const layer = (dealsRouter as unknown as { stack: RouteLayer[] }).stack.find(item =>
    item.route?.path === path && item.route.methods?.[method]);
  assert.ok(layer?.route, `actual ${method.toUpperCase()} ${path} route is registered`);
  const req: TestRequest = { params, body };
  const res: TestResponse = {
    locals: { role, actor }, statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  for (const item of layer.route.stack) {
    let nextCalled = false;
    let nextError: unknown;
    await Promise.resolve(item.handle(req, res, error => { nextCalled = true; nextError = error; }));
    if (nextError) throw nextError;
    if (!nextCalled) break;
  }
  return res;
}

async function exerciseActualMembership(actor: string) {
  const req = {} as never;
  const res: TestResponse = {
    locals: { actor }, statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  let nextCalled = false;
  await Promise.resolve(membership(req, res as never, () => { nextCalled = true; }));
  return { res, nextCalled };
}

async function exercise() {
  const actor = `synthetic-playbook-exercise:${randomUUID()}`;
  const now = new Date();
  const leadInput: LeadInput = {
    address: `SYNTHETIC PLAYBOOK ${randomUUID()} Example Street`,
    city: "Synthetic City",
    state: "PA",
    county: "Synthetic County",
    zip: "19000",
    propertyType: "SINGLE_FAMILY",
    sqft: 1200,
    beds: 3,
    baths: 1,
    units: 1,
    askingPrice: 125000,
    sellerName: "SYNTHETIC ROLE-PLAY ONLY",
    sellerPhone: "000-000-0000",
    sellerDescription: "Synthetic exercise; not a real property or seller.",
    sellingReason: "No motivation fact provided.",
    source: "Synthetic persistence exercise only",
  };
  let leadId: string | null = null;
  try {
    await db.insert(membersTable).values([
      { id: "synthetic-playbook-owner", role: "OWNER" },
      { id: "synthetic-playbook-operator", role: "OPERATOR" },
      { id: "synthetic-playbook-pending", role: "PENDING" },
    ]);
    const created = await dealStore.createLead(leadInput, actor, now);
    leadId = created.id;
    const beforeEvidence = await dealStore.leadDetail(leadId, db, now);
    const offersBefore = await db.select({
      id: offersTable.id,
      status: offersTable.status,
      payload: offersTable.payload,
      updatedAt: offersTable.updatedAt,
    }).from(offersTable).where(eq(offersTable.leadId, leadId));
    const initial = await getSellerPlaybook(leadId);
    assert.ok(initial.entries.length >= 14);
    const reoGuidance = initial.entries.find((entry) => entry.slug === "evidence-backed-reo-offer-review");
    const followUpGuidance = initial.entries.find((entry) => entry.slug === "permission-aware-text-follow-up");
    assert.ok(reoGuidance?.content.operationalIntelligence);
    assert.equal(reoGuidance!.content.operationalIntelligence!.claimStatus, "EDUCATOR_CLAIM_NOT_PROJECT_VALIDATED");
    assert.ok(reoGuidance!.sourceProvenance.some((source) => source.author?.includes("Jerry Norton")
      && source.topic?.includes("REO") && source.accessContext));
    assert.ok(followUpGuidance?.content.operationalIntelligence);
    assert.equal(followUpGuidance!.content.operationalIntelligence!.claimStatus, "EDUCATOR_CLAIM_NOT_PROJECT_VALIDATED");
    assert.ok(followUpGuidance!.sourceProvenance.some((source) => source.author?.includes("Pace Morby")
      && source.url.endsWith("/Texting-Script.pdf")
      && source.materialType === "PUBLIC_PDF"
      && source.topic?.includes("text")
      && source.accessContext?.includes("without login, payment, or form submission")));
    const relocation = initial.entries.find((entry) => entry.slug === "relocation-or-deadline");
    assert.ok(relocation);
    assert.equal(relocation!.version, 1);
    assert.equal(relocation!.relevance.status, "GENERAL_QUESTION");
    assert.ok(relocation!.sourceProvenance.every((source) => source.url.startsWith("https://")));
    assert.equal(relocation!.revisions.length, 1);

    const sellerEvidence = await dealStore.addIntelligence(leadId, {
      classification: "INDICATED",
      category: "seller_call_motivation",
      statement: "SYNTHETIC ROLE-PLAY: seller reports moving for a new job; not independently verified.",
      source: "Synthetic role-play evidence; no real call occurred.",
      sourceType: "SELLER",
      confidence: 0.8,
      capturedAt: now.toISOString(),
      question: "Would you confirm whether any timing preference applies?",
      action: "Ask the seller; do not assume.",
    }, actor, now);

    const matched = await getSellerPlaybook(leadId);
    const matchedRelocation = matched.entries.find((entry) => entry.slug === "relocation-or-deadline");
    assert.ok(matchedRelocation);
    assert.equal(matchedRelocation!.relevance.status, "SELLER_REPORTED_TOPIC_TO_CONFIRM");
    assert.deepEqual(matchedRelocation!.relevance.evidenceRefs, [sellerEvidence.id]);
    assert.match(matchedRelocation!.relevance.reason, /not an independently verified fact/);
    assert.ok(matched.entries.find((entry) => entry.slug === "estate-or-inherited-property")!
      .relevance.status === "GENERAL_QUESTION");

    const beforeRevision = await dealStore.leadDetail(leadId, db, now);
    const currentContent = matchedRelocation!.content;
    const revised = await updateSellerPlaybookEntry(
      leadId,
      matchedRelocation!.slug,
      matchedRelocation!.version,
      "Synthetic exercise: clarify that timing is seller-reported.",
      {
        title: currentContent.title,
        hypothesis: "Synthetic exercise revision: a seller-reported move may make timing relevant; it remains unverified.",
        discoveryQuestions: currentContent.discoveryQuestions,
        empatheticResponse: currentContent.empatheticResponse,
        negotiationOptions: currentContent.negotiationOptions,
        followUpGuidance: currentContent.followUpGuidance,
        risks: currentContent.risks,
        escalationConditions: currentContent.escalationConditions,
        confirmingEvidence: currentContent.confirmingEvidence,
        refutingEvidence: currentContent.refutingEvidence,
        doNotPromise: currentContent.doNotPromise,
      },
      actor,
    );
    assert.equal(revised.version, 2);
    assert.equal(revised.revisions.length, 2);
    assert.equal(revised.revisions[0]?.version, 1);
    assert.equal(revised.revisions[1]?.version, 2);
    assert.equal(revised.relevance.status, "SELLER_REPORTED_TOPIC_TO_CONFIRM");
    assert.deepEqual(revised.sourceProvenance, matchedRelocation!.sourceProvenance);
    await assert.rejects(
      updateSellerPlaybookEntry(
        leadId,
        matchedRelocation!.slug,
        1,
        "Synthetic stale edit must fail",
        {
          title: currentContent.title,
          hypothesis: currentContent.hypothesis,
          discoveryQuestions: currentContent.discoveryQuestions,
          empatheticResponse: currentContent.empatheticResponse,
          negotiationOptions: currentContent.negotiationOptions,
          followUpGuidance: currentContent.followUpGuidance,
          risks: currentContent.risks,
          escalationConditions: currentContent.escalationConditions,
          confirmingEvidence: currentContent.confirmingEvidence,
          refutingEvidence: currentContent.refutingEvidence,
          doNotPromise: currentContent.doNotPromise,
        },
        actor,
      ),
      /changed in another session/,
    );

    const afterRevision = await dealStore.leadDetail(leadId, db, now);
    assert.equal(afterRevision.lead.stage, beforeRevision.lead.stage);
    assert.equal(afterRevision.lead.version, beforeRevision.lead.version);
    assert.equal(afterRevision.lead.askingPrice, beforeRevision.lead.askingPrice);
    assert.deepEqual(afterRevision.analysis, beforeRevision.analysis);
    const offersAfter = await db.select({
      id: offersTable.id,
      status: offersTable.status,
      payload: offersTable.payload,
      updatedAt: offersTable.updatedAt,
    }).from(offersTable).where(eq(offersTable.leadId, leadId));
    assert.deepEqual(offersAfter, offersBefore, "playbook read/revision must not create or change offer authority");
    const playbookAudits = await db.select().from(auditTable)
      .where(eq(auditTable.entityId, `seller-playbook:${matchedRelocation!.slug}`));
    assert.ok(playbookAudits.some((row) => row.action === "SELLER_PLAYBOOK_REVISED"));
    assert.ok(playbookAudits.some((row) => row.action === "SELLER_PLAYBOOK_SEEDED"));
    const revisions = await db.select().from(sellerPlaybookRevisionsTable)
      .where(eq(sellerPlaybookRevisionsTable.slug, matchedRelocation!.slug));
    assert.equal(revisions.length, 2);
    const initialCitationIdentity = matchedRelocation!.sourceProvenance.map(source => ({
      author: source.author, title: source.title, url: source.url, accessedAt: source.accessContext,
    }));
    const latestPersistedRevision = revisions.find(item => item.version === 2);
    assert.ok(latestPersistedRevision);
    assert.deepEqual(latestPersistedRevision!.sourceProvenance, matchedRelocation!.sourceProvenance,
      "revision table must retain exact citation identity and provenance");

    const ownerAccess = await exerciseActualMembership("synthetic-playbook-owner");
    assert.equal(ownerAccess.nextCalled, true);
    assert.equal(ownerAccess.res.locals.role, "OWNER");
    const ownerRead = await invokePlaybookRoute("get", "/leads/:id/seller-playbook", "OWNER",
      "synthetic-playbook-owner", { id: leadId });
    assert.equal(ownerRead.statusCode, 200);
    const operatorAccess = await exerciseActualMembership("synthetic-playbook-operator");
    assert.equal(operatorAccess.nextCalled, true);
    const operatorRead = await invokePlaybookRoute("get", "/leads/:id/seller-playbook", "OPERATOR",
      "synthetic-playbook-operator", { id: leadId });
    assert.equal(operatorRead.statusCode, 200);
    for (const response of [ownerRead, operatorRead]) {
      const result = response.body as { entries: PlaybookEndpointEntry[] };
      const citationSlug: string = matchedRelocation!.slug;
      const reloaded: PlaybookEndpointEntry | undefined = result.entries.find((entry: PlaybookEndpointEntry) => entry.slug === citationSlug);
      assert.ok(reloaded);
      assert.deepEqual(reloaded!.sourceProvenance.map(source => ({
        author: source.author, title: source.title, url: source.url, accessedAt: source.accessContext,
      })), initialCitationIdentity, "actual endpoint reload must retain citations");
    }
    const pendingAccess = await exerciseActualMembership("synthetic-playbook-pending");
    assert.equal(pendingAccess.nextCalled, false);
    assert.equal(pendingAccess.res.statusCode, 403, "membership gate must deny playbook reads");
    assert.deepEqual(pendingAccess.res.body, { error: "Your account needs workspace owner approval." });
    assert.equal("entries" in (pendingAccess.res.body as Record<string, unknown>), false,
      "denied membership response must not expose playbook citations");
    const operatorMutation = await invokePlaybookRoute("put", "/leads/:id/seller-playbook/:slug", "OPERATOR",
      "synthetic-playbook-operator", { id: leadId, slug: matchedRelocation!.slug }, {
        expectedVersion: 2, changeReason: "Synthetic unauthorized mutation",
        content: {
          title: currentContent.title, hypothesis: currentContent.hypothesis,
          discoveryQuestions: currentContent.discoveryQuestions, empatheticResponse: currentContent.empatheticResponse,
          negotiationOptions: currentContent.negotiationOptions, followUpGuidance: currentContent.followUpGuidance,
          risks: currentContent.risks, escalationConditions: currentContent.escalationConditions,
          confirmingEvidence: currentContent.confirmingEvidence, refutingEvidence: currentContent.refutingEvidence,
          doNotPromise: currentContent.doNotPromise,
        },
      });
    assert.equal(operatorMutation.statusCode, 403, "actual PUT endpoint must deny operators");
    const afterDeniedMutation = await db.select().from(sellerPlaybookRevisionsTable)
      .where(eq(sellerPlaybookRevisionsTable.slug, matchedRelocation!.slug));
    assert.equal(afterDeniedMutation.length, 2, "denied endpoint mutation must not create revision history");
    const ownerMutation = await invokePlaybookRoute("put", "/leads/:id/seller-playbook/:slug", "OWNER",
      "synthetic-playbook-owner", { id: leadId, slug: matchedRelocation!.slug }, {
        expectedVersion: 2, changeReason: "Synthetic owner endpoint revision",
        content: {
          title: currentContent.title, hypothesis: currentContent.hypothesis,
          discoveryQuestions: currentContent.discoveryQuestions, empatheticResponse: currentContent.empatheticResponse,
          negotiationOptions: currentContent.negotiationOptions, followUpGuidance: currentContent.followUpGuidance,
          risks: currentContent.risks, escalationConditions: currentContent.escalationConditions,
          confirmingEvidence: currentContent.confirmingEvidence, refutingEvidence: currentContent.refutingEvidence,
          doNotPromise: currentContent.doNotPromise,
        },
      });
    assert.equal(ownerMutation.statusCode, 200, "actual PUT endpoint must allow owner revision");
    const ownerReload = await invokePlaybookRoute("get", "/leads/:id/seller-playbook", "OWNER",
      "synthetic-playbook-owner", { id: leadId });
    const ownerReloadBody = ownerReload.body as { entries: Array<{ slug: string; version: number; sourceProvenance: typeof matchedRelocation.sourceProvenance }> };
    const reloadedRevision = ownerReloadBody.entries.find(entry => entry.slug === matchedRelocation!.slug);
    assert.equal(reloadedRevision?.version, 3);
    assert.deepEqual(reloadedRevision?.sourceProvenance.map(source => ({
      author: source.author, title: source.title, url: source.url, accessedAt: source.accessContext,
    })), initialCitationIdentity);
    const finalRevisions = await db.select().from(sellerPlaybookRevisionsTable)
      .where(eq(sellerPlaybookRevisionsTable.slug, matchedRelocation!.slug));
    assert.equal(finalRevisions.length, 3);
    assert.deepEqual(finalRevisions.find(item => item.version === 3)?.sourceProvenance,
      matchedRelocation!.sourceProvenance, "owner endpoint revision must preserve citation provenance");
    const finalAudits = await db.select().from(auditTable)
      .where(eq(auditTable.entityId, `seller-playbook:${matchedRelocation!.slug}`));
    assert.equal(finalAudits.filter(item => item.action === "SELLER_PLAYBOOK_REVISED").length, 2);
    assert.equal(finalAudits.filter(item => item.action === "SELLER_PLAYBOOK_SEEDED").length, 1);
    const persistedDealOps = await dealOperations(leadId, now);
    assert.equal(persistedDealOps.matches.length, 0, "isolated workspace has no buyer evidence; no synthetic approved buyer may appear");
    assert.equal(persistedDealOps.contract, null);
    logger.info({
      synthetic: true,
      libraryEntries: initial.entries.length,
      sourceBackedOperationalEntries: [reoGuidance!.slug, followUpGuidance!.slug],
      realDealOutcomeValidation: "none",
      offerAuthorityUnchanged: true,
      sellerEvidenceId: sellerEvidence.id,
      revisionVersions: revised.revisions.map((item) => item.version),
      staleEditRejected: true,
      leadEconomicsAndStageUnchanged: true,
      auditRows: playbookAudits.length,
      endpointAuthorization: { ownerRead: ownerRead.statusCode, operatorRead: operatorRead.statusCode,
        pendingRead: pendingAccess.res.statusCode, operatorPut: operatorMutation.statusCode, ownerPut: ownerMutation.statusCode },
      citationIdentityPreservedAcrossRevisionAndReload: true,
      ownerEndpointRevisionVersion: reloadedRevision?.version,
      revisionRows: finalRevisions.length,
      auditEvents: finalAudits.length,
      persistedDealOpsMatches: persistedDealOps.matches.length,
      dealNextAction: persistedDealOps.nextAction,
    }, "Seller playbook persisted exercise PASSED (synthetic only)");
  } finally {
    if (leadId) {
      await db.transaction(async (tx) => {
        await tx.delete(leadsTable).where(eq(leadsTable.id, leadId!));
        await tx.delete(auditTable).where(and(eq(auditTable.entityId, leadId!), eq(auditTable.actor, actor)));
      });
      const remaining = await db.execute(sql`select count(*)::int as count from re_leads where id=${leadId}::uuid`);
      assert.equal(remaining.rows[0]?.count, 0);
    }
    await pool.end();
  }
}

exercise().catch((error) => {
  logger.error({ err: error }, "Seller playbook persisted exercise FAILED");
  process.exitCode = 1;
});
