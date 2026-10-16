import { and, eq } from "drizzle-orm";
import { db, auditTable } from "@workspace/db";
import {
  GetAcquisitionQueueResponse,
  RecordAcquisitionQueueSelectionResponse,
} from "@workspace/api-zod";
import {
  acquisitionEvidenceScore,
  buildCallBrief,
  callReadyBlockers,
  compareAcquisitionQueue,
  contactBlockerCode,
  DomainError,
  type AcquisitionQueueItem,
  type LeadDetail,
} from "@workspace/deal-domain";
import { audit, leadDetail, listLeads, lockedLead } from "./deal-store";
import { getSellerContactPaths } from "./seller-contact-store";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const PROGRESSED_STAGES = new Set([
  "CALL_READY", "CONTACTED", "CONVERSATION", "OFFER_READY", "OFFER_SENT",
  "NEGOTIATING", "CONTRACT_PENDING",
]);

function acquisitionStatus(detail: LeadDetail): string | null {
  return detail.lead.propertyQualification?.status ?? null;
}

function isInAcquisitionQueue(detail: LeadDetail) {
  if (["CLOSED", "DEAD_DEAL", "PASS"].includes(detail.lead.stage)) return false;
  const status = acquisitionStatus(detail);
  if (status === "DISQUALIFIED") return false;
  return status === "QUALIFIED_LEAD" || status === "CALL_READY" || PROGRESSED_STAGES.has(detail.lead.stage);
}

function primaryBlocker(
  detail: LeadDetail,
  directRouteStatus: string,
  role: string,
  now: Date,
  selectedPhoneRoute: string | null,
): { code: AcquisitionQueueItem["blockerCode"]; text: string; nextAction: string } | null {
  const qualification = detail.lead.propertyQualification;
  if (!qualification || !["QUALIFIED_LEAD", "CALL_READY"].includes(qualification.status)) {
    return {
      code: "PROPERTY_RELEVANCE_REVIEW",
      text: "A current qualified, provenance-backed acquisition decision is not recorded.",
      nextAction: "Review the property's relevance signals and source evidence; qualify it or record a pass before seller contact.",
    };
  }

  const contactCode = contactBlockerCode(directRouteStatus);
  if (contactCode) {
    const contactReason = directRouteStatus === "POSTAL_ONLY"
      ? "Only a mailing address is recorded; it is not a phone route."
      : directRouteStatus === "NO_DIRECT_ROUTE"
        ? "No permitted direct seller contact route is recorded."
        : directRouteStatus === "STALE_ROUTE"
          ? "The available direct contact evidence is stale."
          : directRouteStatus === "CONFLICTING_ROUTE"
            ? "Direct contact evidence has an unresolved recipient or role conflict."
            : "The available contact route is not reviewed and confirmed as a usable phone route.";
    return {
      code: contactCode,
      text: contactReason,
      nextAction: directRouteStatus === "STALE_ROUTE"
        ? "Refresh the direct route from a permitted source and review its provenance."
        : directRouteStatus === "CONFLICTING_ROUTE"
          ? "Resolve the contact identity/role conflict using source-backed evidence."
          : directRouteStatus === "NEEDS_REVIEW"
            ? "Review the contact route's source, permission, freshness, and recipient before any call."
            : "Obtain and review legitimate direct phone evidence; a postal address, email, or web route does not clear CALL NEXT.",
    };
  }

  const analysis = detail.analysis;
  if (!analysis) {
    return {
      code: "UNDERWRITING_MISSING",
      text: "No current evidence-reviewed underwriting analysis is saved.",
      nextAction: "Complete and save current comps, condition-backed repairs, and deterministic underwriting before seller-call readiness.",
    };
  }
  const calculatedAt = Date.parse(analysis.calculatedAt);
  const age = now.getTime() - calculatedAt;
  if (!Number.isFinite(calculatedAt) || age < 0 || age >= 7 * 86_400_000) {
    return {
      code: "UNDERWRITING_STALE",
      text: "The underwriting snapshot is invalid, future-dated, or at least seven days old.",
      nextAction: "Refresh source evidence and rerun deterministic underwriting; stale analysis cannot authorize call readiness.",
    };
  }
  const gateLead = {
    ...detail.lead,
    // The selected, permitted route is the readiness source of truth.
    sellerPhone: selectedPhoneRoute ?? "",
  };
  const blockers = callReadyBlockers(gateLead, analysis, now)
    .filter(blocker => !blocker.toLowerCase().includes("seller phone"));
  if (blockers.length || !["STRONG", "NEGOTIABLE"].includes(analysis.classification)) {
    const first = blockers[0] ?? `Underwriting classification is ${analysis.classification}, not STRONG or NEGOTIABLE.`;
    return {
      code: "UNDERWRITING_BLOCKED",
      text: first,
      nextAction: `Resolve the current underwriting blocker: ${first}`,
    };
  }
  if (detail.lead.followUpAt && Date.parse(detail.lead.followUpAt) > now.getTime()) {
    return {
      code: "FOLLOW_UP_NOT_DUE",
      text: `The persisted follow-up is not due until ${detail.lead.followUpAt}.`,
      nextAction: "Wait until the recorded follow-up time; do not call early.",
    };
  }
  if (["STRONG", "NEGOTIABLE"].includes(detail.lead.stage)) {
    return {
      code: "CALL_READY_TRANSITION",
      text: `Underwriting is ${detail.lead.stage}, but the guarded CALL_READY transition has not been recorded.`,
      nextAction: "Review the saved seller brief and record the authorized CALL_READY transition before starting a call session.",
    };
  }
  if (!PROGRESSED_STAGES.has(detail.lead.stage)) {
    return {
      code: "CALL_READY_TRANSITION",
      text: `The current deal stage ${detail.lead.stage} is not eligible for a seller call.`,
      nextAction: "Review the deal stage and complete its guarded transition before opening call work.",
    };
  }
  if (!["OWNER", "OPERATOR"].includes(role)) {
    return {
      code: "OPERATOR_AUTH_REQUIRED",
      text: "This account can review the queue but cannot perform seller calls.",
      nextAction: "An owner or operator must open the call work session.",
    };
  }
  return null;
}

