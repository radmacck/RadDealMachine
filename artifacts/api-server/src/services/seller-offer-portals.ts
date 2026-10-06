import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db, contractsTable, leadsTable, offersTable, sellerOfferPortalsTable, sellerOfferPortalEventsTable,
} from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { DomainError, assertOperationsRole, type OfferActor } from "@workspace/deal-domain";
import { audit, leadDetail, lockedLead, move } from "./deal-store";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type OfferTerms = {
  amount: number;
  earnestMoney: number;
  closingDays: number;
  contingencies: string;
  assignmentIntent: boolean;
};
type PortalSnapshot = {
  leadId: string;
  offerId: string;
  sellerName: string;
  propertyAddress: string;
  city: string;
  state: string;
  county: string;
  zip: string;
  terms: OfferTerms;
  approvedAt: string;
  expiresAt: string;
  preparedAt: string;
  verification: {
    salt: string;
    codeHash: string;
    failedAttempts: number;
    lockedAt: string | null;
    verifiedAt: string | null;
    verifiedRespondentName?: string;
    deliveryMethod: "PHONE" | "IN_PERSON";
    identityEvidenceId: string;
    verificationNote: string;
  };
};

const tokenHash = (token: string | undefined) => {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new DomainError("This seller offer link is invalid or no longer active.", 404);
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
};

function eventRecord(row: typeof sellerOfferPortalEventsTable.$inferSelect) {
  const payload = row.payload;
  return {
    eventKey: row.eventKey,
    action: row.kind,
    respondentName: String(payload.respondentName ?? ""),
    occurredAt: row.occurredAt.toISOString(),
    note: String(payload.note ?? ""),
    counterTerms: payload.counterTerms && typeof payload.counterTerms === "object"
      ? payload.counterTerms as OfferTerms
      : null,
    identityVerification: payload.identityVerification === "VERIFIED_ONE_TIME_CODE"
      ? "VERIFIED_ONE_TIME_CODE" as const
      : "LEGACY_UNVERIFIED" as const,
    identityVerifiedAt: typeof payload.identityVerifiedAt === "string" ? payload.identityVerifiedAt : null,
  };
}

async function portalView(
  database: typeof db | Tx,
  portal: typeof sellerOfferPortalsTable.$inferSelect,
  now: Date,
) {
  const [eventRows, contractRows] = await Promise.all([
    database.select().from(sellerOfferPortalEventsTable)
      .where(eq(sellerOfferPortalEventsTable.portalId, portal.id))
      .orderBy(sellerOfferPortalEventsTable.recordedAt),
    database.select().from(contractsTable).where(eq(contractsTable.leadId, portal.leadId)),
  ]);
  const events = eventRows.map(eventRecord);
  const detail = await leadDetail(portal.leadId, database, now);
  const offer = detail.offers.find((item) => item.id === portal.offerId);
  const storedSnapshot = portal.snapshot as unknown as Partial<PortalSnapshot>;
  const verification = storedSnapshot.verification;
  const verificationReady = !!verification?.salt && /^[0-9a-f]{64}$/i.test(verification.codeHash ?? "")
    && Number.isInteger(verification.failedAttempts) && !!verification.deliveryMethod;
  const activeContract = contractRows.length > 0;
  const isExpired = portal.expiresAt.getTime() <= now.getTime();
  const canRespond = portal.status === "ACTIVE"
    && events.length === 0
    && !isExpired
    && offer?.effectiveStatus === "COMMUNICATED"
    && !activeContract;
    // Identity controls are enforced separately below; legacy links are intentionally non-actionable.
  const identityCanRespond = canRespond && verificationReady && !verification?.lockedAt;
  const unavailableReason = portal.status === "REVOKED"
    ? "The owner revoked this link. Contact the deal owner for a current offer."
    : events.length
      ? "Your response is recorded and cannot be changed through this link. Contact the deal owner with any new information."
      : isExpired
        ? "The response window for this offer has expired. Contact the deal owner."
        : offer?.effectiveStatus !== "COMMUNICATED"
          ? "This offer is no longer current. Contact the deal owner for the latest terms."
          : activeContract
            ? "A transaction record is already in progress. Contact the deal owner."
          : !verificationReady
            ? "This link was issued without seller-contact verification. Ask the deal owner for a new verified link."
            : verification?.lockedAt
              ? "Identity verification is locked after repeated incorrect codes. Contact the deal owner to rotate the link."
              : null;
  return schemas.GetSellerOfferPortalResponse.parse({
    id: portal.id,
    status: portal.status,
    snapshot: {
      leadId: storedSnapshot.leadId,
      offerId: storedSnapshot.offerId,
      sellerName: storedSnapshot.sellerName,
      propertyAddress: storedSnapshot.propertyAddress,
      city: storedSnapshot.city,
      state: storedSnapshot.state,
      county: storedSnapshot.county,
      zip: storedSnapshot.zip,
      terms: storedSnapshot.terms,
      approvedAt: storedSnapshot.approvedAt,
      expiresAt: storedSnapshot.expiresAt,
      preparedAt: storedSnapshot.preparedAt,
      identityVerificationRequired: true,
      verificationDeliveryMethod: verification?.deliveryMethod ?? "PHONE",
    },
    expiresAt: portal.expiresAt.toISOString(),
    canRespond: identityCanRespond,
    unavailableReason,
    events,
  });
}

