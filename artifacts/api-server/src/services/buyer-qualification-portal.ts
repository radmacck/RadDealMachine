import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { eq, sql } from "drizzle-orm";
import {
  CreateBuyerQualificationPortalInviteBody,
  CreateBuyerQualificationPortalInviteResponse,
  GetBuyerQualificationPortalResponse,
  RespondToBuyerQualificationPortalBody,
  RespondToBuyerQualificationPortalResponse,
} from "@workspace/api-zod";
import { assertOperationsRole, criteriaBlockers, DomainError, type OfferActor } from "@workspace/deal-domain";
import { db, buyersTable } from "@workspace/db";
import { audit } from "./deal-store";
import { buyerRecord, queueJob } from "./operations-records";
import { qualificationTask } from "./buyer-pool";

const INVITE_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
const digest = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

function tokenDigest(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new DomainError("This buyer profile link is invalid or no longer active.", 404);
  }
  return digest(token);
}

type Invite = {
  id: string;
  tokenDigest: string;
  state: "ACTIVE" | "REPLACED" | "COMPLETED" | "EXPIRED";
  issuedAt: string;
  expiresAt: string;
  baseVersion: number;
  createdBy: string;
  responseId?: string;
  response?: {
    responseId: string;
    currentBuyingStatus: "BUYING" | "NOT_BUYING";
    criteria: unknown;
    confirmedCurrent: true;
    note: string;
    receivedAt: string;
  };
};

function inviteFrom(row: typeof buyersTable.$inferSelect): Invite | null {
  const value = row.payload.qualificationPortalInvite;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<Invite>;
  if (
    typeof item.id !== "string" ||
    typeof item.tokenDigest !== "string" ||
    typeof item.state !== "string" ||
    typeof item.issuedAt !== "string" ||
    typeof item.expiresAt !== "string" ||
    typeof item.baseVersion !== "number" ||
    typeof item.createdBy !== "string"
  ) return null;
  return item as Invite;
}

async function findByToken(database: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], hash: string, lock = false) {
  const query = database.select().from(buyersTable)
    .where(sql`${buyersTable.payload}->'qualificationPortalInvite'->>'tokenDigest' = ${hash}`);
  const rows = lock ? await query.for("update") : await query;
  return rows[0] ?? null;
}

function usableInvite(row: typeof buyersTable.$inferSelect, now: Date) {
  const invite = inviteFrom(row);
  if (!invite || invite.state !== "ACTIVE") {
    throw new DomainError("This buyer profile link is invalid, already used, or replaced.", 410);
  }
  if (Date.parse(invite.expiresAt) <= now.getTime()) {
    throw new DomainError("This buyer profile link has expired. Ask the operator for a new one.", 410);
  }
  if (invite.baseVersion !== row.version) {
    throw new DomainError("This buyer profile changed after the link was created. Ask the operator for a refreshed link.", 409);
  }
  return invite;
}

export async function createBuyerQualificationPortalInvite(
  buyerId: string,
  input: unknown,
  actor: OfferActor,
  now = new Date(),
) {
  assertOperationsRole(actor, ["OWNER"]);
  const parsed = CreateBuyerQualificationPortalInviteBody.parse(input);
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + INVITE_LIFETIME_MS).toISOString();

  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id, buyerId)).for("update");
    if (!row) throw new DomainError("Buyer not found.", 404);
    if (row.version !== parsed.version) throw new DomainError("Buyer changed. Reload before creating a profile link.", 409);

    const prior = inviteFrom(row);
    const history = Array.isArray(row.payload.qualificationPortalHistory)
      ? row.payload.qualificationPortalHistory.filter((item) => item && typeof item === "object")
      : [];
    if (prior && prior.state === "ACTIVE") {
      history.push({
        invitationId: prior.id,
        state: "REPLACED",
        issuedAt: prior.issuedAt,
        expiresAt: prior.expiresAt,
        replacedAt: now.toISOString(),
      });
    }
    const nextVersion = row.version + 1;
    const invite: Invite = {
      id,
      tokenDigest: digest(token),
      state: "ACTIVE",
      issuedAt: now.toISOString(),
      expiresAt,
      baseVersion: nextVersion,
      createdBy: actor.id,
    };
    const [saved] = await tx.update(buyersTable).set({
      payload: {
        ...row.payload,
        qualificationPortalInvite: invite,
        qualificationPortalHistory: history,
      },
      version: nextVersion,
      updatedAt: now,
    }).where(eq(buyersTable.id, buyerId)).returning();
    if (!saved) throw new Error("Buyer profile link was not saved.");
    await audit(tx, actor.id, "BUYER_QUALIFICATION_LINK_CREATED", buyerId,
      `Created expiring buyer profile link ${id}; link is not sent and grants no approval. Expires ${expiresAt}.`);
    return CreateBuyerQualificationPortalInviteResponse.parse({
      invitationId: id,
      token,
      expiresAt,
      notSent: true,
    });
  });
}

