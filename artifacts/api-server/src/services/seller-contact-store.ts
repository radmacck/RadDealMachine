import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import {
  db, intelligenceTable, leadsTable, propertyDiscoveriesTable,
  propertySourceObservationsTable,
} from "@workspace/db";
import {
  GetSellerContactPathsResponse,
  RecordSellerContactObservationBody, RecordSellerContactObservationResponse,
} from "@workspace/api-zod";
import { DomainError, type OfferActor } from "@workspace/deal-domain";
import {
  contactPathKey, reconcileContactPaths, type PropertyContactPath,
} from "@workspace/property-sources";
import { audit, lockedLead } from "./deal-store";
import { queueJob } from "./operations-records";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Query = typeof db | Tx;
const ROUTE_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;
const iso = (value: Date) => value.toISOString();
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type NonPostalChannel = Exclude<PropertyContactPath["channel"], "POSTAL">;
const channelRouteKey = (channel: NonPostalChannel, value: string) =>
  contactPathKey({
    id: "candidate", channel, recipient: null, routeValue: value, postalCode: null,
    classification: "OBSERVED", confidence: 0, sourceId: "", sourceName: "", sourceRecordId: "",
    sourceUrl: "", capturedAt: "", freshUntilAt: "", freshnessStatus: "STALE", permissionStatus: "NOT_REVIEWED",
  });
const routeIsCurrentAndUsable = (path: PropertyContactPath) =>
  path.freshnessStatus === "CURRENT" &&
  path.permissionStatus === "PERMITTED" &&
  path.routeVerificationStatus === "CONFIRMED" &&
  path.identityConflictStatus !== "MULTIPLE_RECIPIENTS" &&
  path.identityConflictStatus !== "MULTIPLE_ROLES";

function pathFrom(value: unknown): PropertyContactPath | null {
  const path = asRecord(value);
  if (typeof path.id !== "string" ||
    !["POSTAL", "PHONE", "EMAIL", "WEB", "OTHER"].includes(String(path.channel)) ||
    !["OBSERVED", "VERIFIED"].includes(String(path.classification)) ||
    typeof path.confidence !== "number" || typeof path.sourceId !== "string" ||
    typeof path.sourceName !== "string" || typeof path.sourceRecordId !== "string" ||
    typeof path.capturedAt !== "string" || typeof path.freshUntilAt !== "string" ||
    !["CURRENT", "STALE"].includes(String(path.freshnessStatus)) ||
    !["NOT_REVIEWED", "PERMITTED", "PROHIBITED"].includes(String(path.permissionStatus))) return null;
  if (path.channel !== "POSTAL" && typeof path.routeValue !== "string") return null;
  if (path.channel === "POSTAL" && (!Array.isArray(path.addressLines) || typeof path.cityState !== "string")) return null;
  return path as unknown as PropertyContactPath;
}

async function getAllPaths(id: string, query: Query) {
  const paths: PropertyContactPath[] = [];
  const entries = await query.select().from(intelligenceTable).where(eq(intelligenceTable.leadId, id)).orderBy(desc(intelligenceTable.createdAt));
  for (const entry of entries) {
    const candidate = asRecord(entry.payload).contactPath;
    const path = pathFrom(candidate);
    if (path) paths.push(path);
  }
  const discoveries = await query.select().from(propertyDiscoveriesTable).where(eq(propertyDiscoveriesTable.leadId, id));
  for (const discovery of discoveries) {
    const payload = asRecord(discovery.payload);
    const property = asRecord(payload.property);
    for (const value of [
      ...(Array.isArray(payload.contactPaths) ? payload.contactPaths : []),
      ...(Array.isArray(property.contactPaths) ? property.contactPaths : []),
    ]) {
      const path = pathFrom(value);
      if (path) paths.push(path);
    }
  }
  if (discoveries.length) {
    const observations = await query.select().from(propertySourceObservationsTable)
      .where(inArray(propertySourceObservationsTable.discoveryId, discoveries.map(row => row.id)));
    for (const observation of observations) {
      const payload = asRecord(observation.payload);
      const evidence = asRecord(payload.observation);
      const candidates = Array.isArray(payload.contactPaths) ? payload.contactPaths
        : Array.isArray(evidence.contactPaths) ? evidence.contactPaths : [];
      for (const value of candidates) {
        const path = pathFrom(value);
        if (path) paths.push(path);
      }
    }
  }
  return { paths, entries };
}

