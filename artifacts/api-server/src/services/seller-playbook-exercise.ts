/**
 * Persists a labeled synthetic conversation/playbook revision in the isolated DB
 * schema. It never creates or represents a real seller, call, offer, or outcome.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditTable, db, leadsTable, pool, sellerPlaybookRevisionsTable } from "@workspace/db";
import type { LeadInput } from "@workspace/deal-domain";
import { logger } from "../lib/logger";
import * as dealStore from "./deal-store";
import { getSellerPlaybook, updateSellerPlaybookEntry } from "./seller-playbook-store";

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
    const created = await dealStore.createLead(leadInput, actor, now);
    leadId = created.id;
    const beforeEvidence = await dealStore.leadDetail(leadId, db, now);
    const initial = await getSellerPlaybook(leadId);
    assert.ok(initial.entries.length >= 14);
    const reoGuidance = initial.entries.find((entry) => entry.slug === "evidence-backed-reo-offer-review");
    const followUpGuidance = initial.entries.find((entry) => entry.slug === "permission-aware-text-follow-up");
    assert.ok(reoGuidance?.content.operationalIntelligence);
    assert.equal(reoGuidance!.content.operationalIntelligence!.claimStatus, "EDUCATOR_CLAIM_NOT_PROJECT_VALIDATED");
    assert.ok(reoGuidance!.sourceProvenance.some((source) => source.author?.includes("Jerry Norton")
      && source.topic?.includes("REO") && source.accessContext));
    assert.ok(followUpGuidance?.content.operationalIntelligence);
    assert.equal(followUpGuidance!.content.operationalIntelligence!.claimStatus, "PUBLIC_DESCRIPTION_ONLY");
    assert.ok(followUpGuidance!.sourceProvenance.some((source) => source.author?.includes("Pace Morby")
      && source.topic?.includes("text") && source.scopeLimit.includes("not accessed")));
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
    const playbookAudits = await db.select().from(auditTable)
      .where(eq(auditTable.entityId, `seller-playbook:${matchedRelocation!.slug}`));
    assert.ok(playbookAudits.some((row) => row.action === "SELLER_PLAYBOOK_REVISED"));
    assert.ok(playbookAudits.some((row) => row.action === "SELLER_PLAYBOOK_SEEDED"));
    const revisions = await db.select().from(sellerPlaybookRevisionsTable)
      .where(eq(sellerPlaybookRevisionsTable.slug, matchedRelocation!.slug));
    assert.equal(revisions.length, 2);
    logger.info({
      synthetic: true,
      libraryEntries: initial.entries.length,
      sourceBackedOperationalEntries: [reoGuidance!.slug, followUpGuidance!.slug],
      realDealOutcomeValidation: "none",
      sellerEvidenceId: sellerEvidence.id,
      revisionVersions: revised.revisions.map((item) => item.version),
      staleEditRejected: true,
      leadEconomicsAndStageUnchanged: true,
      auditRows: playbookAudits.length,
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
