import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  contractsTable,
  distributionPacketsTable,
  distributionRecipientsTable,
  leadsTable,
  transactionReadinessExceptionsTable,
  type TransactionReadinessExceptionRow,
} from "@workspace/db";
import { GetTransactionReadinessResponse } from "@workspace/api-zod";
import type { DealContract } from "@workspace/deal-domain";
import { dealOperations } from "./matching-store";
import { audit, leadDetail } from "./deal-store";
import { contractRecord } from "./operations-records";
import { getTransactionDocumentReadiness } from "./transaction-document-registry";
import { buyerOutreachReadiness } from "./buyer-outreach";
import { evaluateLeadDecision } from "./intelligence-decision-store";
import { lockDealEconomics } from "./locked-economics";
import { calendarDateInZone, classifyMilestoneDeadline, scheduleCoversAllMilestones, transactionTermsHash } from "./transaction-deadlines";

type ExceptionCategory = "DEADLINE" | "EVIDENCE" | "DOCUMENT" | "PROVIDER" | "BUYER" | "AUTHORITY" | "INTEGRITY";
type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type Role = "OWNER" | "OPERATOR" | "SYSTEM";
type IssueDraft = {
  issueKey: string;
  category: ExceptionCategory;
  severity: Severity;
  reason: string;
  evidenceRefs: string[];
  ownerRole: Role;
  nextActionCode: string;
  nextAction: string;
  eventAt: Date | null;
};
type EvidenceDecision = {
  evaluationId?: string;
  evidenceRefs?: string[];
  conflicts?: unknown[];
  staleEvidence?: unknown[];
};

const SYSTEM_ACTOR = { id: "system:transaction-readiness", role: "OWNER" as const };
const DAY = 86_400_000;
const ACTIVE_CONTRACT_STATES = new Set(["DRAFT", "UNDER_CONTRACT", "CLOSING"]);
const TERMINAL_CONTRACT_STATES = new Set(["CLOSED", "CANCELLED"]);
const OPEN_DOCUMENT_STATES = new Set(["DRAFT", "PREPARED_FOR_REVIEW", "APPROVED_TO_SEND", "SENT", "SIGNING_IN_PROGRESS"]);

export function classifyClosingDeadline(closingAt: Date | string | null | undefined, now: Date):
  "INVALID" | "OVERDUE" | "UPCOMING" | "ON_TRACK" {
  const date = validTimestamp(closingAt);
  if (!date) return "INVALID";
  const delta = date.getTime() - now.getTime();
  if (delta < 0) return "OVERDUE";
  if (delta <= 7 * DAY) return "UPCOMING";
  return "ON_TRACK";
}

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function evidenceRef(...parts: unknown[]): string {
  return parts.filter(value => value !== null && value !== undefined && String(value).length > 0).join(":");
}

