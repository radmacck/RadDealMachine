export const TRANSACTION_DOCUMENT_STATES = [
  "DRAFT",
  "PREPARED_FOR_REVIEW",
  "APPROVED_TO_SEND",
  "SENT",
  "SIGNING_IN_PROGRESS",
  "SIGNED",
  "EXECUTED",
  "REJECTED",
  "VOID",
  "EXPIRED",
  "REPLACED",
] as const;

export type TransactionDocumentState = typeof TRANSACTION_DOCUMENT_STATES[number];

export interface TransactionDocumentTransitionContext {
  actorRole: "OWNER" | "OPERATOR" | "SYSTEM_WORKER" | "PROVIDER";
  reason?: string;
  currentSnapshot?: boolean;
  authorizedSnapshot?: boolean;
  templateStatus?: "REVIEW_COPY_AVAILABLE" | "APPROVED_LEGAL" | "MISSING_APPROVED_TEMPLATE";
  privateStorageReady?: boolean;
  deliveryReceiptId?: string;
  deliveryProviderConnected?: boolean;
  signingEnvelopeId?: string;
  signingProviderConnected?: boolean;
  providerVerifiedSignatureEvidence?: boolean;
  allRequiredPartiesSigned?: boolean;
  executionEvidenceRef?: string;
  expiresAt?: string;
  now?: Date;
  replacementDocumentId?: string;
}

export type TransactionDocumentTransitionDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

const inactiveStates = new Set<TransactionDocumentState>(["REJECTED", "VOID", "EXPIRED", "REPLACED", "EXECUTED"]);

function deny(reason: string): TransactionDocumentTransitionDecision {
  return { allowed: false, reason };
}

/**
 * Enforces evidence and authority gates for document lifecycle changes.
 * It deliberately has no "pretend provider" path: external statuses require
 * provider receipts or owner-recorded execution evidence.
 */
export function evaluateTransactionDocumentTransition(
  from: TransactionDocumentState,
  to: TransactionDocumentState,
  context: TransactionDocumentTransitionContext,
): TransactionDocumentTransitionDecision {
  if (from === to) return deny("Document is already in that state.");
  if (inactiveStates.has(from)) return deny("A terminal document state cannot be reopened.");
  if (to === "REJECTED") {
    if (!["OWNER", "OPERATOR"].includes(context.actorRole) || !context.reason?.trim())
      return deny("Rejection requires an authorized reviewer and a recorded reason.");
    return { allowed: true };
  }
  if (to === "VOID") {
    if (context.actorRole !== "OWNER" || !context.reason?.trim())
      return deny("Voiding requires owner authority and a recorded reason.");
    return { allowed: true };
  }
  if (to === "EXPIRED") {
    const expiry = context.expiresAt ? Date.parse(context.expiresAt) : Number.NaN;
    if (!["OWNER", "SYSTEM_WORKER"].includes(context.actorRole) || !Number.isFinite(expiry) ||
      expiry > (context.now ?? new Date()).getTime())
      return deny("Expiry requires an elapsed document/offer deadline and an authorized actor.");
    return { allowed: true };
  }
  if (to === "REPLACED") {
    if (!context.replacementDocumentId || !context.reason?.trim())
      return deny("Replacement requires the new document ID and a recorded reason.");
    return { allowed: true };
  }

  if (to === "PREPARED_FOR_REVIEW" && from === "DRAFT") {
    if (!context.currentSnapshot) return deny("A current source snapshot is required.");
    if (!["REVIEW_COPY_AVAILABLE", "APPROVED_LEGAL"].includes(context.templateStatus ?? "MISSING_APPROVED_TEMPLATE"))
      return deny("No configured template is available for this document.");
    return { allowed: true };
  }
  if (to === "APPROVED_TO_SEND" && from === "PREPARED_FOR_REVIEW") {
    if (context.templateStatus !== "APPROVED_LEGAL") return deny("A review worksheet is not an approved legal template.");
    if (!context.authorizedSnapshot || !context.currentSnapshot) return deny("Current owner-authorized terms are required.");
    if (!context.privateStorageReady) return deny("Private file storage is not available for an approved document packet.");
    if (context.actorRole !== "OWNER") return deny("Approval to send requires owner authority.");
    return { allowed: true };
  }
  if (to === "SENT" && from === "APPROVED_TO_SEND") {
    if (!context.deliveryProviderConnected || !context.deliveryReceiptId)
      return deny("A connected delivery provider receipt is required; no send is recorded.");
    return { allowed: true };
  }
  if (to === "SIGNING_IN_PROGRESS" && from === "SENT") {
    if (!context.signingProviderConnected || !context.signingEnvelopeId)
      return deny("A connected signing provider envelope is required; signing is unavailable.");
    return { allowed: true };
  }
  if (to === "SIGNED" && from === "SIGNING_IN_PROGRESS") {
    if (!context.signingProviderConnected || !context.providerVerifiedSignatureEvidence || !context.allRequiredPartiesSigned)
      return deny("Verified provider signature evidence for every required party is required.");
    return { allowed: true };
  }
  if (to === "EXECUTED" && from === "SIGNED") {
    if (!context.executionEvidenceRef?.trim()) return deny("Execution evidence is required.");
    return { allowed: true };
  }
  return deny(`Transition ${from} → ${to} is not allowed.`);
}