async function buildItem(detail: LeadDetail, role: string, now: Date, rank: number, query: typeof db | Tx = db): Promise<AcquisitionQueueItem> {
  const readiness = await getSellerContactPaths(detail.lead.id, now, query);
  const qualification = detail.lead.propertyQualification;
  const propertySignals = qualification?.signals ?? [];
  const evidenceScore = acquisitionEvidenceScore(propertySignals, now);
  const selectedPhone = readiness.selectedPhonePath;
  const blocker = primaryBlocker(detail, readiness.directRouteStatus, role, now, selectedPhone?.routeValue ?? null);
  const decision = blocker ? "BLOCKED" : "CALL_NEXT";
  const callBrief = !blocker && detail.analysis && selectedPhone?.routeValue
    ? {
        ...buildCallBrief(
          { ...detail.lead, sellerPhone: selectedPhone.routeValue },
          detail.intelligence,
          detail.analysis,
          detail.offers.find(offer => ["AUTHORIZED", "COMMUNICATED"].includes(offer.effectiveStatus)) ?? null,
          now,
        ),
        questions: buildCallBrief(
          { ...detail.lead, sellerPhone: selectedPhone.routeValue },
          detail.intelligence,
          detail.analysis,
          detail.offers.find(offer => ["AUTHORIZED", "COMMUNICATED"].includes(offer.effectiveStatus)) ?? null,
          now,
        ).questions.slice(0, 5),
      }
    : null;
  return {
    lead: detail.lead,
    decision,
    rank,
    evidenceScore,
    rankingReason: "",
    propertySignals,
    contactReadiness: readiness,
    blockerCode: blocker?.code ?? null,
    blocker: blocker?.text ?? null,
    nextAction: blocker?.nextAction ?? detail.lead.nextAction,
    callBrief,
  };
}

function rankingReason(item: AcquisitionQueueItem, position: number, now: Date) {
  const scoreable = item.propertySignals.filter(signal =>
    ["VERIFIED", "OBSERVED", "INDICATED"].includes(signal.classification)
      && Number.isFinite(Date.parse(signal.capturedAt))
      && Date.parse(signal.capturedAt) <= now.getTime());
  const selected = [...scoreable].sort((a, b) =>
    b.scoreContribution - a.scoreContribution
      || a.capturedAt.localeCompare(b.capturedAt)
      || a.id.localeCompare(b.id)).slice(0, 2);
  const evidenceWhy = selected.length
    ? `${selected.length} highest-scoring persisted VERIFIED/OBSERVED/INDICATED signal(s) support ${item.evidenceScore}/100 queue points: ${selected.map(signal => `${signal.classification} ${signal.key} (${signal.scoreContribution} points)`).join("; ")}.`
    : "No persisted non-hypothetical relevance signal contributes queue points.";
  const hypotheses = item.propertySignals.filter(signal => signal.classification === "AI_HYPOTHESIS").length;
  return `Rank ${position}. ${item.decision === "CALL_NEXT" ? "Callable work ranks ahead of blocked work." : `Blocked by: ${item.blocker}` } ${evidenceWhy} ${hypotheses ? `${hypotheses} AI hypothesis signal(s) are visible but score zero.` : "AI hypotheses score zero."} Ordering is deterministic: call eligibility, evidence score, follow-up due time, creation time, then lead ID.`;
}