export async function getSellerOfferPortalControl(leadId: string, offerId: string, now = new Date()) {
  const portalRows = await db.select().from(sellerOfferPortalsTable)
    .where(and(eq(sellerOfferPortalsTable.leadId, leadId), eq(sellerOfferPortalsTable.offerId, offerId)))
    .orderBy(desc(sellerOfferPortalsTable.createdAt));
  const portal = portalRows.find((row) => row.status === "ACTIVE")
    ?? portalRows.find((row) => row.status === "RESPONDED")
    ?? portalRows[0];
  return schemas.GetSellerOfferPortalControlResponse.parse({
    current: portal ? await portalView(db, portal, now) : null,
  });
}

export async function issueSellerOfferPortal(
  leadId: string,
  offerId: string,
  input: unknown,
  actor: OfferActor,
  now = new Date(),
) {
  assertOperationsRole(actor, ["OWNER"]);
  const parsed = schemas.IssueSellerOfferPortalBody.parse(input);
  const token = randomBytes(32).toString("base64url");
  const verificationCode = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const verificationSalt = randomBytes(16).toString("hex");
  const verificationCodeHash = createHash("sha256")
    .update(`${verificationSalt}:${verificationCode}`, "utf8").digest("hex");
  let portalId = "";

  await db.transaction(async (tx) => {
    const lead = await lockedLead(tx, leadId, parsed.version);
    const detail = await leadDetail(leadId, tx, now);
    const offer = detail.offers.find((item) => item.id === offerId);
    if (!offer || offer.effectiveStatus !== "COMMUNICATED" || !offer.expiresAt) {
      throw new DomainError("A current, unexpired, owner-authorized offer that was recorded as communicated is required.", 409);
    }
    if (Date.parse(offer.expiresAt) <= now.getTime()) {
      throw new DomainError("This offer has expired. Create and authorize new exact terms before issuing a seller link.", 409);
    }
    if (!(detail.lead.sellerName ?? "").trim()) throw new DomainError("A verified seller name is required before issuing a private response link.", 409);
    if (parsed.verificationDeliveryMethod === "PHONE" && !(detail.lead.sellerPhone ?? "").trim()) {
      throw new DomainError("A seller phone number is required for phone-based code delivery. Use in-person delivery or verify a phone first.", 409);
    }
    const authorityCategories = new Set(["ownership", "seller_authority", "owner_authority"]);
    const identityEvidence = detail.intelligence.find((item) => item.id === parsed.identityEvidenceId);
    const evidenceAgeMs = identityEvidence ? now.getTime() - Date.parse(identityEvidence.capturedAt) : NaN;
    if (!identityEvidence
      || identityEvidence.classification !== "VERIFIED_FACTS"
      || identityEvidence.sourceType !== "PUBLIC_RECORD"
      || !authorityCategories.has(identityEvidence.category.trim().toLowerCase())
      || !identityEvidence.verificationNote?.trim()
      || !Number.isFinite(evidenceAgeMs)
      || evidenceAgeMs < 0
      || evidenceAgeMs > 30 * 86_400_000) {
      throw new DomainError("Select current verified public-record ownership or seller-authority evidence before issuing a link.", 409);
    }
    const [contract] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId, leadId));
    if (contract) throw new DomainError("A contract record already exists for this deal. Continue in the transaction workflow.", 409);
    const priorPortals = await tx.select({ id: sellerOfferPortalsTable.id }).from(sellerOfferPortalsTable)
      .where(eq(sellerOfferPortalsTable.offerId, offerId));
    if (priorPortals.length) {
      const [priorResponse] = await tx.select({ id: sellerOfferPortalEventsTable.id })
        .from(sellerOfferPortalEventsTable)
        .where(inArray(sellerOfferPortalEventsTable.portalId, priorPortals.map((item) => item.id)));
      if (priorResponse) {
        throw new DomainError("A seller response is already recorded for this offer. Create and authorize new exact terms before issuing another link.", 409);
      }
    }
    const snapshot: PortalSnapshot = {
      leadId,
      offerId,
      sellerName: detail.lead.sellerName,
      propertyAddress: detail.lead.address,
      city: detail.lead.city,
      state: detail.lead.state,
      county: detail.lead.county,
      zip: detail.lead.zip,
      terms: {
        amount: offer.amount,
        earnestMoney: offer.earnestMoney,
        closingDays: offer.closingDays,
        contingencies: offer.contingencies,
        assignmentIntent: offer.assignmentIntent,
      },
      approvedAt: offer.approvedAt!,
      expiresAt: offer.expiresAt,
      preparedAt: now.toISOString(),
      verification: {
        salt: verificationSalt,
        codeHash: verificationCodeHash,
        failedAttempts: 0,
        lockedAt: null,
        verifiedAt: null,
        deliveryMethod: parsed.verificationDeliveryMethod,
        identityEvidenceId: identityEvidence.id,
        verificationNote: parsed.verificationNote.trim(),
      },
    };

    await tx.update(sellerOfferPortalsTable).set({ status: "REVOKED", revokedAt: now })
      .where(and(eq(sellerOfferPortalsTable.offerId, offerId), eq(sellerOfferPortalsTable.status, "ACTIVE")));
    const [created] = await tx.insert(sellerOfferPortalsTable).values({
      leadId,
      offerId,
      tokenHash: tokenHash(token),
      status: "ACTIVE",
      snapshot,
      createdBy: actor.id,
      createdAt: now,
      expiresAt: new Date(offer.expiresAt),
    }).returning();
    if (!created) throw new Error("Seller offer portal could not be created.");
    portalId = created.id;
    await tx.update(leadsTable).set({ version: lead.version + 1, updatedAt: now }).where(eq(leadsTable.id, leadId));
    await audit(tx, actor.id, "SELLER_OFFER_PORTAL_ISSUED", leadId,
      `Issued a private seller-response link for communicated offer ${offerId}; exact terms are frozen, expires ${offer.expiresAt}. Owner identity evidence ${identityEvidence.id} was checked. A one-time code must be delivered separately by ${parsed.verificationDeliveryMethod}; owner attestation: ${parsed.verificationNote.trim()}. Any prior active link was revoked. No message was sent and no signature or contract was created.`);
  });

  const [portal] = await db.select().from(sellerOfferPortalsTable)
    .where(eq(sellerOfferPortalsTable.id, portalId));
  if (!portal) throw new Error("Issued seller offer portal could not be reloaded.");
  return schemas.IssueSellerOfferPortalResponse.parse({
    portal: await portalView(db, portal, now),
    token,
    verificationCode,
  });
}

