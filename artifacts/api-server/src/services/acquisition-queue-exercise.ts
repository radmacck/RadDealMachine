import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, auditTable, callsTable, intelligenceTable, leadsTable, pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as store from "./deal-store";
import { exerciseEvidence } from "./exercise-evidence";
import { acquisitionQueue, recordQueueSelection, startCallSession } from "./acquisition-queue-store";
import { recordSellerContactObservation } from "./seller-contact-store";
import { buildCallBrief, editSellerConversationField, extractSellerConversationFields, type UnderwritingInput } from "@workspace/deal-domain";

const actor = `SYNTHETIC acquisition queue exercise ${randomUUID()}`;
const now = new Date("2026-10-08T15:00:00.000Z");
const owner = { id: actor, role: "OWNER" as const };
const future = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
const ids: string[] = [];

function qualification(discoveryId: string) {
  return {
    discoveryId,
    status: "QUALIFIED_LEAD" as const,
    score: 72,
    confidence: 0.78,
    criteriaVersion: 1,
    reviewReason: "SYNTHETIC exercise fixture; no real seller or property.",
    qualifiedBy: actor,
    qualifiedAt: now.toISOString(),
    reason: "Synthetic indicated seller-timing evidence plus an independent synthetic public-record context signal.",
    signals: [{
      id: `synthetic-signal-${discoveryId}`,
      key: "SELLER_MOTIVATION" as const,
      group: "MOTIVATION" as const,
      classification: "INDICATED" as const,
      sourceType: "SELLER" as const,
      statement: "SYNTHETIC fixture: seller's stated timing; not a real statement.",
      source: "SYNTHETIC isolated queue exercise",
      sourceUrl: "https://example.invalid/synthetic-seller-answer",
      evidenceRef: `synthetic:${discoveryId}:seller-answer`,
      capturedAt: now.toISOString(),
      confidence: 0.78,
      scoreContribution: 24,
    }],
    missingInformation: ["Seller identity and signing authority remain unverified."],
    nextAction: "Ask the seller to confirm identity, authority, condition, and timing.",
  };
}

async function createFixture(label: string, directPhone?: string) {
  const lead = await store.createLead({
    address: `SYNTHETIC ${label} ${randomUUID().slice(0, 8)} Example Lane`,
    city: "Synthetic City", state: "TX", county: "Synthetic County", zip: "75001",
    propertyType: "SINGLE_FAMILY", sqft: 1000, beds: 3, baths: 2, units: 1,
    askingPrice: null, sellerName: "SYNTHETIC exercise owner", sellerPhone: directPhone ?? "",
    sellerDescription: "SYNTHETIC exercise condition statement; not a real property fact.",
    sellingReason: "SYNTHETIC exercise statement; not a real seller motivation.",
    source: "SYNTHETIC isolated acquisition queue exercise",
    nextAction: "SYNTHETIC exercise only; no real seller contact.",
  }, actor, now);
  ids.push(lead.id);
  const [row] = await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id));
  if (!row) throw new Error("Synthetic acquisition lead fixture did not persist.");
  await db.update(leadsTable).set({
    payload: {
      ...row.payload,
      propertyQualification: qualification(randomUUID()),
    } as typeof row.payload,
  }).where(eq(leadsTable.id, lead.id));
  return lead.id;
}

async function addPhoneEvidence(id: string, routeValue: string, recipient: string, sourceId: string, capturedAt = now, freshUntilAt = future(30)) {
  const detail = await store.leadDetail(id);
  return recordSellerContactObservation(id, {
    version: detail.lead.version,
    channel: "PHONE",
    routeValue,
    recipient,
    recipientRole: "RECORDED_OWNER",
    classification: "OBSERVED",
    confidence: 0.9,
    sourceType: "SELLER",
    sourceId,
    sourceName: "SYNTHETIC contact-route fixture; not a real provider",
    sourceRecordId: `SYNTHETIC-${id}-${sourceId}`,
    sourceUrl: "https://example.invalid/synthetic-contact",
    capturedAt: capturedAt.toISOString(),
    freshUntilAt,
    permissionStatus: "PERMITTED",
    contactPermissionEvidenceUrl: "https://example.invalid/synthetic-permission",
    routeVerificationStatus: "CONFIRMED",
    verificationNote: "SYNTHETIC only; no real person and no communication occurred.",
  }, owner, now);
}

