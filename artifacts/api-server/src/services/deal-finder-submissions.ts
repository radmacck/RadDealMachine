import { asc, eq, sql } from "drizzle-orm";
import {
  db, dealFinderSubmissionsTable, buyersTable,
} from "@workspace/db";
import {
  CreateDealFinderSubmissionBody, RecordDealFinderSubmissionActionBody,
} from "@workspace/api-zod";
import { DomainError, type OfferActor } from "@workspace/deal-domain";
import { buyerRecord } from "./operations-records";
import { audit } from "./deal-store";

const allowedRoles = ["OWNER", "ANALYST", "OPERATOR"];
const urlOk = (value: string) => /^https:\/\/\S+$/i.test(value);

function view(row: typeof dealFinderSubmissionsTable.$inferSelect) {
  const p = row.payload;
  return {
    id: row.id, version: row.version, finderId: row.finderId,
    finderName: String(p.finderName), status: row.status,
    propertyAddress: String(p.propertyAddress), city: String(p.city),
    state: String(p.state), postalCode: String(p.postalCode),
    opportunity: String(p.opportunity), evidenceUrl: String(p.evidenceUrl),
    evidenceReference: String(p.evidenceReference), submittedBy: row.submittedBy,
    submittedAt: row.submittedAt.toISOString(), authorizedToShare: true as const,
    wholesaler: (p.wholesaler as string | null) ?? null,
    exactFeeTerms: (p.exactFeeTerms as string | null) ?? null,
    feeAmount: (p.feeAmount as number | null) ?? null,
    currency: (p.currency as string | null) ?? null,
    feeStatus: String(p.feeStatus ?? "NOT_AGREED"),
    history: Array.isArray(p.history) ? p.history : [],
  };
}

export async function listDealFinderSubmissions(actor: OfferActor) {
  if (!allowedRoles.includes(actor.role)) throw new DomainError("Not permitted.", 403);
  const rows = await db.select().from(dealFinderSubmissionsTable)
    .orderBy(asc(dealFinderSubmissionsTable.submittedAt));
  return rows.map(view);
}