function syntheticLead(detail: Awaited<ReturnType<typeof leadDetail>>): boolean {
  const payload = detail.lead as unknown as Record<string, unknown>;
  const source = [payload.source, payload.sourceType, payload.provenance, payload.exerciseContext]
    .map(value => typeof value === "string" ? value : JSON.stringify(value ?? ""))
    .join(" ");
  return /\bsynthetic\b|\btest fixture\b/i.test(source);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function issue(
  issueKey: string,
  category: ExceptionCategory,
  severity: Severity,
  reason: string,
  evidenceRefs: string[],
  ownerRole: Role,
  nextActionCode: string,
  nextAction: string,
  eventAt: Date | null = null,
): IssueDraft {
  return { issueKey, category, severity, reason, evidenceRefs: [...new Set(evidenceRefs)], ownerRole, nextActionCode, nextAction, eventAt };
}

function validTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function milestoneReferences(contractId: string, milestone: Record<string, unknown> | undefined): string[] {
  if (!milestone) return [];
  return [
    evidenceRef("contract", contractId, "milestone", milestone.kind as string, "evidence", milestone.evidenceUrl as string),
    evidenceRef("occurred-at", milestone.effectiveAt as string),
    evidenceRef("recorded-at", milestone.recordedAt as string),
  ].filter(Boolean);
}

function milestoneProblem(
  contract: DealContract,
  kind: string,
  currentMatch: { eligible?: boolean; status?: string } | undefined,
  now: Date,
): { missing: boolean; invalidReason: string | null; eventAt: Date | null; refs: string[] } {
  const milestones = contract.milestones as unknown as Array<Record<string, unknown>>;
  const milestone = milestones.find(item => item.kind === kind);
  if (!milestone) return { missing: true, invalidReason: null, eventAt: null, refs: [] };
  const refs = milestoneReferences(contract.id, milestone);
  const effectiveAt = validTimestamp(milestone.effectiveAt);
  const recordedAt = validTimestamp(milestone.recordedAt);
  if (!milestone.evidenceUrl || typeof milestone.evidenceUrl !== "string" || !effectiveAt || !recordedAt) {
    return { missing: false, invalidReason: "The recorded milestone lacks a linked evidence reference or distinct valid occurred-at and recorded-at timestamps.", eventAt: effectiveAt, refs };
  }
  if (effectiveAt.getTime() > now.getTime() + 60_000) {
    return { missing: false, invalidReason: "The milestone event time is in the future and cannot establish completion.", eventAt: effectiveAt, refs };
  }
  if (kind === "EARNEST_MONEY_CONFIRMED") {
    const valid = milestone.currency === "USD" &&
      ["ESCROW_RECEIPT", "WIRE_CONFIRMATION"].includes(String(milestone.evidenceKind)) &&
      typeof milestone.amount === "number" && Math.abs(milestone.amount - contract.earnestMoney) <= 0.005 &&
      !!String(milestone.counterpartyName ?? "").trim() && !!String(milestone.paymentReference ?? "").trim() &&
      !!contract.sellerSignedAt && !!contract.acquisitionSignedAt &&
      effectiveAt.getTime() >= Math.max(Date.parse(contract.sellerSignedAt), Date.parse(contract.acquisitionSignedAt));
    if (!valid) return { missing: false, invalidReason: "Earnest-money evidence does not match the authorized amount, signatures, escrow/wire proof, counterparty, masked reference, and event time.", eventAt: effectiveAt, refs };
  }
  if (kind === "FUNDS_CONFIRMED") {
    const buyer = contract.commitmentSnapshot?.buyer as unknown as Record<string, unknown> | undefined;
    const evidenceAt = validTimestamp(buyer?.evidenceAt);
    const committedAt = validTimestamp(contract.buyerCommittedAt);
    const valid = milestone.currency === "USD" &&
      ["BANK_CONFIRMATION", "LENDER_LETTER", "REDACTED_STATEMENT", "ESCROW_RECEIPT"].includes(String(milestone.evidenceKind)) &&
      typeof milestone.amount === "number" && typeof buyer?.availableFunds === "number" &&
      Math.abs(milestone.amount - buyer.availableFunds) <= 0.005 &&
      milestone.evidenceUrl === buyer.fundingEvidenceUrl &&
      !!String(milestone.counterpartyName ?? "").trim() && !!String(milestone.paymentReference ?? "").trim() &&
      !!evidenceAt && !!committedAt && effectiveAt.getTime() >= evidenceAt.getTime() &&
      effectiveAt.getTime() >= committedAt.getTime() &&
      currentMatch?.eligible === true && currentMatch.status === "COMMITTED";
    if (!valid) return { missing: false, invalidReason: "Buyer-funds evidence is stale, incomplete, mismatched to the committed buyer, or the buyer no longer passes current eligibility.", eventAt: effectiveAt, refs };
  }
  if (kind === "ASSIGNMENT_SIGNED" && (!contract.assignmentAllowed || !contract.committedBuyerId || currentMatch?.status !== "COMMITTED")) {
    return { missing: false, invalidReason: "Assignment evidence does not correspond to an assignment-authorized contract with a committed buyer.", eventAt: effectiveAt, refs };
  }
  return { missing: false, invalidReason: null, eventAt: effectiveAt, refs };
}

function deriveIssues(input: {
  contract: DealContract;
  contractVersion: number;
  leadVersion: number;
  leadStage: string;
  detail: Awaited<ReturnType<typeof leadDetail>>;
  operation: Awaited<ReturnType<typeof dealOperations>>;
  decision: EvidenceDecision;
  documentReadiness: Awaited<ReturnType<typeof getTransactionDocumentReadiness>>;
  packets: Array<typeof distributionPacketsTable.$inferSelect>;
  recipients: Array<typeof distributionRecipientsTable.$inferSelect>;
  now: Date;
}): IssueDraft[] {
  const { contract, detail, operation, decision, documentReadiness, packets, recipients, now } = input;
  const issues: IssueDraft[] = [];
  const live = ACTIVE_CONTRACT_STATES.has(contract.status);
  if (!live) return issues;
  const closeAt = validTimestamp(contract.closingAt);
  const closeRef = evidenceRef("contract", contract.id, "closingAt", contract.closingAt, "record-version", input.contractVersion);
  const deadlineState = classifyClosingDeadline(contract.closingAt, now);
  if (deadlineState === "INVALID") {
    issues.push(issue("CLOSING_DATE_INVALID", "INTEGRITY", "CRITICAL",
      "The persisted contract has no valid closing instant; no date is inferred or substituted.",
      [evidenceRef("contract", contract.id, "closingAt")], "OWNER", "REVIEW_CONTRACT_DATE",
      "Owner: verify the executed terms and record the correct closing date with evidence."));
  } else if (closeAt) {
    const delta = closeAt.getTime() - now.getTime();
    if (deadlineState === "OVERDUE") {
      issues.push(issue(`CLOSING_DEADLINE_OVERDUE:${closeAt.toISOString()}`, "DEADLINE", "CRITICAL",
        "The persisted closing date has passed and the transaction is not terminal. The system has not extended the date.",
        [closeRef, evidenceRef("contract", contract.id, "status", contract.status)], "OWNER", "RESOLVE_MISSED_CLOSING_DATE",
        "Owner: verify closing proof or an executed, evidence-backed date amendment; do not treat a reminder or click as an extension.", closeAt));
    } else if (deadlineState === "UPCOMING") {
      issues.push(issue(`CLOSING_DEADLINE_UPCOMING:${closeAt.toISOString()}`, "DEADLINE", delta <= DAY ? "HIGH" : "MEDIUM",
        `The persisted closing date is within ${Math.ceil(delta / DAY)} day(s); incomplete milestones remain evidence-gated.`,
        [closeRef, evidenceRef("contract", contract.id, "status", contract.status)], "OPERATOR", "REVIEW_CLOSING_READINESS",
        "Review the persisted closing evidence and resolve any listed milestone gaps before the contract date.", closeAt));
    }
  }

  const operationContract = operation.contract;
  const matches = operation.matches;
  const currentMatch = contract.committedBuyerId
    ? matches.find(match => match.buyerId === contract.committedBuyerId)
    : undefined;
  if (contract.status === "UNDER_CONTRACT" || contract.status === "CLOSING") {
    const schedule = contract.deadlineSchedule ?? null;
    const currentTermsHash = transactionTermsHash(contract);
    if (!schedule) {
      issues.push(issue("MILESTONE_SCHEDULE_REVIEW_REQUIRED", "DEADLINE", "HIGH",
        "No owner-reviewed due-date schedule is linked to the executed agreement. Dates are not inferred from the closing date.",
        [evidenceRef("contract", contract.id, "executedDocumentUrl", contract.executedDocumentUrl,
          "sellerSignedAt", contract.sellerSignedAt, "acquisitionSignedAt", contract.acquisitionSignedAt)],
        "OWNER", "REVIEW_TRANSACTION_DEADLINES",
        "Owner: review title, inspection, earnest-money, assignment and buyer-funds timing against the latest executed terms."));
    } else if (!scheduleCoversAllMilestones(schedule)) {
      issues.push(issue("MILESTONE_SCHEDULE_INCOMPLETE", "INTEGRITY", "HIGH",
        "The persisted owner-reviewed schedule does not contain exactly one disposition for every supported transaction milestone.",
        [evidenceRef("deadline-schedule", contract.id, "version", schedule.version, "termsHash", schedule.termsHash)],
        "OWNER", "REVIEW_TRANSACTION_DEADLINES",
        "Owner: reconcile the schedule against the latest executed terms; do not infer missing dates."));
    } else if (schedule.termsHash !== currentTermsHash) {
      issues.push(issue("MILESTONE_SCHEDULE_STALE", "EVIDENCE", "HIGH",
        "The schedule was reviewed against different contract terms or parties and cannot be relied on until re-reviewed.",
        [evidenceRef("deadline-schedule", contract.id, "version", schedule.version, "sourceTermsHash", schedule.termsHash),
          evidenceRef("contract", contract.id, "currentTermsHash", currentTermsHash, "version", input.contractVersion)],
        "OWNER", "REVIEW_TRANSACTION_DEADLINES",
        "Owner: review the latest executed agreement/amendment and record a new schedule version."));
    } else {
      for (const item of schedule.items) {
        const state = classifyMilestoneDeadline(item, now);
        if (state === "NOT_APPLICABLE" || state === "NOT_DATED" || state === "ON_TRACK") continue;
        const milestone = milestoneProblem(contract,item.kind,currentMatch,now);
        const complete = !milestone.missing && !milestone.invalidReason && milestone.refs.length > 0;
        if (complete) continue;
        const evidence = [
          evidenceRef("deadline-schedule", contract.id, "version", schedule.version,
            "milestone", item.kind, "disposition", item.disposition, "dueDate", item.dueDate,
            "timeZone", item.timeZone, "source", schedule.sourceEvidenceUrl,
            "sourceEffectiveAt", schedule.sourceEffectiveAt, "recordedAt", schedule.recordedAt),
          ...milestone.refs,
        ];
        if (state === "INVALID") {
          issues.push(issue(`MILESTONE_DEADLINE_INVALID:${item.kind}`, "INTEGRITY", "HIGH",
            `The ${item.kind.replace(/_/g," ").toLowerCase()} deadline is not a valid calendar date/time-zone pair.`,
            evidence, "OWNER", "REVIEW_TRANSACTION_DEADLINES",
            "Owner: correct the date and time zone from the executed terms; do not substitute an assumed date."));
        } else {
          const overdue = state === "OVERDUE";
          const dueToday = !!item.timeZone && calendarDateInZone(now,item.timeZone)===item.dueDate;
          issues.push(issue(`MILESTONE_DEADLINE_${overdue?"OVERDUE":"UPCOMING"}:${item.kind}:${item.dueDate}`,
            "DEADLINE", overdue?"CRITICAL":dueToday?"HIGH":"MEDIUM",
            `${item.kind.replace(/_/g," ").toLowerCase()} is ${overdue?"past its owner-reviewed due date":"due within seven calendar days"}${milestone.invalidReason?`; recorded evidence is not valid: ${milestone.invalidReason}`:milestone.missing?"; completion evidence is missing":""}.`,
            evidence, "OWNER", overdue?"RESOLVE_OVERDUE_MILESTONE":"REVIEW_UPCOMING_MILESTONE",
            overdue
              ? "Owner: verify milestone completion or record the exact current state and evidence; a deadline reminder does not extend the contract."
              : "Owner: confirm readiness and record completion only after the actual milestone occurs with supporting evidence."));
        }
      }
    }
  }
  const sourceOffer = detail.offers.find(offer => offer.id === contract.offerId);
  if (contract.status === "DRAFT" && (!sourceOffer || sourceOffer.effectiveStatus !== "COMMUNICATED" ||
      detail.analysisSnapshotId !== sourceOffer.analysisSnapshotId)) {
    issues.push(issue("SELLER_OFFER_EXPIRED_OR_STALE", "AUTHORITY", "HIGH",
      "The draft contract is not tied to the currently communicated seller offer and its current analysis snapshot.",
      [evidenceRef("contract", contract.id, "offer", contract.offerId), evidenceRef("lead", detail.lead.id, "analysis", detail.analysisSnapshotId ?? "missing"),
        evidenceRef("offer", sourceOffer?.id, "status", sourceOffer?.effectiveStatus, "expires", sourceOffer?.expiresAt)],
      "OWNER", "REAUTHORIZE_CURRENT_OFFER", "Owner: refresh underwriting and obtain current offer authority before using this draft."));
  } else if (contract.status === "DRAFT" && sourceOffer?.expiresAt && Date.parse(sourceOffer.expiresAt) <= now.getTime()) {
    issues.push(issue("SELLER_OFFER_EXPIRED", "AUTHORITY", "HIGH",
      "The exact communicated seller offer has expired; the existing authorization cannot be reused.",
      [evidenceRef("offer", sourceOffer.id, "expiresAt", sourceOffer.expiresAt), evidenceRef("contract", contract.id, "offerId", contract.offerId)],
      "OWNER", "REAUTHORIZE_CURRENT_OFFER", "Owner: refresh the offer using current evidence and obtain new authorization."));
  }

  if (contract.purchasePrice !== sourceOffer?.amount ||
      contract.assignmentTarget !== detail.analysis?.assumptions?.assignmentTarget ||
      contract.earnestMoney !== sourceOffer?.earnestMoney ||
      contract.assignmentAllowed !== sourceOffer?.assignmentIntent ||
      sourceOffer?.analysisSnapshotId !== detail.analysisSnapshotId) {
    issues.push(issue("CONTRACT_ECONOMICS_CONFLICT", "INTEGRITY", "CRITICAL",
      "Contract economics, assignment terms, or underlying analysis version differ from the persisted authorized offer/underwriting terms.",
      [evidenceRef("contract", contract.id, "version", input.contractVersion, "price", contract.purchasePrice,
        "fee", contract.assignmentTarget, "emd", contract.earnestMoney),
        evidenceRef("offer", sourceOffer?.id, "price", sourceOffer?.amount, "fee", detail.analysis?.assumptions?.assignmentTarget,
          "emd", sourceOffer?.earnestMoney)],
      "OWNER", "REVIEW_AUTHORIZED_ECONOMICS", "Owner: reconcile the exact authorized offer and contract terms; create a new version if a material change is approved."));
  }

  if (!contract.executedDocumentUrl || !contract.sellerSignedAt || !contract.acquisitionSignedAt) {
    const prepared = contract.documents?.some(document =>
      document.kind === "PURCHASE_TERMS_REVIEW" && document.status === "PREPARED_FOR_REVIEW");
    issues.push(issue("EXECUTED_ACQUISITION_EVIDENCE_MISSING", "DOCUMENT",
      contract.status === "DRAFT" ? "HIGH" : "CRITICAL",
      `No executed acquisition document with both actual signature timestamps is recorded${prepared ? "; a prepared review worksheet is not signature evidence" : ""}.`,
      [evidenceRef("contract", contract.id, "status", contract.status, "executedDocumentUrl", contract.executedDocumentUrl ?? "missing"),
        evidenceRef("contract", contract.id, "sellerSignedAt", contract.sellerSignedAt ?? "missing"),
        evidenceRef("contract", contract.id, "acquisitionSignedAt", contract.acquisitionSignedAt ?? "missing")],
      "OWNER", "OBTAIN_EXECUTED_AGREEMENT_EVIDENCE",
      "Owner: use an approved jurisdiction-specific agreement and record independently supported signature/execution evidence. The worksheet cannot be signed as a contract."));
  }

  const requiredTemplateKeys = ["PURCHASE_AGREEMENT", ...(contract.assignmentAllowed ? ["ASSIGNMENT_AGREEMENT"] : [])];
  for (const templateKey of requiredTemplateKeys) {
    const template = documentReadiness.templates.find(item => item.key === templateKey);
    if (!template || template.status !== "APPROVED_LEGAL" || !template.templateHash || !template.approvalEvidenceRef) {
      issues.push(issue(`LEGAL_TEMPLATE_UNAVAILABLE:${templateKey}`, "DOCUMENT", "HIGH",
        `No approval-evidenced ${templateKey.toLowerCase().replaceAll("_", " ")} template is available for ${documentReadiness.jurisdiction ?? "the property's jurisdiction"}. The review worksheet is not a legal form.`,
        [evidenceRef("template-registry", templateKey, template?.jurisdiction ?? documentReadiness.jurisdiction ?? "unknown",
          "status", template?.status ?? "MISSING", "approval", template?.approvalEvidenceRef ?? "missing")],
        "OWNER", "REGISTER_APPROVED_JURISDICTION_TEMPLATE",
        `Owner: register an actually approved ${templateKey.toLowerCase().replaceAll("_", " ")} template with its approval evidence; do not send the review worksheet.`));
    }
  }

  if (documentReadiness.signingProvider.status !== "CONNECTED") {
    issues.push(issue("SIGNING_PROVIDER_UNAVAILABLE", "PROVIDER", "HIGH",
      "No signing provider is connected. The system cannot send a signing envelope, verify a signature, or claim execution.",
      [evidenceRef("signing-provider", "status", documentReadiness.signingProvider.status, "reason", documentReadiness.signingProvider.reason)],
      "OWNER", "CONNECT_SIGNING_PROVIDER",
      "Connect a supported signing provider or continue only with independently reviewed external signature evidence."));
  }
  if (String(documentReadiness.storage.status) !== "MANAGED_PRIVATE") {
    issues.push(issue("PRIVATE_DOCUMENT_STORAGE_UNAVAILABLE", "DOCUMENT", "HIGH",
      "Managed private object storage is unavailable. Current review-copy bytes remain in the authenticated persistent database-blob boundary; private-document availability is not claimed as managed storage.",
      [evidenceRef("document-storage", "status", documentReadiness.storage.status,
        "activeStore", documentReadiness.storage.activeStore)],
      "OWNER", "CONNECT_PRIVATE_DOCUMENT_STORAGE",
      "Connect the approved private document store and migrate/verify protected document references before expanding transaction-document use."));
  }

  const docs = contract.documents ?? [];
  const liveDocs = docs.filter(document => OPEN_DOCUMENT_STATES.has(document.status));
  if (contract.status === "DRAFT" && !liveDocs.some(document => document.kind === "PURCHASE_TERMS_REVIEW")) {
    issues.push(issue("PURCHASE_REVIEW_COPY_MISSING", "DOCUMENT", "MEDIUM",
      "No current purchase terms-review copy is prepared from this contract snapshot. A prepared copy remains non-legal review material.",
      [evidenceRef("contract", contract.id, "version", input.contractVersion, "documents", "none")],
      "OPERATOR", "PREPARE_TERMS_REVIEW_COPY", "Prepare the fillable terms-review copy from the current authorized snapshot, then review it against an approved external agreement."));
  }
  let currentEconomicsHash: string | null = null;
  if (sourceOffer && detail.analysisSnapshotId && detail.analysis) {
    try {
      currentEconomicsHash = lockDealEconomics(
        detail.analysisSnapshotId, sourceOffer.id, detail.analysis, contract.purchasePrice,
      ).economicsSnapshotHash;
    } catch {
      currentEconomicsHash = null;
    }
  }
  for (const document of liveDocs) {
    const staleVersion = document.sourceContractVersion !== input.contractVersion;
    const staleAnalysis = document.sourceAnalysisSnapshotId !== detail.analysisSnapshotId;
    const staleOffer = document.sourceOfferId !== contract.offerId;
    const staleEconomics = !currentEconomicsHash || document.economicsSnapshotHash !== currentEconomicsHash;
    if (staleVersion || staleAnalysis || staleOffer || staleEconomics) {
      issues.push(issue(`STALE_DOCUMENT:${document.id}`, "DOCUMENT", "HIGH",
        "The persisted document no longer matches the current contract version, analysis, offer, or locked economics snapshot and must not be sent or executed.",
        [evidenceRef("document", document.id, "status", document.status, "contractVersion", document.sourceContractVersion,
          "analysis", document.sourceAnalysisSnapshotId, "offer", document.sourceOfferId, "economics", document.economicsSnapshotHash),
          evidenceRef("current-contract", contract.id, "version", input.contractVersion),
          evidenceRef("current-analysis", detail.analysisSnapshotId ?? "missing"),
          evidenceRef("current-economics", currentEconomicsHash ?? "unavailable")],
        "OWNER", "REGENERATE_CURRENT_DOCUMENT", "Owner: void or replace the stale document and generate a fresh version only from the current authorized snapshot."));
    }
    for (const event of document.events ?? []) {
      if (event.to === "SENT" && !(event.actorRole === "PROVIDER" && event.evidenceRef)) {
        issues.push(issue(`UNCONFIRMED_DOCUMENT_SEND:${document.id}`, "PROVIDER", "HIGH",
          "Document state says SENT without a provider-confirmed delivery reference; the state is not accepted as proof of external delivery.",
          [evidenceRef("document", document.id, "event", "SENT", "actorRole", event.actorRole, "evidenceRef", event.evidenceRef ?? "missing")],
          "OWNER", "VERIFY_DOCUMENT_DELIVERY", "Verify delivery with the connected provider and persist its confirmation; do not rely on a local status change."));
      }
      if (["SIGNED", "EXECUTED"].includes(event.to) && !(event.actorRole === "PROVIDER" && event.evidenceRef)) {
        issues.push(issue(`UNVERIFIED_DOCUMENT_SIGNATURE:${document.id}:${event.to}`, "DOCUMENT", "CRITICAL",
          `Document state says ${event.to} without provider signature/execution evidence.`,
          [evidenceRef("document", document.id, "event", event.to, "actorRole", event.actorRole, "evidenceRef", event.evidenceRef ?? "missing")],
          "OWNER", "VERIFY_SIGNATURE_EVIDENCE", "Obtain and review actual signature/execution evidence before advancing transaction state."));
      }
    }
  }

  if (["UNDER_CONTRACT", "CLOSING"].includes(contract.status)) {
    const effectiveMilestones: string[] = ["EARNEST_MONEY_CONFIRMED"];
    const daysToClose = closeAt ? (closeAt.getTime() - now.getTime()) / DAY : 0;
    if (contract.status === "CLOSING" || daysToClose <= 7) effectiveMilestones.push("TITLE_CLEARED");
    if (contract.committedBuyerId && contract.assignmentAllowed) effectiveMilestones.push("ASSIGNMENT_SIGNED");
    if (contract.committedBuyerId) effectiveMilestones.push("FUNDS_CONFIRMED");
    for (const kind of effectiveMilestones) {
      if (kind === "EARNEST_MONEY_CONFIRMED" && contract.earnestMoney <= 0) continue;
      if (kind === "ASSIGNMENT_SIGNED" && !contract.assignmentAllowed) continue;
      const check = milestoneProblem(contract, kind, currentMatch, now);
      const severity: Severity = closeAt && closeAt.getTime() < now.getTime() ? "CRITICAL"
        : closeAt && closeAt.getTime() - now.getTime() <= 7 * DAY ? "HIGH" : "MEDIUM";
      if (check.missing) {
        issues.push(issue(`MILESTONE_MISSING:${kind}`, "EVIDENCE", severity,
          `Required ${kind.toLowerCase().replaceAll("_", " ")} evidence is not recorded. No milestone is completed from a click or prepared document.`,
          [evidenceRef("contract", contract.id, "status", contract.status, "milestone", kind),
            ...(closeAt ? [closeRef] : [])],
          "OPERATOR", `RECORD_${kind}`, `Record reviewed ${kind.toLowerCase().replaceAll("_", " ")} evidence with its event time, record time, source and required matching values.`,
          closeAt));
      } else if (check.invalidReason) {
        issues.push(issue(`MILESTONE_INVALID:${kind}`, "EVIDENCE", "HIGH", check.invalidReason,
          [...check.refs, evidenceRef("contract", contract.id, "milestone", kind)],
          "OWNER", `REVIEW_${kind}_EVIDENCE`, `Owner: review and replace the ${kind.toLowerCase().replaceAll("_", " ")} evidence with a current, correctly matched record.`,
          check.eventAt));
      }
    }
    if (contract.committedBuyerId && (!currentMatch?.eligible || currentMatch.status !== "COMMITTED")) {
      issues.push(issue("COMMITTED_BUYER_NOT_CURRENT", "BUYER", "CRITICAL",
        "The recorded buyer commitment no longer matches a currently eligible, committed buyer under current criteria and verification.",
        [evidenceRef("contract", contract.id, "committedBuyerId", contract.committedBuyerId),
          evidenceRef("buyer-match", contract.committedBuyerId, "eligible", currentMatch?.eligible ?? false, "status", currentMatch?.status ?? "missing",
            "mismatches", currentMatch?.mismatches.join("|") ?? "no current match")],
        "OWNER", "REVERIFY_OR_REPLACE_BUYER", "Owner: reverify the buyer or follow the authorized release/replacement workflow before closing."));
    }
  }

  const conflictList = Array.isArray(decision.conflicts) ? decision.conflicts : [];
  for (const raw of conflictList) {
    const conflict = raw && typeof raw === "object" ? raw as Record<string, unknown> : { detail: String(raw) };
    const label = String(conflict.field ?? conflict.category ?? conflict.id ?? "unresolved");
    const key = `EVIDENCE_CONFLICT:${sha({ label, conflict }).slice(0, 16)}`;
    const refs = Array.isArray(conflict.evidenceRefs) ? conflict.evidenceRefs.map(String) :
      (decision.evidenceRefs ?? []).slice(0, 8);
    issues.push(issue(key, "INTEGRITY", "HIGH",
      `Unresolved source/party/condition/economics conflict (${label}) blocks safe transaction progression.`,
      [evidenceRef("decision", decision.evaluationId ?? "current"), ...refs],
      "OWNER", "REVIEW_CONFLICTING_EVIDENCE", "Owner: reconcile the conflicting source evidence without overwriting either record; record the reviewed resolution."));
  }
  const staleList = Array.isArray(decision.staleEvidence) ? decision.staleEvidence : [];
  for (const raw of staleList) {
    const stale = raw && typeof raw === "object" ? raw as Record<string, unknown> : { detail: String(raw) };
    const label = String(stale.id ?? stale.field ?? stale.category ?? "evidence");
    const key = `STALE_DEAL_EVIDENCE:${sha({ label, stale }).slice(0, 16)}`;
    const refs = Array.isArray(stale.evidenceRefs) ? stale.evidenceRefs.map(String) :
      (decision.evidenceRefs ?? []).slice(0, 8);
    issues.push(issue(key, "EVIDENCE", "HIGH",
      `Evidence used by transaction decisions is stale (${label}); refresh it before relying on the current terms.`,
      [evidenceRef("decision", decision.evaluationId ?? "current"), ...refs],
      "OPERATOR", "REFRESH_STALE_TRANSACTION_EVIDENCE", "Refresh the stale evidence and let the existing versioned underwriting/authorization path determine whether a new snapshot is required."));
  }

  const activePackets = packets.filter(packet => packet.status === "ACTIVE");
  for (const packet of activePackets) {
    if (packet.expiresAt.getTime() <= now.getTime()) {
      issues.push(issue(`DISTRIBUTION_PACKET_EXPIRED:${packet.id}`, "DEADLINE", "HIGH",
        "The authorized buyer packet expired. Prior invites or interest do not extend its immutable packet.",
        [evidenceRef("packet", packet.id, "status", packet.status, "expiresAt", packet.expiresAt.toISOString(),
          "economics", String(packet.snapshot.economicsSnapshotHash ?? "unknown"))],
        "OWNER", "REAUTHORIZE_BUYER_PACKET", "Owner: review the current authorized deal snapshot and issue a new versioned packet if distribution remains approved.", packet.expiresAt));
    }
  }
  const activePacketIds = new Set(activePackets.map(packet => packet.id));
  for (const recipient of recipients.filter(item => activePacketIds.has(item.packetId) && item.status === "INVITED")) {
    const receipt = recipient.payload.deliveryReceipt;
    if (!receipt || typeof receipt !== "object") {
      const packet = activePackets.find(item => item.id === recipient.packetId);
      issues.push(issue(`DELIVERY_UNCONFIRMED:${recipient.id}`, "PROVIDER", "HIGH",
        "Recipient is only INVITED in the persisted packet. No provider-confirmed delivery evidence exists; invitation, view, and interest are not delivery proof.",
        [evidenceRef("packet", packet?.id, "recipient", recipient.id, "buyer", recipient.buyerId, "status", recipient.status)],
        "OWNER", "CONFIRM_PACKET_DELIVERY", "Connect a permitted delivery provider or record provider-confirmed delivery evidence. Do not claim the buyer received the packet."));
    }
  }
  if (operationContract && operationContract.id !== contract.id) {
    issues.push(issue("CONTRACT_RELATIONSHIP_INCONSISTENT", "INTEGRITY", "CRITICAL",
      "The deal operations view points at a different contract record than the evaluator snapshot.",
      [evidenceRef("contract", contract.id), evidenceRef("operations-contract", operationContract.id)],
      "SYSTEM", "RELOAD_TRANSACTION_SNAPSHOT", "Reload the persisted transaction state before allowing any action."));
  }
  return issues;
}

function resolutionProof(
  issueKey: string,
  input: {
    contract: DealContract;
    contractVersion: number;
    leadVersion: number;
    leadStage: string;
    decision: EvidenceDecision;
    documentReadiness: Awaited<ReturnType<typeof getTransactionDocumentReadiness>>;
    operation: Awaited<ReturnType<typeof dealOperations>>;
    detail: Awaited<ReturnType<typeof leadDetail>>;
    packets: Array<typeof distributionPacketsTable.$inferSelect>;
    recipients: Array<typeof distributionRecipientsTable.$inferSelect>;
    now: Date;
  },
): string[] {
  const { contract, decision, documentReadiness, operation, packets, recipients } = input;
  if (TERMINAL_CONTRACT_STATES.has(contract.status) || ["CLOSED", "DEAD_DEAL", "PASS"].includes(input.leadStage)) {
    return [evidenceRef("contract", contract.id, "terminal-status", contract.status, "version", input.contractVersion)];
  }
  const milestoneMatch = issueKey.match(/^(?:MILESTONE_MISSING|MILESTONE_INVALID):(.+)$/);
  if (milestoneMatch) {
    const kind = milestoneMatch[1];
    const check = milestoneProblem(contract, kind, contract.committedBuyerId
      ? operation.matches.find(match => match.buyerId === contract.committedBuyerId)
      : undefined, input.now);
    if (!check.missing && !check.invalidReason && check.refs.length) return check.refs;
  }
  if (issueKey === "MILESTONE_SCHEDULE_REVIEW_REQUIRED" ||
      issueKey === "MILESTONE_SCHEDULE_INCOMPLETE" ||
      issueKey === "MILESTONE_SCHEDULE_STALE") {
    const schedule = contract.deadlineSchedule;
    if (schedule && scheduleCoversAllMilestones(schedule) && schedule.termsHash === transactionTermsHash(contract)) {
      return [evidenceRef("deadline-schedule", contract.id, "version", schedule.version,
        "termsHash", schedule.termsHash, "source", schedule.sourceEvidenceUrl, "reviewedAt", schedule.recordedAt)];
    }
  }
  const milestoneDeadlineMatch = issueKey.match(/^MILESTONE_DEADLINE_(UPCOMING|OVERDUE|INVALID):([^:]+)(?::(.+))?$/);
  if (milestoneDeadlineMatch) {
    const [, oldState, kind, oldDueDate] = milestoneDeadlineMatch;
    const schedule = contract.deadlineSchedule;
    if (schedule && scheduleCoversAllMilestones(schedule)) {
      if (schedule.termsHash !== transactionTermsHash(contract)) {
        return [evidenceRef("deadline-schedule", contract.id, "version", schedule.version,
          "status", "stale-after-contract-change", "sourceTermsHash", schedule.termsHash,
          "currentTermsHash", transactionTermsHash(contract))];
      }
      const item = schedule.items.find(candidate => candidate.kind === kind);
      if (item) {
        const state = classifyMilestoneDeadline(item,input.now);
        const stateChanged = oldState === "INVALID" ? state !== "INVALID"
          : oldState === "OVERDUE" ? state !== "OVERDUE"
            : state !== "UPCOMING";
        if (stateChanged || item.disposition !== "DUE_DATE" || item.dueDate !== oldDueDate) {
          return [evidenceRef("deadline-schedule", contract.id, "version", schedule.version,
            "milestone", kind, "disposition", item.disposition, "dueDate", item.dueDate,
            "timeZone", item.timeZone, "recordedAt", schedule.recordedAt)];
        }
        const check = milestoneProblem(contract,kind,contract.committedBuyerId
          ? operation.matches.find(match => match.buyerId === contract.committedBuyerId)
          : undefined,input.now);
        if (!check.missing && !check.invalidReason && check.refs.length) return check.refs;
      }
    }
  }
  if (issueKey.startsWith("LEGAL_TEMPLATE_UNAVAILABLE:")) {
    const key = issueKey.slice("LEGAL_TEMPLATE_UNAVAILABLE:".length);
    const template = documentReadiness.templates.find(item => item.key === key);
    if (template?.status === "APPROVED_LEGAL" && template.templateHash && template.approvalEvidenceRef) {
      return [evidenceRef("approved-template", key, template.templateHash, template.approvalEvidenceRef)];
    }
  }
  if (issueKey === "SIGNING_PROVIDER_UNAVAILABLE" && documentReadiness.signingProvider.status === "CONNECTED") {
    return [evidenceRef("signing-provider", "connected", documentReadiness.signingProvider.provider ?? "provider")];
  }
  if (issueKey === "PRIVATE_DOCUMENT_STORAGE_UNAVAILABLE" && String(documentReadiness.storage.status) === "MANAGED_PRIVATE") {
    return [evidenceRef("document-storage", "status", documentReadiness.storage.status, "activeStore", documentReadiness.storage.activeStore)];
  }
  if (issueKey.startsWith("DELIVERY_UNCONFIRMED:")) {
    const id = issueKey.slice("DELIVERY_UNCONFIRMED:".length);
    const recipient = recipients.find(item => item.id === id);
    if (recipient && (recipient.status !== "INVITED" || !!recipient.payload.deliveryReceipt)) {
      return [evidenceRef("recipient", id, "status", recipient.status, "provider-receipt",
        JSON.stringify(recipient.payload.deliveryReceipt ?? "buyer-response"))];
    }
  }
  if (issueKey.startsWith("DISTRIBUTION_PACKET_EXPIRED:")) {
    const id = issueKey.slice("DISTRIBUTION_PACKET_EXPIRED:".length);
    const packet = packets.find(item => item.id === id);
    if (!packet || packet.status !== "ACTIVE") return [evidenceRef("packet", id, "status", packet?.status ?? "replaced")];
  }
  if (issueKey.startsWith("STALE_DOCUMENT:")) {
    const id = issueKey.slice("STALE_DOCUMENT:".length);
    const document = contract.documents?.find(item => item.id === id);
    if (!document || !OPEN_DOCUMENT_STATES.has(document.status)) {
      return [evidenceRef("document", id, "status", document?.status ?? "replaced-or-removed")];
    }
  }
  if (issueKey === "EXECUTED_ACQUISITION_EVIDENCE_MISSING" &&
      contract.executedDocumentUrl && contract.sellerSignedAt && contract.acquisitionSignedAt) {
    return [evidenceRef("contract", contract.id, "executedDocumentUrl", contract.executedDocumentUrl,
      "sellerSignedAt", contract.sellerSignedAt, "acquisitionSignedAt", contract.acquisitionSignedAt)];
  }
  if (issueKey.startsWith("CLOSING_DEADLINE_UPCOMING:") || issueKey.startsWith("CLOSING_DEADLINE_OVERDUE:")) {
    const originalDate = issueKey.slice(issueKey.indexOf(":") + 1);
    const amended = contract.history?.find(item => item.kind === "AMEND_CLOSING" && item.evidenceUrl);
    if (amended && validTimestamp(contract.closingAt)?.toISOString() !== originalDate) {
      return [evidenceRef("contract-history", contract.id, "AMEND_CLOSING", amended.effectiveAt, amended.evidenceUrl)];
    }
    if (issueKey.startsWith("CLOSING_DEADLINE_UPCOMING:") &&
        (validTimestamp(contract.closingAt)?.getTime() ?? Number.POSITIVE_INFINITY) < input.now.getTime()) {
      return [evidenceRef("contract", contract.id, "closingAt", contract.closingAt, "deadline-transition-observedAt", input.now.toISOString())];
    }
  }
  if (issueKey.startsWith("EVIDENCE_CONFLICT:") && !(decision.conflicts?.length)) {
    return [evidenceRef("decision", decision.evaluationId ?? "current", "conflicts", "none", ...(decision.evidenceRefs ?? []))];
  }
  if (issueKey.startsWith("STALE_DEAL_EVIDENCE:") && !(decision.staleEvidence?.length)) {
    return [evidenceRef("decision", decision.evaluationId ?? "current", "staleEvidence", "none", ...(decision.evidenceRefs ?? []))];
  }
  if (issueKey === "COMMITTED_BUYER_NOT_CURRENT") {
    const current = contract.committedBuyerId
      ? operation.matches.find(match => match.buyerId === contract.committedBuyerId)
      : undefined;
    if (current?.eligible && current.status === "COMMITTED") {
      return [evidenceRef("buyer-match", current.buyerId, "eligible", true, "status", current.status,
        "updatedAt", current.updatedAt)];
    }
  }
  if (issueKey === "SELLER_OFFER_EXPIRED" || issueKey === "SELLER_OFFER_EXPIRED_OR_STALE") {
    const offer = input.detail.offers.find(item => item.id === contract.offerId);
    if (offer?.effectiveStatus === "COMMUNICATED" &&
        (!offer.expiresAt || Date.parse(offer.expiresAt) > input.now.getTime()) &&
        input.detail.analysisSnapshotId === offer.analysisSnapshotId) {
      return [evidenceRef("offer", offer.id, "status", offer.effectiveStatus, "analysis", offer.analysisSnapshotId,
        "communicatedAt", offer.communicatedAt)];
    }
  }
  if (issueKey === "CLOSING_DATE_INVALID" && validTimestamp(contract.closingAt)) {
    return [evidenceRef("contract", contract.id, "closingAt", contract.closingAt, "version", input.contractVersion)];
  }
  if (issueKey === "CONTRACT_ECONOMICS_CONFLICT" && contract.purchasePrice >= 0 && contract.assignmentTarget >= 0) {
    const offer = (input.operation as unknown as { offers?: Array<Record<string, unknown>> }).offers?.find(item => item.id === contract.offerId);
    if (offer && offer.amount === contract.purchasePrice && offer.earnestMoney === contract.earnestMoney) {
      return [evidenceRef("contract", contract.id, "version", input.contractVersion, "economics-reconciled")];
    }
  }
  if (issueKey === "PURCHASE_REVIEW_COPY_MISSING" &&
      contract.documents?.some(document => document.kind === "PURCHASE_TERMS_REVIEW" && OPEN_DOCUMENT_STATES.has(document.status))) {
    const document = contract.documents.find(item => item.kind === "PURCHASE_TERMS_REVIEW" && OPEN_DOCUMENT_STATES.has(item.status));
    return [evidenceRef("document", document?.id, "status", document?.status)];
  }
  if (issueKey.startsWith("MILESTONE_INVALID:") && contract.milestones.some(item => item.kind === issueKey.slice("MILESTONE_INVALID:".length))) {
    // An invalid event is deliberately not cleared merely because a row exists;
    // milestoneMatch above clears it only after the source evidence validates.
  }
  if (issueKey === "CONTRACT_RELATIONSHIP_INCONSISTENT" && operation.contract?.id === contract.id) {
    return [evidenceRef("operations-contract", operation.contract.id, "lead", operation.leadId)];
  }
  if (issueKey === "UNCONFIRMED_DOCUMENT_SEND" || issueKey.startsWith("UNCONFIRMED_DOCUMENT_SEND:")) {
    // The source event must actually be provider-confirmed; merely changing
    // state does not provide resolution evidence.
  }
  if (issueKey.startsWith("UNVERIFIED_DOCUMENT_SIGNATURE:")) {
    // A newer provider-signed event is needed; a prepared PDF is insufficient.
  }
  return [];
}

function rowOutput(row: TransactionReadinessExceptionRow) {
  return {
    id: row.id,
    contractId: row.contractId,
    leadId: row.leadId,
    issueKey: row.issueKey,
    category: row.category,
    severity: row.severity,
    reason: row.reason,
    evidenceRefs: row.evidenceRefs,
    ownerRole: row.ownerRole,
    status: row.status,
    nextActionCode: row.nextActionCode,
    nextAction: row.nextAction,
    eventAt: row.eventAt?.toISOString() ?? null,
    firstObservedAt: row.firstObservedAt.toISOString(),
    lastObservedAt: row.lastObservedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionEvidenceRefs: row.resolutionEvidenceRefs,
    snapshotHash: row.snapshotHash,
    synthetic: row.synthetic,
  };
}

async function persistIssue(
  contractId: string,
  leadId: string,
  synthetic: boolean,
  draft: IssueDraft,
  snapshotHash: string,
  now: Date,
): Promise<boolean> {
  return db.transaction(async tx => {
    let [existing] = await tx.select().from(transactionReadinessExceptionsTable)
      .where(and(eq(transactionReadinessExceptionsTable.contractId, contractId),
        eq(transactionReadinessExceptionsTable.issueKey, draft.issueKey)))
      .for("update").limit(1);
    if (!existing) {
      const [inserted] = await tx.insert(transactionReadinessExceptionsTable).values({
        contractId,
        leadId,
        issueKey: draft.issueKey,
        category: draft.category,
        severity: draft.severity,
        reason: draft.reason,
        evidenceRefs: draft.evidenceRefs,
        ownerRole: draft.ownerRole,
        status: "OPEN",
        nextActionCode: draft.nextActionCode,
        nextAction: draft.nextAction,
        eventAt: draft.eventAt,
        firstObservedAt: now,
        lastObservedAt: now,
        resolutionEvidenceRefs: [],
        snapshotHash,
        synthetic,
        history: [{ event: "OPENED", actor: SYSTEM_ACTOR.id, reason: draft.reason, evidenceRefs: draft.evidenceRefs, recordedAt: now.toISOString() }],
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning();
      if (inserted) {
        await audit(tx, SYSTEM_ACTOR.id, "TRANSACTION_EXCEPTION_OPENED", leadId,
          `${draft.issueKey} (${draft.severity}): ${draft.reason}`);
        return true;
      }
      [existing] = await tx.select().from(transactionReadinessExceptionsTable)
        .where(and(eq(transactionReadinessExceptionsTable.contractId, contractId),
          eq(transactionReadinessExceptionsTable.issueKey, draft.issueKey)))
        .for("update").limit(1);
    }
    if (!existing) throw new Error("Concurrent transaction-exception insert could not be observed.");
    const reopened = existing.status === "RESOLVED";
    const changed = reopened || existing.category !== draft.category || existing.severity !== draft.severity ||
      existing.reason !== draft.reason || existing.ownerRole !== draft.ownerRole ||
      existing.nextActionCode !== draft.nextActionCode || existing.nextAction !== draft.nextAction ||
      !sameJson(existing.evidenceRefs, draft.evidenceRefs);
    const history = changed ? [...existing.history, {
      event: reopened ? "REOPENED" : "UPDATED",
      actor: SYSTEM_ACTOR.id,
      reason: draft.reason,
      evidenceRefs: draft.evidenceRefs,
      recordedAt: now.toISOString(),
    }] : existing.history;
    await tx.update(transactionReadinessExceptionsTable).set({
      category: draft.category,
      severity: draft.severity,
      reason: draft.reason,
      evidenceRefs: draft.evidenceRefs,
      ownerRole: draft.ownerRole,
      status: "OPEN",
      nextActionCode: draft.nextActionCode,
      nextAction: draft.nextAction,
      eventAt: draft.eventAt,
      lastObservedAt: now,
      resolvedAt: null,
      resolutionEvidenceRefs: [],
      snapshotHash,
      synthetic,
      history,
      updatedAt: now,
    }).where(eq(transactionReadinessExceptionsTable.id, existing.id));
    if (changed) {
      await audit(tx, SYSTEM_ACTOR.id, reopened ? "TRANSACTION_EXCEPTION_REOPENED" : "TRANSACTION_EXCEPTION_UPDATED",
        leadId, `${draft.issueKey} (${draft.severity}): ${draft.reason}`);
    }
    return changed;
  });
}

async function resolveAbsentIssues(
  contractId: string,
  leadId: string,
  currentKeys: Set<string>,
  context: Parameters<typeof resolutionProof>[1],
  snapshotHash: string,
  now: Date,
): Promise<boolean> {
  return db.transaction(async tx => {
    const open = await tx.select().from(transactionReadinessExceptionsTable)
      .where(and(eq(transactionReadinessExceptionsTable.contractId, contractId),
        eq(transactionReadinessExceptionsTable.status, "OPEN")))
      .for("update");
    let changed = false;
    for (const row of open) {
      if (currentKeys.has(row.issueKey)) continue;
      const proof = resolutionProof(row.issueKey, context);
      if (!proof.length) {
        await tx.update(transactionReadinessExceptionsTable).set({ lastObservedAt: now, updatedAt: now })
          .where(eq(transactionReadinessExceptionsTable.id, row.id));
        continue;
      }
      const history = [...row.history, {
        event: "RESOLVED",
        actor: SYSTEM_ACTOR.id,
        reason: "The evaluator observed persisted evidence that resolves the specific exception.",
        evidenceRefs: proof,
        recordedAt: now.toISOString(),
      }];
      await tx.update(transactionReadinessExceptionsTable).set({
        status: "RESOLVED",
        resolvedAt: now,
        lastObservedAt: now,
        resolutionEvidenceRefs: proof,
        snapshotHash,
        history,
        updatedAt: now,
      }).where(eq(transactionReadinessExceptionsTable.id, row.id));
      await audit(tx, SYSTEM_ACTOR.id, "TRANSACTION_EXCEPTION_RESOLVED", leadId,
        `${row.issueKey} resolved from persisted evidence: ${proof.join(", ")}`);
      changed = true;
    }
    return changed;
  });
}

async function evaluateOneContract(contractRow: typeof contractsTable.$inferSelect, now: Date) {
  const leadId = contractRow.leadId;
  const detail = await leadDetail(leadId, db, now);
  const operation = await dealOperations(leadId, now);
  const contract = contractRecord(contractRow);
  const decision = await evaluateLeadDecision(leadId, SYSTEM_ACTOR.id, now) as EvidenceDecision;
  const documentReadiness = await getTransactionDocumentReadiness(SYSTEM_ACTOR, leadId);
  const packetRows = await db.select().from(distributionPacketsTable)
    .where(eq(distributionPacketsTable.contractId, contractRow.id));
  const packetIds = packetRows.map(packet => packet.id);
  const recipientRows = packetIds.length
    ? await db.select().from(distributionRecipientsTable).where(inArray(distributionRecipientsTable.packetId, packetIds))
    : [];
  const issues = deriveIssues({
    contract,
    contractVersion: contractRow.version,
    leadVersion: detail.lead.version,
    leadStage: detail.lead.stage,
    detail,
    operation,
    decision,
    documentReadiness,
    packets: packetRows,
    recipients: recipientRows,
    now,
  });
  const snapshotHash = sha({
    contractId: contractRow.id,
    contractVersion: contractRow.version,
    contractStatus: contract.status,
    leadVersion: detail.lead.version,
    analysisSnapshotId: detail.analysisSnapshotId,
    decisionEvaluationId: decision.evaluationId,
    currentBuyer: contract.committedBuyerId
      ? operation.matches.find(match => match.buyerId === contract.committedBuyerId)
      : null,
    documents: contract.documents?.map(document => [document.id, document.status, document.snapshotHash, document.economicsSnapshotHash]),
    templates: documentReadiness.templates.map(template => [template.key, template.status, template.version, template.templateHash]),
    packets: packetRows.map(packet => [packet.id, packet.status, packet.expiresAt.toISOString(), packet.snapshot.economicsSnapshotHash]),
    recipients: recipientRows.map(recipient => [recipient.id, recipient.status, recipient.payload.deliveryReceipt ?? null]),
    issues: issues.map(item => [item.issueKey, item.severity, item.evidenceRefs, item.nextActionCode]),
  });
  const synthetic = syntheticLead(detail);
  let changed = await resolveAbsentIssues(contractRow.id, leadId, new Set(issues.map(item => item.issueKey)), {
    contract, contractVersion: contractRow.version, leadVersion: detail.lead.version, leadStage: detail.lead.stage, decision,
    documentReadiness, operation, detail, packets: packetRows, recipients: recipientRows, now,
  }, snapshotHash, now);
  for (const draft of issues) {
    changed = await persistIssue(contractRow.id, leadId, synthetic, draft, snapshotHash, now) || changed;
  }
  if (changed) {
    await evaluateLeadDecision(leadId, `${SYSTEM_ACTOR.id}:exception-change`, now);
  }
  return { leadId, contractId: contractRow.id, issueCount: issues.length, changed, synthetic, status: contract.status };
}

export async function evaluateAllTransactionReadiness(now = new Date()) {
  const rows = await db.select().from(contractsTable).orderBy(asc(contractsTable.createdAt));
  const evaluated: Array<{ leadId: string; contractId: string; issueCount: number; changed: boolean; synthetic: boolean; status: string }> = [];
  for (const row of rows) {
    const currentContract = contractRecord(row);
    if (!TERMINAL_CONTRACT_STATES.has(currentContract.status)) {
      evaluated.push(await evaluateOneContract(row, now));
      continue;
    }
    const detail = await leadDetail(row.leadId, db, now);
    const operations = await dealOperations(row.leadId, now);
    const decision = await evaluateLeadDecision(row.leadId, SYSTEM_ACTOR.id, now) as EvidenceDecision;
    const currentKeys = new Set<string>();
    const proofContext = {
      contract: currentContract, contractVersion: row.version, leadVersion: detail.lead.version,
      leadStage: detail.lead.stage, decision,
      documentReadiness: await getTransactionDocumentReadiness(SYSTEM_ACTOR, row.leadId),
      operation: operations, detail, packets: await db.select().from(distributionPacketsTable)
        .where(eq(distributionPacketsTable.contractId, row.id)),
      recipients: [] as Array<typeof distributionRecipientsTable.$inferSelect>,
      now,
    };
    const packets = proofContext.packets;
    const ids = packets.map(packet => packet.id);
    proofContext.recipients = ids.length
      ? await db.select().from(distributionRecipientsTable).where(inArray(distributionRecipientsTable.packetId, ids))
      : [];
    const snapshotHash = sha({ contract: [row.id, row.version, currentContract.status], leadVersion: detail.lead.version });
    const changed = await resolveAbsentIssues(row.id, row.leadId, currentKeys, proofContext, snapshotHash, now);
    if (["CLOSED", "DEAD_DEAL", "PASS"].includes(detail.lead.stage)) {
      // The decision engine expires obsolete runnable work from terminal deal evidence.
      await evaluateLeadDecision(row.leadId, `${SYSTEM_ACTOR.id}:terminal-readiness`, now);
    }
    evaluated.push({ leadId: row.leadId, contractId: row.id, issueCount: 0, changed, synthetic: syntheticLead(detail), status: currentContract.status });
  }
  return evaluated;
}

export async function getTransactionReadinessReport(now = new Date()) {
  const contracts = await db.select().from(contractsTable);
  const leads = await db.select().from(leadsTable);
  const leadById = new Map(leads.map(row => [row.id, row]));
  const isSynthetic = (leadId: string) => {
    const payload = leadById.get(leadId)?.payload ?? {};
    const source = [payload.source, payload.sourceType, payload.provenance, payload.exerciseContext]
      .map(value => typeof value === "string" ? value : JSON.stringify(value ?? ""))
      .join(" ");
    return /\bsynthetic\b|\btest fixture\b/i.test(source);
  };
  const rows = await db.select().from(transactionReadinessExceptionsTable)
    .orderBy(desc(transactionReadinessExceptionsTable.lastObservedAt), asc(transactionReadinessExceptionsTable.severity));
  const severityOrder: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const exceptions = rows.map(rowOutput).sort((a, b) =>
    (a.status === b.status ? 0 : a.status === "OPEN" ? -1 : 1) ||
    severityOrder[a.severity as Severity] - severityOrder[b.severity as Severity] ||
    b.lastObservedAt.localeCompare(a.lastObservedAt));
  const openExceptions = exceptions.filter(item => item.status === "OPEN");
  const delivery = buyerOutreachReadiness({}, now);
  const readiness = await getTransactionDocumentReadiness(SYSTEM_ACTOR);
  return GetTransactionReadinessResponse.parse({
    evaluatedAt: now.toISOString(),
    transactionCount: contracts.length,
    realTransactionCount: contracts.filter(row => !isSynthetic(row.leadId)).length,
    syntheticTransactionCount: contracts.filter(row => isSynthetic(row.leadId)).length,
    activeTransactionCount: contracts.filter(row => ACTIVE_CONTRACT_STATES.has(String(row.payload.status))).length,
    openExceptionCount: openExceptions.length,
    exceptions,
    capabilities: {
      signingProvider: {
        status: readiness.signingProvider.status,
        reason: readiness.signingProvider.reason ?? "Signing-provider readiness has no reason recorded.",
      },
      deliveryProvider: {
        status: delivery.providerStatus,
        reason: delivery.providerStatus === "CONNECTED"
          ? "A buyer outreach/delivery provider is registered; each delivery still requires its own provider receipt."
          : "No permitted buyer delivery provider is connected. Packets and recipient invitations are not proof of delivery.",
      },
      privateDocumentStorage: {
        status: readiness.storage.status,
        activeStore: readiness.storage.activeStore,
        reason: readiness.storage.reason,
      },
    },
  });
}

export type TransactionReadinessIssueDraft = IssueDraft;
export const transactionReadinessInternals = { deriveIssues, milestoneProblem, resolutionProof, sha };