export async function getSellerOfferPortal(token: string | undefined, now = new Date()) {
  const hash = tokenHash(token);
  const [portal] = await db.select().from(sellerOfferPortalsTable)
    .where(eq(sellerOfferPortalsTable.tokenHash, hash));
  if (!portal || portal.status === "REVOKED") {
    throw new DomainError("This seller offer link is invalid or no longer active.", 410);
  }
  return portalView(db, portal, now);
}

export async function respondToSellerOfferPortal(
  token: string | undefined,
  input: unknown,
  now = new Date(),
) {
  const hash = tokenHash(token);
  const parsed = schemas.RespondToSellerOfferPortalBody.parse(input);
  const note = parsed.note?.trim() ?? "";
  const respondentName = parsed.respondentName.trim();
  if (!respondentName) throw new DomainError("Enter the name of the person responding.", 400);
  const counterTerms = parsed.counterTerms ?? null;
  const verificationCode = parsed.verificationCode;
  if (parsed.action === "COUNTERED" && !counterTerms) {
    throw new DomainError("A counter proposal must include all proposed commercial terms.", 400);
  }
  if (parsed.action !== "COUNTERED" && counterTerms) {
    throw new DomainError("Only a counter response may include proposed commercial terms.", 400);
  }
  if (counterTerms && counterTerms.earnestMoney > counterTerms.amount) {
    throw new DomainError("Proposed earnest money cannot exceed the proposed purchase price.", 400);
  }
  const canonical = { eventKey: parsed.eventKey, action: parsed.action, respondentName, note, counterTerms };
  let portalId = "";
  let verificationError: DomainError | null = null;

  await db.transaction(async (tx) => {
    const [lookup] = await tx.select().from(sellerOfferPortalsTable)
      .where(eq(sellerOfferPortalsTable.tokenHash, hash));
    if (!lookup) throw new DomainError("This seller offer link is invalid or no longer active.", 404);
    const lead = await lockedLead(tx, lookup.leadId);
    const [portal] = await tx.select().from(sellerOfferPortalsTable)
      .where(eq(sellerOfferPortalsTable.id, lookup.id)).for("update");
    if (!portal) throw new DomainError("This seller offer link is invalid or no longer active.", 404);
    portalId = portal.id;
    const [existing] = await tx.select().from(sellerOfferPortalEventsTable)
      .where(eq(sellerOfferPortalEventsTable.portalId, portal.id));
    if (existing) {
      const stored = existing.payload;
      const same = existing.eventKey === canonical.eventKey
        && existing.kind === canonical.action
        && stored.respondentName === canonical.respondentName
        && stored.note === canonical.note
        && isDeepStrictEqual(stored.counterTerms ?? null, canonical.counterTerms);
      if (!same) throw new DomainError("This offer link already has a different recorded response.", 409);
      return;
    }
    if (portal.status !== "ACTIVE" || portal.expiresAt.getTime() <= now.getTime()) {
      throw new DomainError("This seller offer link is no longer open for a response.", 410);
    }
    const detail = await leadDetail(portal.leadId, tx, now);
    const offer = detail.offers.find((item) => item.id === portal.offerId);
    if (offer?.effectiveStatus !== "COMMUNICATED") {
      throw new DomainError("This offer is no longer current. The response was not recorded; contact the deal owner.", 409);
    }
    const [contract] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId, portal.leadId));
    if (contract) throw new DomainError("A transaction record is already in progress. Contact the deal owner.", 409);
    const snapshot = portal.snapshot as unknown as PortalSnapshot;
    const verification = snapshot.verification;
    if (!verification?.salt || !/^[0-9a-f]{64}$/i.test(verification.codeHash ?? "")) {
      verificationError = new DomainError("This link has no seller-contact verification challenge. Contact the deal owner for a new link.", 409);
      return;
    }
    if (verification.lockedAt || verification.failedAttempts >= 5) {
      verificationError = new DomainError("Too many incorrect verification codes. Contact the deal owner to rotate the link.", 429);
      return;
    }
    const submittedHash = createHash("sha256").update(`${verification.salt}:${verificationCode}`, "utf8").digest();
    const expectedHash = Buffer.from(verification.codeHash, "hex");
    const codeIsValid = expectedHash.length === submittedHash.length && timingSafeEqual(expectedHash, submittedHash);
    if (!codeIsValid) {
      const failedAttempts = verification.failedAttempts + 1;
      const lockedAt = failedAttempts >= 5 ? now.toISOString() : null;
      await tx.update(sellerOfferPortalsTable).set({
        snapshot: { ...snapshot, verification: { ...verification, failedAttempts, lockedAt } },
      }).where(eq(sellerOfferPortalsTable.id, portal.id));
      await audit(tx, `seller-portal:${portal.id}`, "SELLER_OFFER_PORTAL_VERIFICATION_FAILED", portal.leadId,
        `Seller contact-code verification failed for portal ${portal.id}; attempt ${failedAttempts} of 5. The submitted code was not stored.`);
      verificationError = new DomainError(
        lockedAt
          ? "Verification failed five times. This link is locked; contact the deal owner."
          : "The verification code is incorrect. Check the separate code from the deal owner and try again.",
        lockedAt ? 429 : 401,
      );
      return;
    }
    const identityVerifiedAt = now.toISOString();
    await tx.update(sellerOfferPortalsTable).set({
      snapshot: {
        ...snapshot,
        verification: { ...verification, verifiedAt: identityVerifiedAt, verifiedRespondentName: respondentName },
      },
    }).where(eq(sellerOfferPortalsTable.id, portal.id));

    await tx.insert(sellerOfferPortalEventsTable).values({
      portalId: portal.id,
      eventKey: canonical.eventKey,
      kind: canonical.action,
      payload: {
        ...canonical,
        identityVerification: "VERIFIED_ONE_TIME_CODE",
        identityVerifiedAt,
      },
      occurredAt: now,
      recordedAt: now,
    });
    await tx.update(sellerOfferPortalsTable).set({ status: "RESPONDED" })
      .where(eq(sellerOfferPortalsTable.id, portal.id));
    const nextAction = canonical.action === "ACCEPTED"
      ? "Owner review seller's recorded acceptance; confirm exact terms and prepare the external contract for signatures."
      : canonical.action === "COUNTERED"
        ? "Owner review seller's proposed counter terms; draft and authorize a new offer before communicating any revised terms."
        : "Owner review seller's rejection and decide the next acquisition action; no offer terms were changed.";
    const actor = `seller-portal:${portal.id}`;
    await move(tx, lead, "NEGOTIATING", `Seller submitted ${canonical.action.toLowerCase()} through the private offer portal. This records seller response only; it is not a signature, contract or authority to vary terms.`, nextAction, actor, now);
    await tx.update(leadsTable).set({
      stage: lead.stage,
      nextAction: lead.nextAction,
      followUpAt: now,
      version: lead.version + 1,
      updatedAt: now,
    }).where(eq(leadsTable.id, portal.leadId));
    await audit(tx, actor, "SELLER_OFFER_PORTAL_RESPONSE", portal.leadId,
      `${canonical.action} recorded for offer ${portal.offerId}; portal event ${canonical.eventKey}; one-time code verified control of the owner-confirmed ${verification.deliveryMethod} contact using ownership evidence ${verification.identityEvidenceId}. Respondent name remains self-reported; no legal authority, contract or new commercial authority was created.`);
  });

  if (verificationError) throw verificationError;
  const [portal] = await db.select().from(sellerOfferPortalsTable)
    .where(eq(sellerOfferPortalsTable.id, portalId));
  if (!portal) throw new DomainError("This seller offer link is no longer active.", 410);
  return portalView(db, portal, now);
}