function buildReadiness(
  lead: { id: string; version: number; payload: Record<string, unknown> },
  observations: PropertyContactPath[],
  now: Date,
) {
  const contactPaths = reconcileContactPaths(observations, now);
  const phones = contactPaths.filter(path => path.channel === "PHONE");
  const emails = contactPaths.filter(path => path.channel === "EMAIL");
  const webRoutes = contactPaths.filter(path => path.channel === "WEB");
  const otherRoutes = contactPaths.filter(path => path.channel === "OTHER");
  const postalRoutes = contactPaths.filter(path => path.channel === "POSTAL");
  const directRoutes = [...phones, ...emails];
  const eligiblePhones = phones.filter(routeIsCurrentAndUsable);
  const eligibleEmails = emails.filter(routeIsCurrentAndUsable);
  const eligibleWebRoutes = webRoutes.filter(routeIsCurrentAndUsable);
  const eligibleOtherRoutes = otherRoutes.filter(routeIsCurrentAndUsable);
  const leadPhone = typeof lead.payload.sellerPhone === "string" ? lead.payload.sellerPhone.trim() : "";
  const leadEmail = typeof lead.payload.sellerEmail === "string" ? lead.payload.sellerEmail.trim() : "";
  const linkedPhone = leadPhone && phones.some(path => channelRouteKey("PHONE", path.routeValue ?? "") === channelRouteKey("PHONE", leadPhone));
  const linkedEmail = leadEmail && emails.some(path => channelRouteKey("EMAIL", path.routeValue ?? "") === channelRouteKey("EMAIL", leadEmail));
  const unlinkedExistingRoute = (!!leadPhone && !linkedPhone) || (!!leadEmail && !linkedEmail);
  const unresolvedCurrentDirect = directRoutes.some(path =>
    path.freshnessStatus === "CURRENT" &&
    path.permissionStatus !== "PROHIBITED" &&
    path.routeVerificationStatus !== "REJECTED" &&
    !routeIsCurrentAndUsable(path));
  const staleDirect = directRoutes.some(path =>
    path.freshnessStatus === "STALE" &&
    path.permissionStatus !== "PROHIBITED" &&
    path.routeVerificationStatus !== "REJECTED");
  const currentIdentityConflict = directRoutes.some(path =>
    path.freshnessStatus === "CURRENT" &&
    (path.identityConflictStatus === "MULTIPLE_RECIPIENTS" || path.identityConflictStatus === "MULTIPLE_ROLES"));
  let directRouteStatus:
    | "NO_DIRECT_ROUTE" | "STALE_ROUTE" | "CONFLICTING_ROUTE" | "NEEDS_REVIEW"
    | "POSTAL_ONLY" | "EMAIL_ONLY" | "WEB_ROUTE_AVAILABLE" | "OTHER_ROUTE_AVAILABLE" | "PHONE_ROUTE_AVAILABLE";
  let selectedPhonePath: PropertyContactPath | null = null;
  let selectedEmailPath: PropertyContactPath | null = null;
  if (currentIdentityConflict || eligiblePhones.length > 1 || eligibleEmails.length > 1 ||
    eligibleWebRoutes.length > 1 || eligibleOtherRoutes.length > 1) directRouteStatus = "CONFLICTING_ROUTE";
  else if (unlinkedExistingRoute) directRouteStatus = "NEEDS_REVIEW";
  else if (eligiblePhones.length === 1) {
    directRouteStatus = "PHONE_ROUTE_AVAILABLE";
    selectedPhonePath = eligiblePhones[0]!;
    if (eligibleEmails.length === 1) selectedEmailPath = eligibleEmails[0]!;
  } else if (eligibleEmails.length === 1) {
    directRouteStatus = "EMAIL_ONLY";
    selectedEmailPath = eligibleEmails[0]!;
  } else if (unresolvedCurrentDirect) directRouteStatus = "NEEDS_REVIEW";
  else if (staleDirect) directRouteStatus = "STALE_ROUTE";
  else if (eligibleWebRoutes.length === 1) directRouteStatus = "WEB_ROUTE_AVAILABLE";
  else if (eligibleOtherRoutes.length === 1) directRouteStatus = "OTHER_ROUTE_AVAILABLE";
  else if ([...webRoutes, ...otherRoutes].some(path => path.freshnessStatus === "CURRENT" &&
    path.permissionStatus !== "PROHIBITED" && path.routeVerificationStatus !== "REJECTED")) {
    directRouteStatus = "NEEDS_REVIEW";
  } else if ([...webRoutes, ...otherRoutes].some(path => path.freshnessStatus === "STALE" &&
    path.permissionStatus !== "PROHIBITED" && path.routeVerificationStatus !== "REJECTED")) {
    directRouteStatus = "STALE_ROUTE";
  } else if (postalRoutes.some(path => path.freshnessStatus === "CURRENT")) directRouteStatus = "POSTAL_ONLY";
  else directRouteStatus = "NO_DIRECT_ROUTE";

  const nextAction = directRouteStatus === "PHONE_ROUTE_AVAILABLE"
    ? "Use the ranked phone route only after reviewing its provenance. Confirm the person's identity and role during the conversation; signing authority is not established. No call has been placed."
    : directRouteStatus === "CONFLICTING_ROUTE"
      ? "Resolve the competing permitted contact routes with source-backed review; no route is selected and CALL READY remains blocked."
      : directRouteStatus === "NEEDS_REVIEW"
        ? "Review route validity, freshness, source provenance, and permission. No call has been placed."
        : directRouteStatus === "STALE_ROUTE"
          ? "The only direct contact evidence is stale. Refresh it from a permitted source before CALL READY; no contact attempt has been made."
        : directRouteStatus === "EMAIL_ONLY"
          ? "A permitted email route is recorded, but this workflow does not treat email alone as CALL READY. Confirm the contact and obtain a phone route if calling is required."
          : directRouteStatus === "WEB_ROUTE_AVAILABLE"
            ? "A permitted web/contact-form route is recorded, but this system does not submit forms or treat it as phone-based CALL READY."
            : directRouteStatus === "OTHER_ROUTE_AVAILABLE"
              ? "An other-type route is recorded for manual review; it is not treated as phone/email and no external contact is made."
          : directRouteStatus === "POSTAL_ONLY"
            ? "Only a public-record mailing route is available. It is not a phone/email route; no direct seller-contact provider is connected."
            : "No usable direct seller route is recorded and no seller-contact research provider is connected. Do not mark CALL READY.";

  return GetSellerContactPathsResponse.parse({
    leadVersion: lead.version,
    contactSourceProviderStatus: "NOT_CONNECTED",
    contactSourceProviderCount: 0,
    directRouteStatus,
    contactPaths,
    selectedPhonePath,
    selectedEmailPath,
    unresolvedPhoneRouteCount: phones.filter(path => path.routeVerificationStatus !== "REJECTED").length,
    nextAction,
    checkedAt: iso(now),
  });
}