export async function acquisitionQueue(role: string, now = new Date()) {
  const leads = await listLeads();
  const details = await Promise.all(leads.map(lead => leadDetail(lead.id, undefined, now)));
  const qualified = details.filter(isInAcquisitionQueue);
  const items = await Promise.all(qualified.map(detail => buildItem(detail, role, now, 1)));
  const sorted = items
    .map(item => ({
      item,
      followUpAt: item.lead.followUpAt ?? null,
      createdAt: item.lead.createdAt,
      id: item.lead.id,
    }))
    .sort((a, b) => compareAcquisitionQueue({
      decision: a.item.decision,
      evidenceScore: a.item.evidenceScore,
      followUpAt: a.followUpAt,
      createdAt: a.createdAt,
      id: a.id,
    }, {
      decision: b.item.decision,
      evidenceScore: b.item.evidenceScore,
      followUpAt: b.followUpAt,
      createdAt: b.createdAt,
      id: b.id,
    }))
    .map(({ item }, index) => ({
      ...item,
      rank: index + 1,
      rankingReason: rankingReason(item, index + 1, now),
    }));
  return GetAcquisitionQueueResponse.parse({ generatedAt: now.toISOString(), total: sorted.length, items: sorted });
}

async function recordQueueEvent(
  id: string,
  version: number,
  actor: string,
  role: string,
  event: "QUEUE_SELECTED" | "CALL_SESSION_STARTED",
  now: Date,
) {
  return db.transaction(async tx => {
    const row = await lockedLead(tx, id, version);
    const detail = await leadDetail(id, tx, now);
    const item = await buildItem(detail, role, now, 1, tx);
    if (event === "CALL_SESSION_STARTED" && item.decision !== "CALL_NEXT") {
      throw new DomainError(`${item.blocker ?? "This acquisition is not ready for a call."} Next action: ${item.nextAction}`, 409);
    }
    const contactBlocked = item.blockerCode?.startsWith("CONTACT_") ?? false;
    const action = event === "QUEUE_SELECTED" ? "ACQUISITION_QUEUE_SELECTED" : "CALL_SESSION_STARTED";
    const detailText = `Lead version ${row.version}; ${item.decision}; evidence score ${item.evidenceScore}/100. ${item.blocker ?? "Current direct route and underwriting gates passed."} Next: ${item.nextAction}. No call, message, or economics change was made.`;
    const [priorEvent] = await tx.select().from(auditTable).where(and(
      eq(auditTable.actor, actor), eq(auditTable.action, action), eq(auditTable.entityId, id),
      eq(auditTable.detail, detailText),
    )).orderBy(auditTable.createdAt).limit(1);
    if (priorEvent) return RecordAcquisitionQueueSelectionResponse.parse({
      leadId:id,event,decision:item.decision,recordedAt:priorEvent.createdAt.toISOString(),
      blocker:item.blocker,nextAction:item.nextAction,
    });
    await audit(
      tx,
      actor,
      action,
      id,
      detailText,
    );
    const [persistedEvent] = await tx.select().from(auditTable).where(and(
      eq(auditTable.actor, actor), eq(auditTable.action, action), eq(auditTable.entityId, id),
      eq(auditTable.detail, detailText),
    )).orderBy(auditTable.createdAt).limit(1);
    if (event === "QUEUE_SELECTED" && contactBlocked) {
      await audit(tx, actor, "ACQUISITION_CONTACT_BLOCKED", id,
        `${item.contactReadiness.directRouteStatus}: ${item.blocker}. Next: ${item.nextAction}`);
    }
    return RecordAcquisitionQueueSelectionResponse.parse({
      leadId: id,
      event,
      decision: item.decision,
      recordedAt: persistedEvent?.createdAt.toISOString() ?? now.toISOString(),
      blocker: item.blocker,
      nextAction: item.nextAction,
    });
  });
}

export function recordQueueSelection(id: string, version: number, actor: string, role: string, now = new Date()) {
  return recordQueueEvent(id, version, actor, role, "QUEUE_SELECTED", now);
}

export function startCallSession(id: string, version: number, actor: string, role: string, now = new Date()) {
  if (!["OWNER", "OPERATOR"].includes(role)) throw new DomainError("Only an owner or operator can start seller call work.", 403);
  return recordQueueEvent(id, version, actor, role, "CALL_SESSION_STARTED", now);
}
