import { createHash, randomBytes } from "node:crypto";
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
  const activeContract = contractRows.length > 0;
  const isExpired = portal.expiresAt.getTime() <= now.getTime();
  const canRespond = portal.status === "ACTIVE"
    && events.length === 0
    && !isExpired
    && offer?.effectiveStatus === "COMMUNICATED"
    && !activeContract;
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
            : null;
  return schemas.GetSellerOfferPortalResponse.parse({
    id: portal.id,
    status: portal.status,
    snapshot: portal.snapshot,
    expiresAt: portal.expiresAt.toISOString(),
    canRespond,
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
      `Issued a private seller-response link for communicated offer ${offerId}; exact terms are frozen, expires ${offer.expiresAt}. Any prior active link for this offer was revoked. Sharing is manual; no message was sent and no signature or contract was created.`);
  });

  const [portal] = await db.select().from(sellerOfferPortalsTable)
    .where(eq(sellerOfferPortalsTable.id, portalId));
  if (!portal) throw new Error("Issued seller offer portal could not be reloaded.");
  return schemas.IssueSellerOfferPortalResponse.parse({
    portal: await portalView(db, portal, now),
    token,
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

    await tx.insert(sellerOfferPortalEventsTable).values({
      portalId: portal.id,
      eventKey: canonical.eventKey,
      kind: canonical.action,
      payload: canonical,
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
      `${canonical.action} recorded for offer ${portal.offerId}; portal event ${canonical.eventKey}; typed name is self-reported, identity is not independently verified, and no contract or new commercial authority was created.`);
  });

  const [portal] = await db.select().from(sellerOfferPortalsTable)
    .where(eq(sellerOfferPortalsTable.id, portalId));
  if (!portal) throw new DomainError("This seller offer link is no longer active.", 410);
  return portalView(db, portal, now);
}
