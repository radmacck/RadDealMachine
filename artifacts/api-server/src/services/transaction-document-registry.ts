import { asc, eq } from "drizzle-orm";
import { db, leadsTable, transactionDocumentTemplatesTable } from "@workspace/db";
import { assertOperationsRole, DomainError, type OfferActor } from "@workspace/deal-domain";
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

function jurisdictionSegment(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || null;
}

/**
 * This chooses a checklist scope from the persisted property location only.
 * It does not establish the governing law or approve a legal template.
 */
export function propertyDocumentJurisdiction(property: { state?: unknown; county?: unknown }) {
  const state = jurisdictionSegment(property.state) ?? "UNKNOWN";
  const county = jurisdictionSegment(property.county) ?? "UNSPECIFIED";
  return `US/${state}/${county}`;
}

export async function ensureTransactionDocumentRegistry(
  database: Store = db,
  jurisdiction = "US/UNSPECIFIED",
) {
  for (const item of REQUIRED_DOCUMENTS) {
    await database.insert(transactionDocumentTemplatesTable).values({
      templateKey: item.templateKey,
      documentKind: item.documentKind,
      jurisdiction,
      status: item.status,
      version: 1,
      requiredFields: [...item.requiredFields],
    }).onConflictDoNothing();
  }
  return database.select().from(transactionDocumentTemplatesTable)
    .where(eq(transactionDocumentTemplatesTable.jurisdiction,jurisdiction))
    .orderBy(asc(transactionDocumentTemplatesTable.templateKey));
}

export async function getTransactionDocumentReadiness(actor: OfferActor, leadId?: string) {
  assertOperationsRole(actor, ["OWNER", "OPERATOR"]);
  let jurisdiction: string | null = null;
  let templates: Awaited<ReturnType<typeof ensureTransactionDocumentRegistry>> = [];
  if (leadId) {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
    if (!lead) throw new DomainError("The deal property for document-readiness review was not found.", 404);
    jurisdiction = propertyDocumentJurisdiction(lead.payload);
    templates = await ensureTransactionDocumentRegistry(db, jurisdiction);
  }
  const legalDocs = templates.filter(item =>
    !["PURCHASE_TERMS_REVIEW", "SELLER_RESPONSE_EVIDENCE"].includes(item.templateKey));
  const blockers = leadId
    ? legalDocs
        .filter(item => item.status !== "APPROVED_LEGAL" || !item.templateHash || !item.approvalEvidenceRef)
        .map(item => `No approved ${item.documentKind.toLowerCase().replaceAll("_", " ")} template is registered for property jurisdiction ${item.jurisdiction}.`)
    : ["Open a deal to evaluate document readiness against its persisted property jurisdiction."];
  blockers.push("Managed private file storage is unavailable; current review-copy bytes use a protected persistent database blob table.");
  blockers.push("No e-signature provider is connected; system-managed send/sign events are unavailable.");

  return {
    leadId: leadId ?? null,
    jurisdiction,
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