async function createPostalEvidence(id: string) {
  const postal = {
    id: `synthetic-postal-${id}`,
    channel: "POSTAL",
    recipient: "SYNTHETIC recorded owner",
    routeValue: null,
    addressLines: ["100 SYNTHETIC EXAMPLE LANE"],
    cityState: "Synthetic City, TX",
    postalCode: "75001",
    classification: "OBSERVED",
    confidence: 0.7,
    sourceId: "synthetic-public-record",
    sourceName: "SYNTHETIC public-record fixture",
    sourceRecordId: `SYNTHETIC-POSTAL-${id}`,
    sourceUrl: "https://example.invalid/synthetic-property-record",
    capturedAt: now.toISOString(),
    freshUntilAt: future(30),
    freshnessStatus: "CURRENT",
    permissionStatus: "NOT_REVIEWED",
    contactPermissionEvidenceUrl: null,
    permissionReviewedAt: null,
    sourceType: "PUBLIC_RECORD",
    recipientRole: "RECORDED_OWNER",
    routeVerificationStatus: "UNREVIEWED",
    routeReviewedAt: null,
    verificationNote: "SYNTHETIC mailing-address-only fixture; not a phone or email route.",
    identityStatus: "UNVERIFIED",
    signingAuthorityStatus: "NOT_ESTABLISHED",
  };
  await db.insert(intelligenceTable).values({
    id: randomUUID(),
    leadId: id,
    createdBy: actor,
    createdAt: now,
    payload: {
      category: "seller_contact",
      classification: "OBSERVED",
      sourceType: "PUBLIC_RECORD",
      statement: "SYNTHETIC mailing address only; no direct seller contact route.",
      source: "SYNTHETIC public-record fixture",
      sourceUrl: "https://example.invalid/synthetic-property-record",
      confidence: 0.7,
      capturedAt: now.toISOString(),
      contactPath: postal,
    },
  });
}

