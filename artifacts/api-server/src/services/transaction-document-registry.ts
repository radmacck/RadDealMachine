import { asc } from "drizzle-orm";
import { db, transactionDocumentTemplatesTable } from "@workspace/db";
import { assertOperationsRole, type OfferActor } from "@workspace/deal-domain";
import type { Store } from "./operations-records";
import { unavailableSigningProvider } from "./transaction-signing-provider";

const REQUIRED_DOCUMENTS = [
  {
    templateKey: "PURCHASE_TERMS_REVIEW",
    documentKind: "PURCHASE_TERMS_REVIEW",
    status: "REVIEW_COPY_ONLY",
    requiredFields: ["authorizedOffer", "economicsSnapshotHash", "propertyAddress", "sellerReportedName", "purchasePrice", "earnestMoney", "closingAt", "contingencies", "assignmentAllowed"],
  },
  {
    templateKey: "PURCHASE_AGREEMENT",
    documentKind: "PURCHASE_AGREEMENT",
    status: "MISSING_APPROVED_TEMPLATE",
    requiredFields: ["jurisdictionApprovedTemplate", "sellerLegalIdentity", "sellerSigningAuthority", "propertyLegalDescription", "authorizedOffer", "economicsSnapshotHash", "signatures"],
  },
  {
    templateKey: "ASSIGNMENT_AGREEMENT",
    documentKind: "ASSIGNMENT_AGREEMENT",
    status: "MISSING_APPROVED_TEMPLATE",
    requiredFields: ["jurisdictionApprovedTemplate", "executedPurchaseAgreement", "qualifiedBuyer", "authorizedAssignmentFee", "buyerTerms", "signatures"],
  },
  {
    templateKey: "SELLER_RESPONSE_EVIDENCE",
    documentKind: "SELLER_RESPONSE",
    status: "PORTAL_EVENT_RECORD",
    requiredFields: ["authorizedOfferSnapshot", "sellerPortalResponse", "responseTimestamp", "identityRouteEvidence", "auditEvent"],
  },
  {
    templateKey: "AMENDMENT",
    documentKind: "AMENDMENT",
    status: "MISSING_APPROVED_TEMPLATE",
    requiredFields: ["jurisdictionApprovedTemplate", "priorExecutedDocument", "changedTerms", "partyConsentEvidence", "signatures"],
  },
  {
    templateKey: "REPLACEMENT_BUYER",
    documentKind: "REPLACEMENT_BUYER",
    status: "MISSING_APPROVED_TEMPLATE",
    requiredFields: ["jurisdictionApprovedTemplate", "buyerReleaseEvidence", "replacementBuyerQualification", "lockedEconomicsSnapshot", "signatures"],
  },
  {
    templateKey: "BUYER_ASSIGNMENT",
    documentKind: "ASSIGNMENT_AGREEMENT",
    status: "MISSING_APPROVED_TEMPLATE",
    requiredFields: ["jurisdictionApprovedTemplate", "identicalAuthorizedDealPacket", "buyerCommitmentEvidence", "fundingEvidence", "signatures"],
  },
  {
    templateKey: "EMD_AND_CLOSING_RECEIPT",
    documentKind: "EMD_ACKNOWLEDGMENT",
    status: "MISSING_APPROVED_TEMPLATE",
    requiredFields: ["jurisdictionApprovedTemplate", "escrowOrTitleEvidence", "amount", "receivedAt", "authorizedParties"],
  },
] as const;

export async function ensureTransactionDocumentRegistry(database: Store = db) {
  for (const item of REQUIRED_DOCUMENTS) {
    await database.insert(transactionDocumentTemplatesTable).values({
      templateKey: item.templateKey,
      documentKind: item.documentKind,
      jurisdiction: "US/UNSPECIFIED",
      status: item.status,
      version: 1,
      requiredFields: [...item.requiredFields],
    }).onConflictDoNothing();
  }
  return database.select().from(transactionDocumentTemplatesTable)
    .orderBy(asc(transactionDocumentTemplatesTable.templateKey));
}

export async function getTransactionDocumentReadiness(actor: OfferActor) {
  assertOperationsRole(actor, ["OWNER", "OPERATOR"]);
  const templates = await ensureTransactionDocumentRegistry();
  const legalDocs = templates.filter(item =>
    !["PURCHASE_TERMS_REVIEW", "SELLER_RESPONSE_EVIDENCE"].includes(item.templateKey));
  const blockers = legalDocs
    .filter(item => item.status !== "APPROVED_LEGAL" || !item.templateHash || !item.approvalEvidenceRef)
    .map(item => `No approved ${item.documentKind.toLowerCase().replaceAll("_", " ")} template is registered for ${item.jurisdiction}.`);
  blockers.push("Managed private file storage is unavailable; current review-copy bytes use a protected persistent database blob table.");
  blockers.push("No e-signature provider is connected; system-managed send/sign events are unavailable.");

  return {
    templates: templates.map(item => ({
      key: item.templateKey,
      documentKind: item.documentKind,
      jurisdiction: item.jurisdiction,
      status: item.status,
      version: item.version,
      requiredFields: item.requiredFields,
      templateHash: item.templateHash,
      approvalEvidenceRef: item.approvalEvidenceRef,
      missingReason: item.status === "REVIEW_COPY_ONLY"
        ? "Internal terms-review worksheet only; not an approved legal form."
        : item.status === "PORTAL_EVENT_RECORD"
          ? "Portal responses are persisted evidence events, not signed legal documents."
          : "No approved template and approval evidence are configured.",
    })),
    signingProvider: unavailableSigningProvider.status,
    storage: {
      status: "PRIVATE_FILE_STORE_UNAVAILABLE" as const,
      activeStore: "PERSISTENT_DATABASE_BLOB" as const,
      reason: "The persistent database blob store is protected by authenticated server routes, but it is not managed private object storage.",
    },
    canSendLegalDocuments: false,
    blockers,
  };
}