export async function getSellerContactPaths(id: string, now = new Date(), query: Query = db) {
  const [lead] = await query.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) throw new DomainError("Property lead not found.", 404);
  const { paths } = await getAllPaths(id, query);
  return buildReadiness(lead, paths, now);
}

export async function recordSellerContactObservation(
  id: string,
  untrusted: unknown,
  actor: OfferActor,
  now = new Date(),
  providerEvidence?: {
    providerId: string;
    permissionEvidenceStatus: "SUPPORTS_ALLOWED" | "UNKNOWN" | "BLOCKED";
    legalBasis: "CONSENT" | "PUBLIC_SOURCE_TERMS" | "PUBLIC_DATA_REUSE" | "OTHER_DOCUMENTED" | "UNKNOWN";
    legalBasisScope: string;
    legalBasisEvidenceUrl: string | null;
    epistemicStatus: "OBSERVED" | "INDICATED" | "AI_HYPOTHESIS";
    recipientIdentityEvidenceStatus: "NONE" | "CLAIMED" | "SUPPORTING_RECORD";
    recipientIdentityEvidenceRef: string | null;
  },
) {
  const input = RecordSellerContactObservationBody.parse(untrusted);
  if (!["OWNER", "ANALYST"].includes(actor.role)) throw new DomainError("Only owners and analysts can record seller contact research.", 403);
  const routeValue = input.routeValue.trim();
  const digits = routeValue.replace(/\D/g, "");
  if (input.channel === "PHONE" && (digits.length < 7 || digits.length > 15)) {
    throw new DomainError("Phone route must contain 7–15 digits. No contact data was saved.", 400);
  }
  if (input.channel === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(routeValue)) {
    throw new DomainError("Email route is not a valid address. No contact data was saved.", 400);
  }
  if (input.channel === "WEB" && !/^https:\/\//i.test(routeValue)) {
    throw new DomainError("Web/contact-form routes must be HTTPS URLs. No contact data was saved.", 400);
  }
  if (["PUBLIC_RECORD", "PUBLIC_PAGE", "PERMITTED_LISTING"].includes(input.sourceType) &&
    (!input.sourceUrl || !input.sourceUrl.startsWith("https://"))) {
    throw new DomainError("Public-source contact observations require an HTTPS evidence URL.", 400);
  }
  if (input.permissionStatus === "PERMITTED" &&
    (!input.contactPermissionEvidenceUrl || !input.contactPermissionEvidenceUrl.startsWith("https://"))) {
    throw new DomainError("A permitted contact route requires HTTPS evidence that this source and use are permitted.", 400);
  }
  if (input.permissionStatus !== "NOT_REVIEWED" && actor.role !== "OWNER") {
    throw new DomainError("Only an owner can make a contact-source permission decision.", 403);
  }
  if (input.permissionStatus === "PROHIBITED" && !input.verificationNote?.trim()) {
    throw new DomainError("Marking a source/use prohibited requires an owner evidence note.", 400);
  }
  if (input.routeVerificationStatus !== "UNREVIEWED" && (actor.role !== "OWNER" || !input.verificationNote?.trim())) {
    throw new DomainError("Route confirmation or rejection requires an owner and a written evidence note.", 403);
  }
  if (input.classification === "VERIFIED" &&
    (actor.role !== "OWNER" || input.routeVerificationStatus !== "CONFIRMED" || !input.verificationNote?.trim())) {
    throw new DomainError("A verified route requires owner review, a confirmed route state, and an evidence note.", 400);
  }

  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : now;
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > now.getTime()) {
    throw new DomainError("Contact observation time must be valid and cannot be in the future.", 400);
  }
  const maxFreshUntil = new Date(capturedAt.getTime() + ROUTE_FRESHNESS_MS);
  const freshUntilAt = input.freshUntilAt ? new Date(input.freshUntilAt) : maxFreshUntil;
  if (!Number.isFinite(freshUntilAt.getTime()) || freshUntilAt <= capturedAt || freshUntilAt > maxFreshUntil) {
    throw new DomainError("Contact-route freshness cannot exceed 30 days from observation.", 400);
  }

  return db.transaction(async tx => {
    const row = await lockedLead(tx, id, input.version);
    const previous = await getAllPaths(id, tx);
    const key = channelRouteKey(input.channel, routeValue);
    const capturedIso = iso(capturedAt);
    const existing = previous.entries.find(entry => {
      const payload = asRecord(entry.payload);
      const path = pathFrom(payload.contactPath);
      return path && contactPathKey(path) === key &&
        path.sourceId === input.sourceId && path.sourceRecordId === input.sourceRecordId &&
        path.capturedAt === capturedIso && path.permissionStatus === input.permissionStatus &&
        path.routeVerificationStatus === input.routeVerificationStatus;
    });
    if (existing) return getSellerContactPaths(id, now, tx);

    const entryId = randomUUID();
    const path: PropertyContactPath = {
      id: entryId,
      channel: input.channel,
      recipient: input.recipient ?? null,
      routeValue,
      postalCode: null,
      classification: input.classification,
      confidence: input.confidence,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      sourceRecordId: input.sourceRecordId,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      capturedAt: capturedIso,
      freshUntilAt: iso(freshUntilAt),
      freshnessStatus: freshUntilAt > now ? "CURRENT" : "STALE",
      permissionStatus: input.permissionStatus,
      ...(providerEvidence ? {
        providerId: providerEvidence.providerId,
        permissionEvidenceStatus: providerEvidence.permissionEvidenceStatus,
        legalBasis: providerEvidence.legalBasis,
        legalBasisScope: providerEvidence.legalBasisScope,
        legalBasisEvidenceUrl: providerEvidence.legalBasisEvidenceUrl,
        epistemicStatus: providerEvidence.epistemicStatus,
        recipientIdentityEvidenceStatus: providerEvidence.recipientIdentityEvidenceStatus,
        recipientIdentityEvidenceRef: providerEvidence.recipientIdentityEvidenceRef,
      } : {}),
      contactPermissionEvidenceUrl: input.contactPermissionEvidenceUrl ?? null,
      permissionReviewedAt: input.permissionStatus === "NOT_REVIEWED" ? null : iso(now),
      sourceType: input.sourceType,
      recipientRole: input.recipientRole,
      routeVerificationStatus: input.routeVerificationStatus,
      routeReviewedAt: input.routeVerificationStatus === "UNREVIEWED" ? null : iso(now),
      verificationNote: input.verificationNote ?? null,
      identityStatus: "UNVERIFIED",
      signingAuthorityStatus: "NOT_ESTABLISHED",
    };
    const intelligencePayload = {
      classification: input.classification === "VERIFIED" ? "VERIFIED_FACTS" : "OBSERVED",
      category: "seller_contact",
      statement: `${input.channel} route observation recorded; reported recipient role ${input.recipientRole}. Route identity and signing authority remain unverified.`,
      source: input.sourceName,
      sourceType: input.sourceType,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      confidence: input.confidence,
      capturedAt: capturedIso,
      ...(input.verificationNote ? { verificationNote: input.verificationNote } : {}),
      contactPermissionStatus: input.permissionStatus,
      ...(input.contactPermissionEvidenceUrl ? { contactPermissionEvidenceUrl: input.contactPermissionEvidenceUrl } : {}),
      ...(providerEvidence ? { providerEvidence } : {}),
      contactPath: path,
    };
    await tx.insert(intelligenceTable).values({
      id: entryId, leadId: id, payload: intelligencePayload, createdBy: actor.id, createdAt: now,
    });

    const allPaths = [...previous.paths, path];
    const readiness = buildReadiness(row, allPaths, now);
    const transactionLocked = ["UNDER_CONTRACT", "BUYER_MATCHED", "BUYER_INTERESTED", "BUYER_COMMITTED", "CLOSING"].includes(row.stage);
    const priorUnderwriting = row.underwriting && typeof row.underwriting === "object"
      ? { ...(row.underwriting as Record<string, unknown>) }
      : null;
    const currentPhone = typeof row.payload.sellerPhone === "string" ? row.payload.sellerPhone.trim() : "";
    const currentEmail = typeof row.payload.sellerEmail === "string" ? row.payload.sellerEmail.trim() : "";
    const phoneManaged = !!currentPhone && (previous.paths.some(path => path.channel === "PHONE" &&
      contactPathKey(path) === channelRouteKey("PHONE", currentPhone)));
    const emailManaged = !!currentEmail && (previous.paths.some(path => path.channel === "EMAIL" &&
      contactPathKey(path) === channelRouteKey("EMAIL", currentEmail)));
    const selectedPhone = readiness.selectedPhonePath;
    const selectedEmail = readiness.selectedEmailPath;
    const nextPhone = transactionLocked ? currentPhone
      : selectedPhone && (!currentPhone || phoneManaged || currentPhone === selectedPhone.routeValue)
        ? selectedPhone.routeValue ?? ""
        : phoneManaged ? "" : currentPhone;
    const nextEmail = transactionLocked ? currentEmail
      : selectedEmail && (!currentEmail || emailManaged || currentEmail === selectedEmail.routeValue)
        ? selectedEmail.routeValue ?? ""
        : emailManaged ? "" : currentEmail;
    const nextPhoneEvidenceId = selectedPhone?.id ??
      (priorUnderwriting?.sellerContactEvidenceId &&
       previous.paths.some(path => path.id === priorUnderwriting?.sellerContactEvidenceId)
        ? undefined
        : priorUnderwriting?.sellerContactEvidenceId);
    const nextUnderwriting = transactionLocked ? row.underwriting : priorUnderwriting
      ? { ...priorUnderwriting, ...(nextPhoneEvidenceId ? { sellerContactEvidenceId: nextPhoneEvidenceId } : {}) }
      : selectedPhone
        ? { version: row.version + 1, comps: [], repairs: [], repairsComplete: false, conditionConfirmed: false, sellerContactEvidenceId: selectedPhone.id }
        : null;
    if (nextUnderwriting && !nextPhoneEvidenceId) delete nextUnderwriting.sellerContactEvidenceId;
    const payload = { ...row.payload, sellerPhone: nextPhone, sellerEmail: nextEmail };
    if (transactionLocked) {
      await audit(tx, actor.id, "SELLER_CONTACT_RESEARCH_DURING_TRANSACTION", id,
        "New contact evidence was recorded without changing executed transaction terms, underwriting, analysis, or next action.");
    } else {
      await audit(tx, actor.id, "SELLER_CONTACT_RESEARCH_RECORDED", id,
        "Contact evidence changed only contact provenance and route fields. Financial underwriting, offer authorization, stage, and next action were preserved; readiness rechecks the route evidence dynamically.");
    }
    const [saved] = await tx.update(leadsTable).set({
      payload: transactionLocked ? row.payload : { ...payload },
      underwriting: nextUnderwriting,
      analysis: row.analysis,
      analysisSnapshotId: row.analysisSnapshotId,
      stage: row.stage,
      nextAction: row.nextAction,
      version: row.version + 1,
      updatedAt: now,
    }).where(eq(leadsTable.id, id)).returning();
    if (!saved) throw new Error("Seller contact observation was not persisted.");
    await audit(tx, actor.id, "SELLER_CONTACT_OBSERVATION_RECORDED", id,
      `${input.channel} contact evidence ${entryId}; ${input.permissionStatus}; ${input.routeVerificationStatus}. No call/message sent. Financial calculations, offer authorization, stage, and next action unchanged. Seller identity and signing authority not established.`);
    await queueJob(tx,"EVALUATE_DECISION",id,`decision:${id}:contact:${entryId}`,actor.id,{trigger:"SELLER_CONTACT_EVIDENCE",evidenceId:entryId});
    return RecordSellerContactObservationResponse.parse(await getSellerContactPaths(id, now, tx));
  });
}