export async function getBuyerQualificationPortal(token: string | undefined, now = new Date()) {
  const row = await findByToken(db, tokenDigest(token));
  if (!row) throw new DomainError("This buyer profile link is invalid or no longer active.", 404);
  const invite = usableInvite(row, now);
  const buyer = buyerRecord(row, now);
  return GetBuyerQualificationPortalResponse.parse({
    invitationId: invite.id,
    buyerName: buyer.name,
    criteria: buyer.criteria,
    expiresAt: invite.expiresAt,
  });
}

export async function respondToBuyerQualificationPortal(
  token: string | undefined,
  input: unknown,
  now = new Date(),
) {
  const hash = tokenDigest(token);
  const parsed = RespondToBuyerQualificationPortalBody.parse(input);
  if (!parsed.confirmedCurrent) throw new DomainError("Confirm the profile is current before submitting.", 400);
  const missing = criteriaBlockers(parsed.criteria);
  if (missing.length) throw new DomainError(missing.join("; "), 400);

  let response: ReturnType<typeof RespondToBuyerQualificationPortalResponse.parse> | undefined;
  await db.transaction(async (tx) => {
    const row = await findByToken(tx, hash, true);
    if (!row) throw new DomainError("This buyer profile link is invalid or no longer active.", 404);
    const invite = inviteFrom(row);
    if (!invite) throw new DomainError("This buyer profile link is invalid or no longer active.", 404);

    if (invite.state === "COMPLETED" && invite.response) {
      const attempted = {
        responseId: parsed.responseId,
        currentBuyingStatus: parsed.currentBuyingStatus,
        criteria: parsed.criteria,
        confirmedCurrent: parsed.confirmedCurrent,
        note: parsed.note ?? "",
      };
      const saved = {
        responseId: invite.response.responseId,
        currentBuyingStatus: invite.response.currentBuyingStatus,
        criteria: invite.response.criteria,
        confirmedCurrent: invite.response.confirmedCurrent,
        note: invite.response.note,
      };
      if (!isDeepStrictEqual(attempted, saved)) {
        throw new DomainError("This one-time link already received a different response.", 409);
      }
      response = RespondToBuyerQualificationPortalResponse.parse({
        status: "RECEIVED_PENDING_OWNER_REVIEW",
        receivedAt: invite.response.receivedAt,
        ownerReviewRequired: true,
      });
      return;
    }

    usableInvite(row, now);
    const buyerBefore = buyerRecord(row, now);
    const receivedAt = now.toISOString();
    const history = Array.isArray(row.payload.qualificationPortalResponseHistory)
      ? row.payload.qualificationPortalResponseHistory.filter((item) => item && typeof item === "object")
      : [];
    const previousSelfReport = row.payload.qualificationPortalSelfReport;
    if (previousSelfReport && typeof previousSelfReport === "object") history.push(previousSelfReport);
    const ownerTask = {
      ...qualificationTask(
      { ...buyerBefore, criteria: parsed.criteria },
      "REVERIFY",
      now,
      ),
      state: "WAITING_REVIEW" as const,
      reason: "A bearer of the private profile link submitted self-reported criteria and current-buying status. Identity, contact authority, funding and buying evidence remain unverified.",
      preparedMessage: "Review the latest buyer self-report and obtain dated identity, current-buying, criteria and funding evidence through a permitted channel. The portal response is INDICATED only and does not qualify or approve this buyer.",
      updatedAt: receivedAt,
    };

    const responseRecord = {
      responseId: parsed.responseId,
      currentBuyingStatus: parsed.currentBuyingStatus,
      criteria: parsed.criteria,
      confirmedCurrent: true as const,
      note: parsed.note ?? "",
      receivedAt,
    };
    const completedInvite: Invite = {
      ...invite,
      state: "COMPLETED",
      responseId: parsed.responseId,
      response: responseRecord,
    };
    const qualificationHistory = Array.isArray(row.payload.qualificationTaskHistory)
      ? row.payload.qualificationTaskHistory.filter((item) => item && typeof item === "object")
      : [];
    if (buyerBefore.qualificationTask) qualificationHistory.push(buyerBefore.qualificationTask);

    const [saved] = await tx.update(buyersTable).set({
      payload: {
        ...row.payload,
        criteria: parsed.criteria,
        currentBuyingStatus: parsed.currentBuyingStatus === "NOT_BUYING" ? "NOT_BUYING" : "UNKNOWN",
        verifiedBy: null,
        verifiedAt: null,
        evidenceAt: null,
        validUntil: null,
        identityEvidenceUrl: null,
        fundingEvidenceUrl: null,
        availableFunds: null,
        verifiedFundingTypes: [],
        verificationNote: null,
        buyingVerifiedAt: null,
        buyingEvidenceAt: null,
        buyingEvidenceUrl: null,
        criteriaEvidenceUrl: null,
        verificationSource: null,
        confidence: null,
        qualificationPortalSelfReport: {
          ...responseRecord,
          invitationId: invite.id,
          source: "PRIVATE_BUYER_QUALIFICATION_PORTAL",
          classification: "INDICATED",
          identityVerified: false,
          contactPermissionVerified: false,
          ownerReviewRequired: true,
        },
        qualificationPortalResponseHistory: history,
        qualificationPortalInvite: completedInvite,
        qualificationTask: ownerTask,
        qualificationTaskHistory: qualificationHistory,
      },
      version: row.version + 1,
      updatedAt: now,
    }).where(eq(buyersTable.id, row.id)).returning();
    if (!saved) throw new Error("Buyer self-report was not saved.");

    await audit(tx, `buyer-portal:${invite.id}`, "BUYER_SELF_REPORTED_PROFILE_RECEIVED", row.id,
      `Private-link bearer reported current buying status ${parsed.currentBuyingStatus} and updated criteria at ${receivedAt}. Classification INDICATED; identity/permission unverified; buyer matching approval cleared pending owner evidence review.`);
    await queueJob(tx, "MATCH_BUYERS", null, `buyer-profile-response:${row.id}:${invite.id}`, `buyer-portal:${invite.id}`);
    await queueJob(tx, "REVIEW_BUYER_POOL", null, `buyer-profile-review:${row.id}:${invite.id}`, `buyer-portal:${invite.id}`);
    await queueJob(tx, "EVALUATE_DECISION", null, `decision:buyer-profile-response:${row.id}:${invite.id}`,
      `buyer-portal:${invite.id}`, { trigger: "BUYER_PROFILE_RESPONSE", buyerId: row.id });
    response = RespondToBuyerQualificationPortalResponse.parse({
      status: "RECEIVED_PENDING_OWNER_REVIEW",
      receivedAt,
      ownerReviewRequired: true,
    });
  });
  if (!response) throw new Error("Buyer profile response was not recorded.");
  return response;
}
