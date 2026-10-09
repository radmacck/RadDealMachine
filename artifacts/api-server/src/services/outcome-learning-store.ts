import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db, leadsTable, callsTable, offersTable, matchesTable, contractsTable,
  sellerOfferPortalsTable, sellerOfferPortalEventsTable,
  outcomeObservationsTable, outcomeCalibrationReviewsTable,
  type OutcomeObservationRow, type OutcomeCalibrationReviewRow,
} from "@workspace/db";
import { DomainError, assertOperationsRole, pastInstant, type OfferActor } from "@workspace/deal-domain";
import { audit } from "./deal-store";
import { queueJob, type Tx } from "./operations-records";
import { RecordOutcomeActualsBody } from "@workspace/api-zod";
import type { z } from "zod";

const MIN_CALIBRATION_SAMPLE = 5;
const OUTCOME_RULE_VERSION = "outcome-calibration-v1";
const ACTUAL_REVIEW_SOURCE = "OWNER_REVIEWED_REFERENCE";

type OutcomeInput = {
  leadId: string;
  idempotencyKey: string;
  eventType: string;
  sourceRecordType: string;
  sourceRecordId: string;
  source: string;
  occurredAt: Date | null;
  recordedAt: Date;
  evidenceRefs?: string[];
  isSynthetic?: boolean;
  confidence?: number | null;
  verificationState: string;
  economicsSnapshotId?: string | null;
  decisionVersion?: number | null;
  predicted?: Record<string, unknown> | null;
  actual?: Record<string, unknown> | null;
  delta?: Record<string, unknown> | null;
  causeCategories?: string[];
  payload?: Record<string, unknown>;
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function date(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}
function isSynthetic(...values: unknown[]): boolean {
  return values.some(value => value === true || (typeof value === "string" &&
    (/^synthetic[-_:]/i.test(value) || /SYNTHETIC_TEST_FIXTURE/.test(value))));
}
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function stableHash(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]));
    }
    return input;
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}
function evidenceRefs(...values: unknown[]): string[] {
  return [...new Set(values.flatMap(value => Array.isArray(value) ? value : [value])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
}
function prediction(lead: typeof leadsTable.$inferSelect) {
  const analysis = obj(lead.analysis);
  const arv = obj(analysis.arv);
  const repairs = obj(analysis.repairEstimate);
  const total = obj(repairs.total);
  return {
    analysisSnapshotId: lead.analysisSnapshotId,
    arvExpected: num(arv.expected),
    repairsExpected: num(total.expected),
    repairsLow: num(total.low),
    repairsHigh: num(total.high),
  };
}
function actualSentence(eventType: string, payload: Record<string, unknown>): string | null {
  if (eventType === "SELLER_NO_ANSWER") return "No answer was recorded; this is an observed call result, not a motivation outcome.";
  if (eventType === "SELLER_VOICEMAIL") return "Voicemail was recorded; no seller response is established.";
  if (eventType === "SELLER_CONNECTED") return "A connected conversation was recorded; seller statements remain seller-reported evidence.";
  const value = payload.value;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}
function rowToObservation(row: OutcomeObservationRow) {
  return {
    id: row.id, leadId: row.leadId, eventType: row.eventType,
    sourceRecordType: row.sourceRecordType, sourceRecordId: row.sourceRecordId,
    source: row.source, occurredAt: row.occurredAt?.toISOString() ?? null,
    recordedAt: row.recordedAt.toISOString(), evidenceRefs: row.evidenceRefs,
    synthetic: row.isSynthetic, confidence: row.confidence,
    verificationState: row.verificationState,
    economicsSnapshotId: row.economicsSnapshotId, decisionVersion: row.decisionVersion,
    predicted: row.predicted, actual: row.actual, delta: row.delta,
    causeCategories: row.causeCategories, payload: row.payload,
  };
}
async function insertObservation(input: OutcomeInput, tx: Tx | typeof db = db): Promise<OutcomeObservationRow> {
  const normalizedKey = input.idempotencyKey.trim();
  if (!normalizedKey) throw new Error("Outcome idempotency key is required.");
  const [created] = await tx.insert(outcomeObservationsTable).values({
    ...input,
    idempotencyKey: normalizedKey,
    evidenceRefs: input.evidenceRefs ?? [],
    isSynthetic: input.isSynthetic ?? false,
    confidence: input.confidence ?? null,
    economicsSnapshotId: input.economicsSnapshotId ?? null,
    decisionVersion: input.decisionVersion ?? null,
    predicted: input.predicted ?? null,
    actual: input.actual ?? null,
    delta: input.delta ?? null,
    causeCategories: input.causeCategories ?? [],
    payload: input.payload ?? {},
  }).onConflictDoNothing({ target: outcomeObservationsTable.idempotencyKey }).returning();
  if (created) return created;
  const [existing] = await tx.select().from(outcomeObservationsTable)
    .where(eq(outcomeObservationsTable.idempotencyKey, normalizedKey)).limit(1);
  if (!existing) throw new Error("Outcome observation insert could not be reconciled.");
  if (existing.leadId !== input.leadId || existing.eventType !== input.eventType ||
    existing.sourceRecordType !== input.sourceRecordType || existing.sourceRecordId !== input.sourceRecordId) {
    throw new DomainError("Outcome idempotency key is already assigned to another source event.", 409);
  }
  return existing;
}

/**
 * Idempotently projects canonical domain records into the learning ledger.
 * Source records remain authoritative and are never rewritten by this projection.
 */
export async function reconcileCanonicalOutcomeObservations(now = new Date()): Promise<number> {
  const [leads, calls, offers, matches, contracts, portals, portalEvents] = await Promise.all([
    db.select().from(leadsTable),
    db.select().from(callsTable),
    db.select().from(offersTable),
    db.select().from(matchesTable),
    db.select().from(contractsTable),
    db.select().from(sellerOfferPortalsTable),
    db.select().from(sellerOfferPortalEventsTable),
  ]);
  const leadById = new Map(leads.map(row => [row.id, row]));
  const portalById = new Map(portals.map(row => [row.id, row]));
  const createdBefore = (await db.select({ id: outcomeObservationsTable.id }).from(outcomeObservationsTable)).length;

  for (const call of calls) {
    const lead = leadById.get(call.leadId);
    if (!lead) continue;
    const payload = obj(call.payload);
    const result = str(payload.outcome) ?? "UNKNOWN";
    const baseType = result === "NO_ANSWER" ? "SELLER_NO_ANSWER"
      : result === "VOICEMAIL" ? "SELLER_VOICEMAIL"
      : result === "CONNECTED" ? "SELLER_CONNECTED"
      : result === "NOT_INTERESTED" ? "SELLER_DECLINED"
      : "SELLER_CALL_RESULT";
    const refs = evidenceRefs(`call:${call.id}`, payload.evidenceIds);
    const confidence = num(payload.operatorConfidence);
    await insertObservation({
      leadId: lead.id, idempotencyKey: `call:${call.id}:${baseType}`,
      eventType: baseType, sourceRecordType: "CALL", sourceRecordId: call.id,
      source: result === "NO_ANSWER" || result === "VOICEMAIL" ? "OPERATOR_CALL_ATTEMPT" : "OPERATOR_ENTERED_SELLER_CONVERSATION",
      occurredAt: date(payload.occurredAt), recordedAt: call.createdAt, evidenceRefs: refs,
      isSynthetic: isSynthetic(call.actor, payload.exerciseMode, obj(lead.payload).synthetic),
      confidence, verificationState: result === "NO_ANSWER" || result === "VOICEMAIL" ? "OBSERVED_OPERATOR" : "SELLER_REPORTED_NOT_INDEPENDENTLY_VERIFIED",
      economicsSnapshotId: lead.analysisSnapshotId, decisionVersion: lead.version,
      predicted: prediction(lead),
      payload: { outcome: result, notes: str(payload.notes), nextAction: str(payload.nextAction), sellerAnswers: obj(payload.sellerAnswers), epistemicStatus: result === "NO_ANSWER" || result === "VOICEMAIL" ? "OBSERVED" : "INDICATED" },
    });
    const answers = obj(payload.sellerAnswers);
    const clarification = str(payload.clarificationStatus)?.toUpperCase() ?? "";
    const clarificationSuffix = clarification.includes("CONTRADICT") ? "_CONTRADICTED"
      : clarification.includes("CONFIRM") ? "_CONFIRMED" : "";
    for (const [field, value] of Object.entries(answers)) {
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
      const eventType = field === "motivationStatement" ? "SELLER_MOTIVATION_REPORTED"
        : ["urgency", "timing"].includes(field) ? "SELLER_TIMING_REPORTED"
        : field === "askingPrice" ? "SELLER_PRICE_REPORTED"
        : ["conditionDescription", "conditionByCategory", "repairsCompleted", "knownDefects"].includes(field) ? "SELLER_CONDITION_REPORTED"
        : ["occupancy", "titleTenantIssues", "accessConstraints", "willingnessToAcceptTerms"].includes(field) ? "SELLER_PROPERTY_OR_TERMS_REPORTED"
        : "SELLER_STATEMENT_REPORTED";
      await insertObservation({
        leadId: lead.id, idempotencyKey: `call:${call.id}:${field}`,
        eventType: `${eventType}${clarificationSuffix}`, sourceRecordType: "CALL_ANSWER", sourceRecordId: call.id,
        source: "SELLER_REPORTED_THROUGH_OPERATOR",
        occurredAt: date(payload.occurredAt), recordedAt: call.createdAt,
        evidenceRefs: refs, isSynthetic: isSynthetic(call.actor, payload.exerciseMode, obj(lead.payload).synthetic),
        confidence, verificationState: "SELLER_REPORTED_NOT_INDEPENDENTLY_VERIFIED",
        economicsSnapshotId: lead.analysisSnapshotId, decisionVersion: lead.version,
        predicted: prediction(lead), payload: {
          field, value, epistemicStatus: "INDICATED",
          clarificationStatus: str(payload.clarificationStatus) ?? "UNREVIEWED",
        },
      });
    }
  }

  for (const offer of offers) {
    const lead = leadById.get(offer.leadId);
    if (!lead) continue;
    const payload = offer.payload;
    if (offer.status === "COMMUNICATED" || offer.status === "AUTHORIZED") {
      const communicated = offer.status === "COMMUNICATED";
      const at = date(communicated ? payload.communicatedAt : payload.approvedAt);
      if (at) await insertObservation({
        leadId: lead.id, idempotencyKey: `offer:${offer.id}:${offer.status}`,
        eventType: communicated ? "OFFER_COMMUNICATION_RECORDED" : "OFFER_AUTHORIZED",
        sourceRecordType: "OFFER", sourceRecordId: offer.id,
        source: communicated ? "HUMAN_ATTESTED_COMMUNICATION" : "OWNER_AUTHORIZATION",
        occurredAt: at, recordedAt: offer.updatedAt,
        evidenceRefs: evidenceRefs(`offer:${offer.id}`, payload.evidence, payload.authorityEvidenceId),
        isSynthetic: isSynthetic(offer.createdBy, payload.exerciseMode, obj(lead.payload).synthetic),
        verificationState: communicated ? "HUMAN_ATTESTATION_NOT_PROVIDER_DELIVERY" : "OWNER_AUTHORIZED",
        economicsSnapshotId: offer.analysisSnapshotId, decisionVersion: lead.version,
        predicted: prediction(lead),
        payload: { offerStatus: offer.status, amount: payload.amount, maximumApprovedAcquisitionPrice: payload.maximumApprovedAcquisitionPrice },
      });
    }
    const expiresAt = date(offer.payload.expiresAt);
    if (expiresAt && expiresAt.getTime() <= now.getTime() && ["AUTHORIZED", "COMMUNICATED"].includes(offer.status)) {
      await insertObservation({
        leadId: lead.id, idempotencyKey: `offer:${offer.id}:EXPIRED`,
        eventType: "OFFER_EXPIRED", sourceRecordType: "OFFER", sourceRecordId: offer.id,
        source: "SYSTEM_DEADLINE_RECONCILIATION", occurredAt: expiresAt,
        recordedAt: now, evidenceRefs: [`offer:${offer.id}`],
        isSynthetic: isSynthetic(offer.createdBy, payload.exerciseMode, obj(lead.payload).synthetic),
        verificationState: "DERIVED_FROM_RECORDED_EXPIRY",
        economicsSnapshotId: offer.analysisSnapshotId, decisionVersion: lead.version,
        predicted: prediction(lead), payload: { expiresAt: expiresAt.toISOString(), statusAtProjection: offer.status },
      });
    }
  }

  for (const event of portalEvents) {
    const portal = portalById.get(event.portalId);
    const lead = portal ? leadById.get(portal.leadId) : undefined;
    if (!portal || !lead) continue;
    await insertObservation({
      leadId: lead.id, idempotencyKey: `seller-portal:${event.id}`,
      eventType: event.kind === "ACCEPTED" ? "SELLER_OFFER_ACCEPTED"
        : event.kind === "COUNTERED" ? "SELLER_OFFER_COUNTERED"
        : event.kind === "REJECTED" ? "SELLER_OFFER_REJECTED" : "SELLER_PORTAL_RESPONSE",
      sourceRecordType: "SELLER_OFFER_PORTAL_EVENT", sourceRecordId: event.id,
      source: "SELLER_PORTAL_RESPONSE", occurredAt: event.occurredAt,
      recordedAt: event.recordedAt, evidenceRefs: [`seller-portal-event:${event.id}`, `offer:${portal.offerId}`],
      isSynthetic: isSynthetic(portal.createdBy, obj(event.payload).exerciseMode, obj(lead.payload).synthetic),
      confidence: 1, verificationState: "SELLER_REPORTED_RESPONSE_NOT_SIGNATURE",
      economicsSnapshotId: portal.snapshot.economicsSnapshotId ? String(portal.snapshot.economicsSnapshotId) : null,
      decisionVersion: lead.version, predicted: prediction(lead),
      payload: { action: event.kind, respondentName: obj(event.payload).respondentName, response: obj(event.payload).note, isSignature: false },
    });
  }

  for (const match of matches) {
    const lead = leadById.get(match.leadId);
    const status = str(match.payload.status);
    if (!lead || !status || !["INTERESTED", "COMMITTED", "DECLINED", "EXPIRED"].includes(status)) continue;
    await insertObservation({
      leadId: lead.id, idempotencyKey: `buyer-match:${match.id}:${status}`,
      eventType: status === "INTERESTED" ? "BUYER_INTEREST_RECORDED"
        : status === "COMMITTED" ? "BUYER_COMMITMENT_RECORDED"
        : status === "DECLINED" ? "BUYER_DECLINED" : "BUYER_OPPORTUNITY_EXPIRED",
      sourceRecordType: "BUYER_MATCH", sourceRecordId: match.id,
      source: "BUYER_RESPONSE_RECORDED_BY_OPERATOR",
      occurredAt: date(match.payload.responseOccurredAt) ?? match.updatedAt,
      recordedAt: date(match.payload.responseRecordedAt) ?? match.updatedAt,
      evidenceRefs: evidenceRefs(`buyer-match:${match.id}`, match.payload.evidence, match.payload.commitmentEvidenceUrl),
      isSynthetic: isSynthetic(match.payload.responseRecordedBy, match.payload.exerciseMode, obj(lead.payload).synthetic),
      confidence: status === "COMMITTED" ? 1 : null,
      verificationState: status === "COMMITTED" ? "OWNER_REVIEWED_COMMITMENT_REFERENCE" : "BUYER_REPORTED_RESPONSE",
      economicsSnapshotId: lead.analysisSnapshotId, decisionVersion: lead.version,
      predicted: prediction(lead),
      payload: { status, buyerId: match.buyerId, agreedPrice: num(match.payload.agreedPrice), evidence: str(match.payload.evidence) },
    });
  }

  for (const contract of contracts) {
    const lead = leadById.get(contract.leadId);
    if (!lead) continue;
    const terminal = str(contract.payload.status);
    if (!["CLOSED", "CANCELLED"].includes(terminal ?? "")) continue;
    const closed = terminal === "CLOSED";
    const when = date(closed ? contract.payload.closedAt : contract.payload.cancelledAt);
    if (!when) continue;
    const signedAt = date(contract.payload.acquisitionSignedAt);
    const plannedCloseAt = date(contract.payload.closingAt);
    const realizedDays = closed && signedAt ? roundMoney((when.getTime() - signedAt.getTime()) / 86_400_000) : null;
    const plannedDays = signedAt && plannedCloseAt ? roundMoney((plannedCloseAt.getTime() - signedAt.getTime()) / 86_400_000) : null;
    const assignmentTarget = num(contract.payload.assignmentTarget);
    const assignmentFeeReceived = num(contract.payload.assignmentFeeReceived);
    const closingCosts = num(contract.payload.closingCosts);
    await insertObservation({
      leadId: lead.id, idempotencyKey: `contract:${contract.id}:${terminal}`,
      eventType: closed ? "DEAL_CLOSED" : "CONTRACT_FALLOUT",
      sourceRecordType: "TRANSACTION", sourceRecordId: contract.id,
      source: "OWNER_RECORDED_EXTERNAL_TRANSACTION_OUTCOME",
      occurredAt: when, recordedAt: date(contract.payload.outcomeRecordedAt) ?? contract.updatedAt,
      evidenceRefs: evidenceRefs(`contract:${contract.id}`, contract.payload.outcomeEvidenceUrl, contract.payload.buyerReleaseEvidenceUrl),
      isSynthetic: isSynthetic(contract.payload.outcomeRecordedBy, contract.payload.exerciseMode, obj(lead.payload).synthetic),
      confidence: 1, verificationState: "OWNER_REVIEWED_EXTERNAL_EVIDENCE_REFERENCE",
      economicsSnapshotId: str(contract.payload.analysisSnapshotId) ?? lead.analysisSnapshotId,
      decisionVersion: lead.version, predicted: prediction(lead),
      actual: closed ? {
        assignmentFeeReceived, closingCosts, netProceeds: num(contract.payload.netProceeds),
        timeToCloseDays: realizedDays,
      } : null,
      delta: closed ? {
        ...(realizedDays !== null && plannedDays !== null ? { timeToCloseDays: roundMoney(realizedDays - plannedDays) } : {}),
        ...(assignmentTarget !== null && assignmentFeeReceived !== null ? { assignmentFeeReceived: roundMoney(assignmentFeeReceived - assignmentTarget) } : {}),
      } : null,
      payload: {
        status: terminal, reason: str(contract.payload.outcomeNote),
        closingAt: str(contract.payload.closingAt), signedAt: str(contract.payload.acquisitionSignedAt),
        plannedTimeToCloseDays: plannedDays,
      },
    });
  }

  const finalCount = (await db.select({ id: outcomeObservationsTable.id }).from(outcomeObservationsTable)).length;
  return Math.max(0, finalCount - createdBefore);
}

type CalibrationMetric = {
  metricKey: "ARV" | "REPAIRS";
  currentRuleVersion: string;
  values: { observationId: string; delta: number; isSynthetic: boolean; verificationState: string; confidence: number | null }[];
};
function eligibleRealSamples(metric: CalibrationMetric) {
  return metric.values.filter(value => !value.isSynthetic &&
    value.verificationState === ACTUAL_REVIEW_SOURCE && value.confidence !== null && value.confidence >= 0.8);
}
export function summarizeCalibrationSamples(
  values: CalibrationMetric["values"],
  minimumSampleSize = MIN_CALIBRATION_SAMPLE,
  reviewDeltaThreshold = 50,
) {
  const eligible = values.filter(value => !value.isSynthetic &&
    value.verificationState === ACTUAL_REVIEW_SOURCE && value.confidence !== null && value.confidence >= 0.8);
  const mean = eligible.length
    ? roundMoney(eligible.reduce((sum, item) => sum + item.delta, 0) / eligible.length)
    : null;
  return {
    eligible,
    sampleSize: eligible.length,
    minimumSampleSize,
    mean,
    status: eligible.length < minimumSampleSize ? "INSUFFICIENT_EVIDENCE" as const
      : mean !== null && Math.abs(mean) >= reviewDeltaThreshold ? "REVIEW_REQUIRED" as const
      : "NO_RECOMMENDATION" as const,
  };
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return roundMoney(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
}
async function ensureCalibrationRecommendation(metric: CalibrationMetric, now: Date, allowSyntheticTestFixtures = false) {
  const samples = allowSyntheticTestFixtures
    ? metric.values.filter(value => value.verificationState === ACTUAL_REVIEW_SOURCE)
    : eligibleRealSamples(metric);
  const sampleSummary = allowSyntheticTestFixtures
    ? {
        status: samples.length < MIN_CALIBRATION_SAMPLE ? "INSUFFICIENT_EVIDENCE" as const
          : Math.abs(roundMoney(samples.reduce((sum, item) => sum + item.delta, 0) / samples.length)) >= 50
            ? "REVIEW_REQUIRED" as const : "NO_RECOMMENDATION" as const,
      }
    : summarizeCalibrationSamples(metric.values);
  if (samples.length < MIN_CALIBRATION_SAMPLE && allowSyntheticTestFixtures) return null;
  const refs = samples.map(item => item.observationId).sort();
  if (samples.length < MIN_CALIBRATION_SAMPLE) {
    const fingerprint = stableHash({ refs, count: samples.length, rule: metric.currentRuleVersion }).slice(0, 16);
    const idempotencyKey = `calibration:${metric.metricKey}:INSUFFICIENT:${fingerprint}`;
    const [created] = await db.insert(outcomeCalibrationReviewsTable).values({
      idempotencyKey, metricKey: metric.metricKey,
      currentRuleVersion: metric.currentRuleVersion,
      proposedRuleVersion: metric.currentRuleVersion,
      status: "INSUFFICIENT_EVIDENCE", sampleSize: samples.length,
      minimumSampleSize: MIN_CALIBRATION_SAMPLE, observationRefs: refs,
      summary: `Only ${samples.length} eligible real samples are available; ${MIN_CALIBRATION_SAMPLE} are required. No rule or offer economics changed.`,
      isSynthetic: false, createdAt: now, updatedAt: now,
      history: [{ action: "INSUFFICIENT_EVIDENCE_RECORDED", at: now.toISOString(), actor: "system:outcome-calibration" }],
    }).onConflictDoNothing({ target: outcomeCalibrationReviewsTable.idempotencyKey }).returning();
    if (created) return created;
    const [existing] = await db.select().from(outcomeCalibrationReviewsTable)
      .where(eq(outcomeCalibrationReviewsTable.idempotencyKey, idempotencyKey)).limit(1);
    return existing ?? null;
  }
  const mean = roundMoney(samples.reduce((sum, item) => sum + item.delta, 0) / samples.length);
  if (sampleSummary.status !== "REVIEW_REQUIRED") {
    const fingerprint = stableHash({ refs, noRecommendation: true }).slice(0, 16);
    const idempotencyKey = `calibration:${metric.metricKey}:NO_RECOMMENDATION:${fingerprint}`;
    const [created] = await db.insert(outcomeCalibrationReviewsTable).values({
      idempotencyKey, metricKey: metric.metricKey,
      currentRuleVersion: metric.currentRuleVersion,
      proposedRuleVersion: metric.currentRuleVersion,
      status: "NO_RECOMMENDATION", sampleSize: samples.length,
      minimumSampleSize: MIN_CALIBRATION_SAMPLE, observationRefs: refs,
      summary: `Threshold met, but the observed mean delta ($${mean}) does not meet the review trigger. No rule or offer economics changed.`,
      isSynthetic: false, createdAt: now, updatedAt: now,
      history: [{ action: "NO_RECOMMENDATION_RECORDED", at: now.toISOString(), actor: "system:outcome-calibration" }],
    }).onConflictDoNothing({ target: outcomeCalibrationReviewsTable.idempotencyKey }).returning();
    if (created) return created;
    const [existing] = await db.select().from(outcomeCalibrationReviewsTable)
      .where(eq(outcomeCalibrationReviewsTable.idempotencyKey, idempotencyKey)).limit(1);
    return existing ?? null;
  }
  const fingerprint = stableHash(refs).slice(0, 16);
  const isTestOnly = allowSyntheticTestFixtures && samples.some(item => item.isSynthetic);
  const idempotencyKey = `calibration:${metric.metricKey}:${fingerprint}${isTestOnly ? ":TEST_ONLY" : ""}`;
  const currentVersion = metric.currentRuleVersion;
  const status = isTestOnly ? "TEST_ONLY_NOT_DEPLOYABLE" : "PENDING_REVIEW";
  const summary = `${metric.metricKey} actual-minus-predicted mean is $${mean}; review this ${samples.length}-sample signal. It is not deployed and does not change economics or offer authority.`;
  const [created] = await db.insert(outcomeCalibrationReviewsTable).values({
    idempotencyKey, metricKey: metric.metricKey,
    currentRuleVersion: currentVersion,
    proposedRuleVersion: `${currentVersion}-review-${fingerprint}`,
    status, sampleSize: samples.length, minimumSampleSize: MIN_CALIBRATION_SAMPLE,
    observationRefs: refs, summary, isSynthetic: isTestOnly, createdAt: now, updatedAt: now,
    history: [{ action: isTestOnly ? "TEST_ONLY_PREVIEW_CREATED" : "THRESHOLD_MET_RECOMMENDATION_CREATED", at: now.toISOString(), actor: "system:outcome-calibration" }],
  }).onConflictDoNothing({ target: outcomeCalibrationReviewsTable.idempotencyKey }).returning();
  if (created) return created;
  const [existing] = await db.select().from(outcomeCalibrationReviewsTable)
    .where(eq(outcomeCalibrationReviewsTable.idempotencyKey, idempotencyKey)).limit(1);
  return existing ?? null;
}

export async function getOutcomeLearningReport(now = new Date(), canReview = false) {
  await reconcileCanonicalOutcomeObservations(now);
  const rows = await db.select().from(outcomeObservationsTable).orderBy(desc(outcomeObservationsTable.recordedAt));
  const realRows = rows.filter(row => !row.isSynthetic);
  const syntheticRows = rows.filter(row => row.isSynthetic);
  const learningRows = realRows.filter(row => row.eventType === "ACTUALS_REVIEW" &&
    row.verificationState === ACTUAL_REVIEW_SOURCE && row.confidence !== null && row.confidence >= 0.8);
  const arvSamples = learningRows.filter(row => num(obj(row.delta).arv) !== null);
  const repairSamples = learningRows.filter(row => num(obj(row.delta).repairs) !== null);
  const arvValues = arvSamples.map(row => num(obj(row.delta).arv)!);
  const repairValues = repairSamples.map(row => num(obj(row.delta).repairs)!);
  const metrics: CalibrationMetric[] = [
    { metricKey: "ARV", currentRuleVersion: "arv-comp-selection-v1", values: arvSamples.map(row => ({
      observationId: row.id, delta: num(obj(row.delta).arv)!, isSynthetic: row.isSynthetic,
      verificationState: row.verificationState, confidence: row.confidence,
    })) },
    { metricKey: "REPAIRS", currentRuleVersion: "repair-estimate-rates-v1", values: repairSamples.map(row => ({
      observationId: row.id, delta: num(obj(row.delta).repairs)!, isSynthetic: row.isSynthetic,
      verificationState: row.verificationState, confidence: row.confidence,
    })) },
  ];
  const recommendations = [];
  for (const metric of metrics) {
    const recommendation = await ensureCalibrationRecommendation(metric, now);
    if (recommendation) recommendations.push(recommendation);
  }
  const persistedReviews = await db.select().from(outcomeCalibrationReviewsTable)
    .where(eq(outcomeCalibrationReviewsTable.isSynthetic, false))
    .orderBy(desc(outcomeCalibrationReviewsTable.createdAt));
  const currentReviewByMetric = new Map<string, OutcomeCalibrationReviewRow>();
  for (const review of persistedReviews) {
    if (!currentReviewByMetric.has(review.metricKey)) currentReviewByMetric.set(review.metricKey, review);
  }
  const reportRecommendations = [...currentReviewByMetric.values()].map(review => ({
    id: review.id, metricKey: review.metricKey, currentRuleVersion: review.currentRuleVersion,
    proposedRuleVersion: review.proposedRuleVersion, status: review.status,
    sampleSize: review.sampleSize, minimumSampleSize: review.minimumSampleSize,
    observationRefs: review.observationRefs, summary: review.summary, synthetic: false,
  }));
  const enoughArv = arvSamples.length >= MIN_CALIBRATION_SAMPLE;
  const enoughRepairs = repairSamples.length >= MIN_CALIBRATION_SAMPLE;
  const missingData: string[] = [];
  if (!realRows.length) missingData.push("No real deal outcome observations are recorded.");
  if (!arvSamples.length) missingData.push("No owner-reviewed actual ARV with a retained source reference is available.");
  if (!repairSamples.length) missingData.push("No owner-reviewed actual repair total with retained source references is available.");
  if (!enoughArv) missingData.push(`ARV calibration needs ${MIN_CALIBRATION_SAMPLE - arvSamples.length} more eligible real samples.`);
  if (!enoughRepairs) missingData.push(`Repair calibration needs ${MIN_CALIBRATION_SAMPLE - repairSamples.length} more eligible real samples.`);
  const pendingCount = reportRecommendations.filter(item => item.status === "PENDING_REVIEW").length;
  return {
    generatedAt: now.toISOString(),
    realOutcomeCount: realRows.length,
    syntheticOutcomeCount: syntheticRows.length,
    sampleSizes: { arv: arvSamples.length, repairs: repairSamples.length },
    deltas: {
      arv: { sampleSize: arvValues.length, mean: arvValues.length ? roundMoney(arvValues.reduce((a, b) => a + b, 0) / arvValues.length) : null, median: median(arvValues) },
      repairs: { sampleSize: repairValues.length, mean: repairValues.length ? roundMoney(repairValues.reduce((a, b) => a + b, 0) / repairValues.length) : null, median: median(repairValues) },
    },
    ruleVersion: OUTCOME_RULE_VERSION,
    calibrationStatus: pendingCount ? "REVIEW_REQUIRED" as const
      : (enoughArv || enoughRepairs) ? "NO_RECOMMENDATION" as const : "INSUFFICIENT_EVIDENCE" as const,
    missingData,
    recentOutcomes: rows.slice(0, 25).map(rowToObservation),
    recommendations: reportRecommendations,
    liveRulesChanged: false as const,
    canReview,
  };
}

export async function recordOutcomeActuals(
  leadId: string,
  input: z.infer<typeof RecordOutcomeActualsBody>,
  actor: OfferActor,
  now = new Date(),
) {
  assertOperationsRole(actor, ["OWNER"]);
  const parsed = RecordOutcomeActualsBody.parse(input);
  const eventMs = pastInstant(parsed.occurredAt, now, "Actual outcome time");
  const repairLines = Object.entries(parsed.actualRepairsByCategory ?? {}).map(([category, amount]) => {
    if (!/^[a-z][a-z0-9_-]{1,49}$/i.test(category) || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new DomainError(`Invalid actual repair amount for ${category}.`, 400);
    }
    return [category, roundMoney(amount)] as const;
  });
  if (parsed.actualArv == null && repairLines.length === 0) throw new DomainError("Enter at least one actual ARV or repair category.", 400);
  if (parsed.actualArv != null && (!Number.isFinite(parsed.actualArv) || parsed.actualArv < 0)) throw new DomainError("Actual ARV must be a nonnegative amount.", 400);
  if (!parsed.evidenceRefs.length || parsed.evidenceRefs.some(ref => !ref.trim())) throw new DomainError("Retain at least one evidence reference for owner review.", 400);
  const idempotencyKey = parsed.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) throw new DomainError("Outcome idempotency key must be 8–200 characters.", 400);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey})::bigint)`);
    const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id, leadId)).for("update");
    if (!lead) throw new DomainError("Deal not found.", 404);
    if (!lead.analysis || !lead.analysisSnapshotId || lead.analysisSnapshotId !== parsed.analysisSnapshotId) {
      throw new DomainError("The underwriting snapshot is missing or changed. Refresh the comparison before recording actuals.", 409);
    }
    const repairs = Object.fromEntries(repairLines);
    const repairsTotal = repairLines.reduce((sum, [, amount]) => sum + amount, 0);
    const predicted = prediction(lead);
    const actual = {
      ...(parsed.actualArv != null ? { arv: roundMoney(parsed.actualArv) } : {}),
      ...(repairLines.length ? { repairsByCategory: repairs, repairsTotal: roundMoney(repairsTotal) } : {}),
      source: parsed.source,
    };
    const delta = {
      ...(parsed.actualArv != null && predicted.arvExpected != null ? { arv: roundMoney(parsed.actualArv - predicted.arvExpected) } : {}),
      ...(repairLines.length && predicted.repairsExpected != null ? { repairs: roundMoney(repairsTotal - predicted.repairsExpected) } : {}),
    };
    const existing = await tx.select().from(outcomeObservationsTable).where(eq(outcomeObservationsTable.idempotencyKey, idempotencyKey)).limit(1);
    if (existing[0]) {
      const prior = existing[0];
      const bodyFingerprint = stableHash({ leadId, ...parsed, actual: { ...actual, source: parsed.source } });
      if (prior.leadId !== leadId || prior.payload.requestFingerprint !== bodyFingerprint) {
        throw new DomainError("Outcome idempotency key was already used for different actual evidence.", 409);
      }
      return rowToObservation(prior);
    }
    const verificationState = parsed.source === "SELLER_REPORTED"
      ? "SELLER_REPORTED_NOT_INDEPENDENTLY_VERIFIED"
      : ACTUAL_REVIEW_SOURCE;
    const observation = await insertObservation({
      leadId, idempotencyKey,
      eventType: "ACTUALS_REVIEW", sourceRecordType: "OWNER_OUTCOME_REVIEW",
      sourceRecordId: `owner-review:${stableHash({ leadId, idempotencyKey }).slice(0, 32)}`,
      source: parsed.source, occurredAt: new Date(eventMs), recordedAt: now,
      evidenceRefs: parsed.evidenceRefs, isSynthetic: isSynthetic(actor.id),
      confidence: parsed.confidence, verificationState,
      economicsSnapshotId: lead.analysisSnapshotId, decisionVersion: lead.version,
      predicted, actual, delta, causeCategories: parsed.causeCategories,
      payload: {
        note: parsed.note?.trim() || null,
        requestFingerprint: stableHash({ leadId, ...parsed, actual }),
        ...(isSynthetic(actor.id) ? { exerciseMode: "SYNTHETIC_TEST_FIXTURE" } : {}),
        sourceReferenceReview: "Owner-entered reference; the system has not independently validated document contents.",
      },
    }, tx);
    await audit(tx, actor.id, "OUTCOME_ACTUALS_RECORDED", leadId,
      `Outcome ${observation.id}; source ${parsed.source}; event ${new Date(eventMs).toISOString()}; recorded ${now.toISOString()}; snapshot ${lead.analysisSnapshotId}; actual/delta retained with evidence references. No historical estimate, authorized offer, or live rule was changed.`);
    await queueJob(tx, "EVALUATE_DECISION", leadId, `decision:${leadId}:outcome:${observation.id}`, actor.id,
      { trigger: "OUTCOME_ACTUALS_RECORDED", observationId: observation.id, leadVersion: lead.version });
    return rowToObservation(observation);
  });
}

export async function reviewOutcomeCalibration(id: string, decision: string, note: string, actor: OfferActor, now = new Date()) {
  assertOperationsRole(actor, ["OWNER"]);
  const allowed = new Set(["APPROVE_FOR_SEPARATE_CHANGE_REVIEW", "REJECT", "REOPEN_FOR_REVIEW"]);
  if (!allowed.has(decision) || note.trim().length < 5 || note.length > 1000) {
    throw new DomainError("Provide an allowed review decision and a concise reason.", 400);
  }
  return db.transaction(async tx => {
    const [row] = await tx.select().from(outcomeCalibrationReviewsTable)
      .where(eq(outcomeCalibrationReviewsTable.id, id)).for("update");
    if (!row) throw new DomainError("Calibration recommendation not found.", 404);
    if (row.isSynthetic || row.status === "TEST_ONLY_NOT_DEPLOYABLE") {
      throw new DomainError("Test-only calibration previews cannot be reviewed or applied.", 409);
    }
    const nextStatus = decision === "REJECT" ? "REJECTED"
      : decision === "REOPEN_FOR_REVIEW" ? "PENDING_REVIEW" : "APPROVED_NOT_DEPLOYED";
    const last = row.history.at(-1);
    if (last && last.actor === actor.id && last.action === decision && last.note === note.trim()) return {
      id: row.id, metricKey: row.metricKey, currentRuleVersion: row.currentRuleVersion,
      proposedRuleVersion: row.proposedRuleVersion, status: row.status,
      sampleSize: row.sampleSize, minimumSampleSize: row.minimumSampleSize,
      observationRefs: row.observationRefs, summary: row.summary, synthetic: row.isSynthetic,
    };
    if (decision === "REOPEN_FOR_REVIEW" && !["APPROVED_NOT_DEPLOYED", "REJECTED"].includes(row.status)) {
      throw new DomainError("Only an approved or rejected review can be reopened.", 409);
    }
    if (row.status !== "PENDING_REVIEW" && decision !== "REOPEN_FOR_REVIEW") {
      throw new DomainError("Only a current pending recommendation can be decided; reopen an approved/rejected review or refresh the evidence first.", 409);
    }
    const currentActualRows = await tx.select().from(outcomeObservationsTable).where(and(
      eq(outcomeObservationsTable.eventType, "ACTUALS_REVIEW"),
      eq(outcomeObservationsTable.isSynthetic, false),
      eq(outcomeObservationsTable.verificationState, ACTUAL_REVIEW_SOURCE),
    ));
    const metricKey = row.metricKey === "ARV" ? "arv" : "repairs";
    const currentRefs = currentActualRows
      .filter(item => item.confidence !== null && item.confidence >= 0.8 && num(obj(item.delta)[metricKey]) !== null)
      .map(item => item.id).sort();
    if (stableHash(currentRefs) !== stableHash([...row.observationRefs].sort())) {
      throw new DomainError("Calibration evidence changed after this recommendation was created. Refresh before review.", 409);
    }
    const history = [...row.history, { action: decision, fromStatus: row.status, toStatus: nextStatus, note: note.trim(), actor: actor.id, at: now.toISOString() }];
    const [updated] = await tx.update(outcomeCalibrationReviewsTable).set({
      status: nextStatus, reviewedBy: actor.id, reviewedAt: now, history, updatedAt: now,
    }).where(eq(outcomeCalibrationReviewsTable.id, row.id)).returning();
    if (!updated) throw new Error("Calibration review update failed.");
    await audit(tx, actor.id, "OUTCOME_CALIBRATION_REVIEWED", "outcome-calibration",
      `Recommendation ${row.id}: ${decision}; ${note.trim()}. Rule ${row.currentRuleVersion} remains active; no automatic deployment or economics change.`);
    return {
      id: updated.id, metricKey: updated.metricKey, currentRuleVersion: updated.currentRuleVersion,
      proposedRuleVersion: updated.proposedRuleVersion, status: updated.status,
      sampleSize: updated.sampleSize, minimumSampleSize: updated.minimumSampleSize,
      observationRefs: updated.observationRefs, summary: updated.summary, synthetic: updated.isSynthetic,
    };
  });
}

/** Test harness only: keeps synthetic threshold-path previews quarantined. */
export async function persistSyntheticCalibrationPreviewForExercise(now = new Date()) {
  const metric: CalibrationMetric = {
    metricKey: "REPAIRS", currentRuleVersion: "repair-estimate-rates-v1",
    values: Array.from({ length: MIN_CALIBRATION_SAMPLE }, (_, index) => ({
      observationId: `SYNTHETIC_TEST_FIXTURE:${index + 1}`,
      delta: 125 + index, isSynthetic: true,
      verificationState: ACTUAL_REVIEW_SOURCE, confidence: 0.9,
    })),
  };
  return ensureCalibrationRecommendation(metric, now, true);
}

export async function syntheticOutcomeSummaryForExercise() {
  return db.select().from(outcomeObservationsTable)
    .where(and(eq(outcomeObservationsTable.isSynthetic, true), eq(outcomeObservationsTable.eventType, "ACTUALS_REVIEW")));
}

export type OutcomeActualsInputType = z.infer<typeof RecordOutcomeActualsBody>;
export type OutcomeLearningRecord = ReturnType<typeof rowToObservation>;
export type CalibrationReviewRecord = OutcomeCalibrationReviewRow;