async function saveSyntheticUnderwriting(id: string) {
  let detail = await store.leadDetail(id);
  const soldAt = new Date(now.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
  let input: UnderwritingInput = {
    version: detail.lead.version,
    conditionConfirmed: true,
    repairsComplete: true,
    comps: [290000, 300000, 310000].map((salePrice, index) => ({
      id: `synthetic-comp-${index}`,
      address: `SYNTHETIC COMP ${index} Example Lane`,
      salePrice,
      sqft: 1000,
      soldAt,
      distanceMiles: 0.5,
      propertyType: "SINGLE_FAMILY",
      condition: "RENOVATED",
      source: "SYNTHETIC comp exercise; not a real sale",
      verified: true,
    })),
    repairs: [{ category: "SYNTHETIC repair scope", low: 10000, expected: 20000, high: 30000, confidence: 0.8, source: "SYNTHETIC estimate; no real inspection." }],
  };
  input = await exerciseEvidence(id, input, actor, now);
  detail = await store.saveUnderwriting(id, input, actor, now);
  if (!detail.allowedTransitions.includes("CALL_READY")) {
    throw new Error("Synthetic policy did not permit the exercised CALL_READY transition.");
  }
  return store.transitionLead(id, {
    version: detail.lead.version,
    to: "CALL_READY",
    reason: "SYNTHETIC queue exercise: current direct-route, relevance, and underwriting gates reviewed.",
    nextAction: "Ask the seller the persisted call-brief questions; no call was placed.",
  }, actor, now);
}

try {
  // Positive persisted vertical flow: source-labelled synthetic qualification,
  // condition/comps evidence, current direct route, guarded stage transition.
  const callableId = await createFixture("CALLABLE", "000-000-0000");
  const callable = await saveSyntheticUnderwriting(callableId);
  const callableItem = (await acquisitionQueue("OWNER", now)).items.find(item => item.lead.id === callableId);
  assert.equal(callableItem?.decision, "CALL_NEXT");
  assert.equal(callableItem?.blockerCode, null);
  assert.equal(callableItem?.contactReadiness.directRouteStatus, "PHONE_ROUTE_AVAILABLE");
  assert.equal(callableItem?.contactReadiness.selectedPhonePath?.signingAuthorityStatus, "NOT_ESTABLISHED");
  assert.ok(callableItem?.contactReadiness.selectedPhonePath?.sourceUrl,
    "Call packet contact evidence retains a source link.");
  assert.ok(callableItem?.contactReadiness.selectedPhonePath?.capturedAt,
    "Call packet contact evidence retains its observed timestamp.");
  const packetVerified=callableItem?.callBrief?.intelligence.find(item=>item.classification==="VERIFIED_FACTS");
  assert.ok(packetVerified?.source && packetVerified.sourceUrl,
    "Verified property facts in the call packet retain their source and source URL.");
  assert.ok(callableItem?.callBrief?.intelligence.every(item=>
    item.sourceType!=="MODEL"||item.classification==="AI_HYPOTHESIS"),
    "Any model-derived note remains explicitly labeled as an AI hypothesis, never a verified fact.");
  assert.ok(callableItem?.callBrief?.questions.length && callableItem.callBrief.questions.length >= 3 && callableItem.callBrief.questions.length <= 5);
  assert.ok(callableItem?.rankingReason.includes("INDICATED"));
  assert.ok(callableItem?.rankingReason.includes("AI hypotheses score zero"));

  const selection = await recordQueueSelection(callableId, callable.lead.version, actor, "OWNER", now);
  assert.equal(selection.event, "QUEUE_SELECTED");
  assert.throws(
    () => startCallSession(callableId, callable.lead.version, actor, "VIEWER", now),
    /Only an owner or operator/,
    "Viewer role cannot start call work.",
  );
  const session = await startCallSession(callableId, callable.lead.version, actor, "OWNER", now);
  assert.equal(session.event, "CALL_SESSION_STARTED");
  const sessionReplay = await startCallSession(callableId, callable.lead.version, actor, "OWNER", new Date(now.getTime()+1000));
  assert.deepEqual(sessionReplay,session,"An uncertain client retry returns the persisted call-session event.");
  const sessionAudit=await db.select().from(auditTable).where(eq(auditTable.action,"CALL_SESSION_STARTED"));
  assert.equal(sessionAudit.filter(event=>event.entityId===callableId&&event.actor===actor).length,1,
    "Retrying call readiness does not duplicate the audit event.");
  const analysisBeforeCall = structuredClone(callable.analysis);
  await db.insert(intelligenceTable).values({
    leadId: callableId,
    payload: {
      classification: "OBSERVED",
      category: "public_condition_roof",
      statement: "SYNTHETIC inspection reports no active roof leak; not a real inspection.",
      source: "SYNTHETIC inspection fixture",
      sourceType: "INSPECTION",
      confidence: 0.8,
      capturedAt: now.toISOString(),
      sourceUrl: "https://example.invalid/synthetic-inspection",
    },
    createdBy: actor,
    createdAt: now,
  });
  const callInput: import("@workspace/api-zod").CallInput = {
    version: callable.lead.version,
    idempotencyKey: `synthetic-call:${callableId}`,
    occurredAt: now.toISOString(),
    outcome: "CONNECTED" as const,
    notes: "SYNTHETIC seller conversation fixture; seller said to call back next week; no real call occurred.",
    nextAction: "SYNTHETIC follow-up only; ask about timeline.",
    followUpAt: future(1),
    structuredFieldsJson: JSON.stringify(extractSellerConversationFields("SYNTHETIC seller conversation fixture; seller said to call back next week; no real call occurred.")
      .map(field => editSellerConversationField(field, `${field.value} (operator edit)`))),
    sellerAnswers: {
      motivationStatement: "SYNTHETIC: selling because of relocation; not a real statement.",
      conditionDescription: "SYNTHETIC seller states roof leaks; not inspected and not a real statement.",
      conditionByCategory: [{ category: "ROOF", statement: "SYNTHETIC roof leak; not inspected." }],
      timing: "SYNTHETIC response: 30 days.",
      askingPrice: 125000,
      nextStepOutcome: "SYNTHETIC: provide documents for review.",
    },
  };
  await assert.rejects(store.recordCall(callableId, {
    ...callInput, followUpAt: now.toISOString(),
  }, actor, now), /valid future date/);
  const call = await store.recordCall(callableId, callInput, actor, now);
  assert.equal(call.analysis, null, "Material seller statements invalidate the live analysis pointer rather than silently changing its economics.");
  assert.equal(call.analysisSnapshotId, null);
  assert.equal(call.calls[0]?.analysisInvalidated, true);
  assert.ok(analysisBeforeCall, "The prior immutable synthetic analysis existed before the call.");
  assert.equal(call.calls.length, 1);
  assert.equal(call.calls[0]?.evidenceSource, "OPERATOR_ENTERED_SELLER_CONVERSATION");
  assert.equal(call.calls[0]?.evidenceClassification, "INDICATED");
  assert.equal(call.calls[0]?.sellerAnswersCapturedAt, now.toISOString());
  assert.deepEqual(call.underwriting, callable.underwriting, "Structured extraction cannot rewrite deterministic underwriting inputs.");
  assert.equal(call.lead.followUpAt,future(1),"Connected-call outcome persists its explicit follow-up deadline.");
  assert.ok(call.intelligence.some(item=>item.sourceRecordId===call.calls[0]?.id&&item.classification==="INDICATED"),
    "Seller-entered outcome evidence links back to its call record and remains indicated.");
  const recordedAudit=await db.select().from(auditTable).where(eq(auditTable.entityId,callableId));
  assert.ok(recordedAudit.some(item=>item.action==="CALL_RECORDED"&&item.detail.includes("follow-up")),
    "Outcome-to-follow-up handoff is auditable.");
  const persistedCaptureRow = (await db.select().from(callsTable).where(eq(callsTable.leadId, callableId)))[0];
  const savedCapture = JSON.parse(String((persistedCaptureRow?.payload as Record<string, unknown> | undefined)?.structuredFieldsJson));
  assert.ok(savedCapture.some((field: {field: string; attribution: string; sourceQuote: string; sourceStart: number; sourceEnd: number}) =>
    field.field === "FOLLOW_UP" && field.attribution === "SELLER_REPORTED" &&
    callInput.notes.slice(field.sourceStart, field.sourceEnd) === field.sourceQuote));
  const captureAudit = await db.select().from(auditTable).where(eq(auditTable.entityId, callableId));
  assert.ok(captureAudit.some(entry => entry.action === "SELLER_CONVERSATION_FIELDS_CAPTURED" &&
    entry.detail.includes('"underwritingChanged":false')));
  const editedCaptureAudit = captureAudit.find(entry => entry.action === "SELLER_CONVERSATION_FIELDS_CAPTURED");
  assert.ok(editedCaptureAudit);
  const editAuditPayload = JSON.parse(editedCaptureAudit.detail) as { fieldKeys: string[]; editedFields: string[] };
  assert.ok(editAuditPayload.editedFields.length > 0 && editAuditPayload.editedFields.every(field => editAuditPayload.fieldKeys.includes(field)));
  const reloadedAfterCall = await store.leadDetail(callableId, db, now);
  assert.equal(reloadedAfterCall.calls.length, 1, "Persisted call appears after reloading its lead.");
  assert.equal(reloadedAfterCall.calls[0]?.notes, callInput.notes, "Persisted human-entered notes reload byte-for-byte.");
  assert.equal(reloadedAfterCall.calls[0]?.occurredAt, now.toISOString(), "The operator-entered actual call timestamp is retained.");
  const replay = await store.recordCall(callableId, callInput, actor, now);
  assert.equal(replay.calls.length, 1, "An exact network replay with the same key does not create a duplicate call.");
  await assert.rejects(store.recordCall(callableId, {
    ...callInput, notes: "SYNTHETIC altered replay with same idempotency key.",
  }, actor, now), /already used for different content/);
  await assert.rejects(store.recordCall(callableId, {
    ...callInput, idempotencyKey: `synthetic-stale:${callableId}`,
  }, actor, now), /changed in another session/);
  const callEvidence = call.intelligence.filter(item => item.sourceRecordId === call.calls[0]?.id);
  assert.equal(callEvidence.length, call.calls[0]?.evidenceIds?.length ?? 0);
  assert.ok(callEvidence.some(item => item.category === "seller_call_asking_price" && item.statement.includes("$125,000")));
  assert.ok(callEvidence.every(item => item.classification === "INDICATED" && item.sourceType === "SELLER"));
  assert.ok(callEvidence.some(item => item.reconciliation?.state === "CONFLICT_REVIEW"),
    "Contradictory synthetic roof evidence is retained and marked for review.");
  assert.equal(call.lead.sellerDescription, callable.lead.sellerDescription,
    "Operator statements append to the call record and do not overwrite the sourced seller/property narrative.");
  assert.equal(call.lead.askingPrice, callable.lead.askingPrice,
    "Seller-reported asking price remains evidence and is not copied into property facts or economics.");
  assert.ok(call.lead.propertyQualification?.signals.some(signal =>
    signal.key === "SELLER_MOTIVATION" && signal.classification === "INDICATED"));
  assert.ok(call.lead.propertyQualification?.signals.some(signal =>
    signal.key === "REPORTED_POOR_CONDITION" && signal.classification === "INDICATED"));
  assert.equal(call.lead.propertyQualification?.status, "QUALIFIED_LEAD",
    "A newly material seller statement removes CALL_READY status until reviewed.");
  assert.ok(call.lead.nextAction.includes("Reconcile conflicting"),
    "The explicit next action is to resolve the contradictory evidence.");
  assert.ok(call.calls[0]?.evidenceIds?.length);
  const reloadedCallLead = await store.leadDetail(callableId, undefined, now);
  assert.equal(reloadedCallLead.calls.length, 1,
    "The recorded seller note reloads from persistence on its owning lead.");
  assert.equal(reloadedCallLead.calls[0]?.id, call.calls[0]?.id);
  assert.equal(reloadedCallLead.calls[0]?.notes, callInput.notes);
  assert.equal(reloadedCallLead.calls[0]?.analysisInvalidated, true,
    "The reloaded call retains the evidence-driven stale-analysis marker.");
  assert.ok(reloadedCallLead.intelligence.some(item =>
    item.sourceRecordId === call.calls[0]?.id
      && item.category === "seller_call_asking_price"
      && item.statement.includes("$125,000")),
  "Structured seller-reported answers reload as linked, source-classified evidence without being copied into economics.");

  const refreshed = await store.saveUnderwriting(callableId, {
    ...(call.underwriting as UnderwritingInput),
    version: call.lead.version,
  }, actor, now);
  assert.ok(refreshed.analysis?.preliminaryRepairEstimate.hypotheses.some(hypothesis =>
    hypothesis.sourceRecordId === call.calls[0]?.id && hypothesis.epistemicStatus === "AI_HYPOTHESIS"),
    "Seller-reported condition can create a linked repair hypothesis, never an observed repair fact.");
  assert.ok(refreshed.analysis, "A reviewable underwriting response remains available after the snapshot refresh.");
  const refreshedBrief = buildCallBrief(refreshed.lead, refreshed.intelligence, refreshed.analysis, null, now);
  assert.ok(refreshedBrief.questions.some(question => question.includes("conflicts with or supplements")),
    "The call brief surfaces unresolved source conflicts as questions, not facts.");

  const nonMaterialId = await createFixture("NON-MATERIAL", "000-000-0000");
  const nonMaterialBefore = await saveSyntheticUnderwriting(nonMaterialId);
  const nonMaterialCall = await store.recordCall(nonMaterialId, {
    version: nonMaterialBefore.lead.version,
    outcome: "CONNECTED",
    notes: "SYNTHETIC: brief greeting; no property facts discussed.",
    nextAction: "SYNTHETIC follow-up only.",
    followUpAt: future(1),
  }, actor, now);
  assert.equal(nonMaterialCall.calls[0]?.materialEvidence, false);
  assert.equal(nonMaterialCall.calls[0]?.analysisInvalidated, false);
  assert.equal(nonMaterialCall.analysisSnapshotId, nonMaterialBefore.analysisSnapshotId,
    "A non-material conversation note preserves the current analysis snapshot.");

  // Postal-only: persisted property mailing address is not a direct call route.
  const postalId = await createFixture("POSTAL-ONLY");
  await createPostalEvidence(postalId);
  const postalItem = (await acquisitionQueue("OWNER", now)).items.find(item => item.lead.id === postalId);
  assert.equal(postalItem?.contactReadiness.directRouteStatus, "POSTAL_ONLY");
  assert.equal(postalItem?.decision, "BLOCKED");
  assert.equal(postalItem?.blockerCode, "CONTACT_NO_DIRECT_ROUTE");
  assert.match(postalItem?.nextAction ?? "", /direct phone evidence/i);
  const postalSelection = await recordQueueSelection(postalId, postalItem!.lead.version, actor, "OWNER", now);
  assert.equal(postalSelection.decision, "BLOCKED");
  await assert.rejects(
    startCallSession(postalId, postalItem!.lead.version, actor, "OWNER", now),
    /mailing address|direct phone/i,
    "A postal-only record cannot start call work.",
  );

  // No route at all remains a distinct fail-closed state.
  const noRouteId = await createFixture("NO-ROUTE");
  const noRouteItem = (await acquisitionQueue("OWNER", now)).items.find(item => item.lead.id === noRouteId);
  assert.equal(noRouteItem?.contactReadiness.directRouteStatus, "NO_DIRECT_ROUTE");
  assert.equal(noRouteItem?.decision, "BLOCKED");
  assert.equal(noRouteItem?.callBrief, null);

  // A direct route with a captured freshness window that has elapsed is stale.
  const staleId = await createFixture("STALE-ROUTE");
  const capturedAt = new Date(now.getTime() - 60 * 86_400_000);
  const expiredAt = new Date(capturedAt.getTime() + 30 * 86_400_000).toISOString();
  const staleContact = await addPhoneEvidence(staleId, "+1 555 010 3001", "SYNTHETIC stale recipient", "synthetic-stale", capturedAt, expiredAt);
  assert.equal(staleContact.directRouteStatus, "STALE_ROUTE");
  const staleItem = (await acquisitionQueue("OWNER", now)).items.find(item => item.lead.id === staleId);
  assert.equal(staleItem?.blockerCode, "CONTACT_STALE");
  assert.match(staleItem?.nextAction ?? "", /refresh/i);

  // Two source-backed but conflicting recipient identities cannot be routed.
  const conflictId = await createFixture("CONFLICT");
  let conflict = await addPhoneEvidence(conflictId, "+1 555 010 3002", "SYNTHETIC owner A", "synthetic-conflict-a");
  conflict = await addPhoneEvidence(conflictId, "+1 555 010 3003", "SYNTHETIC unrelated directory contact", "synthetic-conflict-b");
  const conflictItem = (await acquisitionQueue("OWNER", now)).items.find(item => item.lead.id === conflictId);
  assert.equal(conflictItem?.decision, "BLOCKED");
  assert.equal(conflictItem?.contactReadiness.directRouteStatus, "CONFLICTING_ROUTE");
  assert.equal(conflictItem?.blockerCode, "CONTACT_CONFLICT");

  // Current contact route but missing analysis exposes underwriting, not an invitation to call.
  const missingUnderwritingId = await createFixture("MISSING-UNDERWRITING", "000-000-0000");
await addPhoneEvidence(missingUnderwritingId, "000-000-0000", "SYNTHETIC owner", "synthetic-underwriting-contact");
  const missingItem = (await acquisitionQueue("OWNER", now)).items.find(item => item.lead.id === missingUnderwritingId);
  assert.equal(missingItem?.contactReadiness.directRouteStatus, "PHONE_ROUTE_AVAILABLE");
  assert.equal(missingItem?.blockerCode, "UNDERWRITING_MISSING");
  assert.equal(missingItem?.decision, "BLOCKED");

  const auditableEvents = await db.select().from(auditTable).where(eq(auditTable.entityId, callableId));
  const actions = auditableEvents.map(event => event.action);
  assert.ok(actions.includes("ACQUISITION_QUEUE_SELECTED"));
  assert.ok(actions.includes("CALL_SESSION_STARTED"));
  assert.ok(actions.includes("CALL_RESULT_EVIDENCE_CAPTURED"));
  const postalAudit = await db.select().from(auditTable).where(eq(auditTable.entityId, postalId));
  assert.ok(postalAudit.some(event => event.action === "ACQUISITION_CONTACT_BLOCKED"));
  assert.ok(!actions.some(action => action.includes("OFFER") || action.includes("ECONOMIC")),
    "Queue and call-result actions do not mutate offer authority or economics.");

  logger.info({
    synthetic: true,
    checks: [
      "persisted current direct-route CALL NEXT and seller brief",
      "postal-only and no-route fail-closed blockers",
      "stale-route and conflicting-recipient blockers",
      "missing-underwriting blocker",
      "queue-selection, contact-route, call-start and call-result audit events",
      "viewer call-session denial and future-only follow-up validation",
      "explicit call time, notes and provenance reload from persisted lead history",
      "same-key exact replay deduplicated; changed-content replay and stale-version writes rejected",
      "material seller-call evidence persisted as INDICATED, reconciled against prior evidence, and invalidated stale analysis/offer authority",
      "non-material call note preserved the current analysis snapshot",
      "seller-reported condition produced a linked AI repair hypothesis and conflict-focused call question",
      "seller identity/signing authority remain unverified",
    ],
  }, "Acquisition queue persisted workflow exercise PASSED");
} finally {
  for (const id of ids) {
    await db.delete(auditTable).where(eq(auditTable.entityId, id));
    await db.delete(intelligenceTable).where(eq(intelligenceTable.leadId, id));
    await db.delete(leadsTable).where(eq(leadsTable.id, id));
  }
  await pool.end();
}
