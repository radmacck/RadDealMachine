import { asc, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { db, leadsTable, transactionClauseRequestsTable } from "@workspace/db";
import { DomainError, assertOperationsRole, legalTemplateBlocker, type OfferActor } from "@workspace/deal-domain";
import { CreateClauseReviewRequestBody, GetClauseReviewRequestsResponseItem } from "@workspace/api-zod";
import { audit } from "./deal-store";
import { propertyDocumentJurisdiction, ensureTransactionDocumentRegistry } from "./transaction-document-registry";

function clauseRequestRecord(row: typeof transactionClauseRequestsTable.$inferSelect) {
  return GetClauseReviewRequestsResponseItem.parse({
    id: row.id, leadId: row.leadId, version: row.version, status: row.status,
    createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), ...row.payload,
  });
}

export async function listClauseReviewRequests(leadId: string, actor: OfferActor) {
  assertOperationsRole(actor, ["OWNER", "OPERATOR"]);
  const [lead] = await db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.id, leadId));
  if (!lead) throw new DomainError("Deal not found.", 404);
  const rows = await db.select().from(transactionClauseRequestsTable)
    .where(eq(transactionClauseRequestsTable.leadId, leadId))
    .orderBy(asc(transactionClauseRequestsTable.createdAt));
  return rows.map(clauseRequestRecord);
}

export async function createClauseReviewRequest(leadId: string, input: unknown, actor: OfferActor, now = new Date()) {
  assertOperationsRole(actor, ["OWNER"]);
  const parsed = CreateClauseReviewRequestBody.parse(input);
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
  if (!lead) throw new DomainError("Deal not found.", 404);
  const jurisdiction = propertyDocumentJurisdiction(lead.payload);
  if (parsed.jurisdiction !== jurisdiction) throw new DomainError("Clause request jurisdiction must match the saved property location.", 409);
  const templates = await ensureTransactionDocumentRegistry(db, jurisdiction);
  const requiredTemplateKey = parsed.category === "ASSIGNMENT" ? "ASSIGNMENT_AGREEMENT" :
    parsed.category === "OTHER" ? "AMENDMENT" : "PURCHASE_AGREEMENT";
  const approvedTemplate = templates.some(item => item.templateKey === requiredTemplateKey &&
    legalTemplateBlocker(item, jurisdiction,
      parsed.category === "ASSIGNMENT" ? "WHOLESALE_ASSIGNMENT" : "PURCHASE", now) === null);
  const status = approvedTemplate ? "AWAITING_QUALIFIED_REVIEW" : "BLOCKED_MISSING_APPROVED_TEMPLATE";
  const payload = {
    category: parsed.category, purpose: parsed.purpose, jurisdiction,
    requiredTemplateKey,
    sourceTemplateRef: parsed.sourceTemplateRef ?? null, partyScope: parsed.partyScope,
    proposedText: parsed.proposedText ?? null, proposedTextStatus: "OWNER_SUPPLIED_UNREVIEWED",
    affectedTerms: parsed.affectedTerms, conflictsWith: parsed.conflictsWith ?? [],
    qualifiedReviewStatus: "NOT_REVIEWED",
    blocker: approvedTemplate ? "Qualified legal review and its evidence have not been recorded." :
      `No approved legal template with approval evidence is registered for ${jurisdiction}.`,
    nextAction: approvedTemplate ? "Route this request and its source evidence to a qualified jurisdictional reviewer; do not insert it." :
      "Obtain and register a jurisdiction-approved template and qualified-review path before considering insertion.",
  };
  return db.transaction(async tx => {
    const [existing] = await tx.select().from(transactionClauseRequestsTable)
      .where(eq(transactionClauseRequestsTable.idempotencyKey, parsed.idempotencyKey)).for("update");
    if (existing) {
      if (existing.leadId !== leadId || existing.createdBy !== actor.id) throw new DomainError("Idempotency key belongs to another clause request.", 409);
      const comparedFields = ["category", "purpose", "jurisdiction", "sourceTemplateRef", "partyScope", "proposedText", "affectedTerms", "conflictsWith"] as const;
      if (!comparedFields.every(key => isDeepStrictEqual(existing.payload[key], (payload as Record<string, unknown>)[key]))) {
        throw new DomainError("Idempotency key was already used for different clause content.", 409);
      }
      return clauseRequestRecord(existing);
    }
    const [inserted] = await tx.insert(transactionClauseRequestsTable).values({
      leadId, status, idempotencyKey: parsed.idempotencyKey, payload, createdBy: actor.id, createdAt: now,
    }).onConflictDoNothing().returning();
    const [row] = inserted ? [inserted] : await tx.select().from(transactionClauseRequestsTable)
      .where(eq(transactionClauseRequestsTable.idempotencyKey, parsed.idempotencyKey)).for("update");
    if (!row || row.leadId !== leadId || row.createdBy !== actor.id) throw new DomainError("Idempotency key belongs to another clause request.", 409);
    if (!inserted) {
      const comparedFields = ["category", "purpose", "jurisdiction", "sourceTemplateRef", "partyScope", "proposedText", "affectedTerms", "conflictsWith"] as const;
      if (!comparedFields.every(key => isDeepStrictEqual(row.payload[key], (payload as Record<string, unknown>)[key]))) {
        throw new DomainError("Idempotency key was already used for different clause content.", 409);
      }
      return clauseRequestRecord(row);
    }
    await audit(tx, actor.id, "CLAUSE_REVIEW_REQUESTED", `transaction-clause:${row!.id}`,
      `Special clause request recorded for ${jurisdiction}; unreviewed text is not inserted into transaction documents.`);
    return clauseRequestRecord(row!);
  });
}