export async function createDealFinderSubmission(input: unknown, actor: OfferActor, now = new Date()) {
  if (!allowedRoles.includes(actor.role)) throw new DomainError("Not permitted.", 403);
  const body = CreateDealFinderSubmissionBody.parse(input);
  if (!urlOk(body.evidenceUrl)) throw new DomainError("Opportunity evidence must use HTTPS.", 400);
  if (body.authorizedToShare !== true) throw new DomainError("Confirm authority to share this opportunity before submitting.", 400);
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ${`finder-submission:${body.idempotencyKey}`},0))`);
    const [existing] = await tx.select().from(dealFinderSubmissionsTable)
      .where(eq(dealFinderSubmissionsTable.idempotencyKey, body.idempotencyKey)).for("update");
    if (existing) {
      const p = existing.payload;
      if (existing.finderId !== body.finderId || p.propertyAddress !== body.propertyAddress ||
        p.city !== body.city || p.state !== body.state || p.postalCode !== body.postalCode ||
        p.opportunity !== body.opportunity || p.evidenceReference !== body.evidenceReference ||
        p.evidenceUrl !== body.evidenceUrl)
        throw new DomainError("Submission key already identifies different opportunity evidence.", 409);
      return view(existing);
    }
    const [finderRow] = await tx.select().from(buyersTable).where(eq(buyersTable.id, body.finderId)).for("share");
    if (!finderRow) throw new DomainError("Deal-finder profile not found.", 404);
    const finder = buyerRecord(finderRow, now);
    if (!["DEAL_FINDER", "GURU"].includes(finder.destinationKind))
      throw new DomainError("Submissions require a deal-finder/guru record, never an acquisition buyer.", 409);
    const payload = {
      finderName: finder.name, propertyAddress: body.propertyAddress, city: body.city,
      state: body.state, postalCode: body.postalCode, opportunity: body.opportunity,
      evidenceUrl: body.evidenceUrl, evidenceReference: body.evidenceReference,
      authorizedToShare: true, wholesaler: null, exactFeeTerms: null,
      feeAmount: null, currency: null, feeStatus: "NOT_AGREED",
      history: [{ action: "SUBMITTED", at: now.toISOString(), actor: actor.id,
        evidenceUrl: body.evidenceUrl, note: "Opportunity submitted; seller identity, authority, contact permission, and any fee remain unverified." }],
    };
    const [row] = await tx.insert(dealFinderSubmissionsTable).values({
      idempotencyKey: body.idempotencyKey, finderId: body.finderId,
      payload, submittedBy: actor.id, submittedAt: now, updatedAt: now,
    }).returning();
    if (!row) throw new DomainError("Submission was not saved.", 500);
    await audit(tx, actor.id, "DEAL_FINDER_SUBMITTED", row.id,
      `Opportunity attributed to finder ${body.finderId}; sharing authority attested; seller contactability not established.`);
    return view(row);
  });
}

export async function recordDealFinderSubmissionAction(id: string, input: unknown, actor: OfferActor, now = new Date()) {
  if (actor.role !== "OWNER") throw new DomainError("Only an Owner may accept, decline, hand off, or review fee outcomes.", 403);
  const body = RecordDealFinderSubmissionActionBody.parse(input);
  if (!urlOk(body.evidenceUrl)) throw new DomainError("Action evidence must use HTTPS.", 400);
  return db.transaction(async tx => {
    const [row] = await tx.select().from(dealFinderSubmissionsTable)
      .where(eq(dealFinderSubmissionsTable.id, id)).for("update");
    if (!row) throw new DomainError("Submission not found.", 404);
    if (row.version !== body.version) throw new DomainError("Submission changed; reload before recording an action.", 409);
    const p = row.payload;
    const history = Array.isArray(p.history) ? p.history as Record<string, unknown>[] : [];
    const next = { ...p };
    let status = row.status;
    switch (body.action) {
      case "ACCEPT":
        if (status !== "SUBMITTED") throw new DomainError("Only a submitted opportunity can be accepted.", 409);
        status = "ACCEPTED"; break;
      case "DECLINE":
        if (status !== "SUBMITTED") throw new DomainError("Only a submitted opportunity can be declined.", 409);
        status = "DECLINED"; break;
      case "HANDOFF":
        if (status !== "ACCEPTED" || !body.wholesaler) throw new DomainError("Accept the opportunity and name the receiving wholesaler before handoff.", 409);
        status = "HANDED_OFF"; next.wholesaler = body.wholesaler; break;
      case "AGREE_FEE":
        if (!["ACCEPTED", "HANDED_OFF"].includes(status) || !body.exactFeeTerms || !body.feeAmount || !body.currency)
          throw new DomainError("Record exact fee terms, amount, and currency after acceptance; this records terms only, not payment.", 409);
        next.exactFeeTerms = body.exactFeeTerms; next.feeAmount = body.feeAmount;
        next.currency = body.currency; next.feeStatus = "PENDING"; break;
      case "MARK_RECEIVED":
        if (p.feeStatus !== "PENDING") throw new DomainError("Only an agreed pending fee can be marked received.", 409);
        next.feeStatus = "RECEIVED"; break;
      case "DISPUTE_FEE":
        if (!["PENDING", "RECEIVED"].includes(String(p.feeStatus))) throw new DomainError("No agreed fee is available to dispute.", 409);
        next.feeStatus = "DISPUTED"; break;
      case "WAIVE_FEE":
        if (!["PENDING", "DISPUTED"].includes(String(p.feeStatus))) throw new DomainError("Only a pending or disputed agreed fee can be waived.", 409);
        next.feeStatus = "WAIVED"; break;
    }
    next.history = [...history, { action: body.action, at: now.toISOString(), actor: actor.id,
      evidenceUrl: body.evidenceUrl, note: body.note, ...(body.wholesaler ? { wholesaler: body.wholesaler } : {}),
      ...(body.exactFeeTerms ? { exactFeeTerms: body.exactFeeTerms } : {}),
      ...(body.feeAmount ? { feeAmount: body.feeAmount, currency: body.currency } : {}) }];
    const [saved] = await tx.update(dealFinderSubmissionsTable).set({
      status, payload: next, version: row.version + 1, updatedAt: now,
    }).where(eq(dealFinderSubmissionsTable.id, id)).returning();
    if (!saved) throw new DomainError("Action was not saved.", 500);
    await audit(tx, actor.id, `DEAL_FINDER_${body.action}`, id,
      `${body.action}; finder attribution retained; fee status ${String(next.feeStatus)}; seller authority/contactability gates unchanged.`);
    return view(saved);
  });
}
