import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import {
  db, analysesTable, buyersTable, contractsTable, distributionPacketsTable,
  distributionRecipientsTable, offersTable, matchesTable, leadsTable,
} from "@workspace/db";
import {
  type Analysis, type DealContract, type Lead, type OfferActor,
  type UnderwritingInput, DomainError, assertOperationsRole, buyerReservations, matchBuyer, wholeDollars, DAY,
} from "@workspace/deal-domain";
import {
  AuthorizeDealDistributionBody, ShareDistributionRecipientsBody,
  RespondToBuyerPortalDealBody, ReleaseDistributionAcceptanceBody,
  type BuyerPortalEvent, type DistributionPacketSnapshot,
} from "@workspace/api-zod";
import type { z } from "zod";
import { lockedLead, leadDetail, move, audit } from "./deal-store";
import { allBuyerRecords, buyerRecord, contractRecord, type Store, type Tx } from "./operations-records";
import { lockDealEconomics } from "./locked-economics";

type Intent = z.infer<typeof RespondToBuyerPortalDealBody>;
type Packet = typeof distributionPacketsTable.$inferSelect;
type Recipient = typeof distributionRecipientsTable.$inferSelect;
type OriginalSnapshot = { lead: Lead; input: UnderwritingInput; analysis: Analysis };

const packetStatus = (value: string) => ["ACTIVE", "FIRST_ACCEPTED", "CLOSED", "REVOKED"].includes(value);
const recipientStatus = (value: string) => ["INVITED", "INTERESTED", "ACCEPTED", "DECLINED", "COMMITTED", "EXPIRED"].includes(value);
const eventsOf = (row: Recipient): BuyerPortalEvent[] =>
  Array.isArray(row.payload.events) ? row.payload.events as BuyerPortalEvent[] : [];
const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

function validateToken(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError("This buyer link is invalid or no longer active.", 404);
  return hashToken(token);
}

function buildPacket(original: OriginalSnapshot, contract: DealContract, sourceAnalysisSnapshotId: string, now: Date): DistributionPacketSnapshot {
  const analysis = original.analysis;
  const acquisitionPrice = contract.purchasePrice;
  const economics = lockDealEconomics(sourceAnalysisSnapshotId,contract.offerId,analysis,acquisitionPrice);
  if (economics.authorizedAssignmentFee!==contract.assignmentTarget)
    throw new DomainError("Executed assignment fee does not match the original deterministic underwriting snapshot.",409);
  wholeDollars(economics.buyerPrice, "Authorized buyer price");
  const decisions = new Map(analysis.compDecisions.map(decision=>[decision.id,decision]));
  const comparableEvidence = original.input.comps.map(comp=>{
    const decision = decisions.get(comp.id);
    return {
      id:comp.id,included:decision?.included===true,reasons:decision?.reasons??["No saved comp decision."],
      source:comp.source,soldAt:comp.soldAt,verified:comp.verified,
      saleEvidenceId:comp.saleEvidenceId??null,conditionEvidenceId:comp.conditionEvidenceId??null,
    };
  });
  const repairEvidence = analysis.repairEstimate.status==="CALCULATED"
    ? {
      status:"INSPECTION_RATE_CATALOG" as const,
      lines:analysis.repairEstimate.lines.map(line=>({
        category:line.category,low:line.low,expected:line.expected,high:line.high,confidence:line.confidence,
        source:line.source,evidenceId:line.evidenceId,sourceUrl:line.sourceUrl??null,
        rateCardId:line.rateCardId??null,rateCardVersion:line.rateCardVersion??null,
      })),
    }
    : {
      status:"SOURCE_REVIEWED_INPUT" as const,
      lines:original.input.repairs.map(repair=>({
        category:repair.category,low:repair.low,expected:repair.expected,high:repair.high,confidence:repair.confidence,
        source:repair.source,evidenceId:repair.evidenceId??null,sourceUrl:null,rateCardId:null,rateCardVersion:null,
      })),
    };
  const gross = (arv: number, repairs: number) => Math.round((arv - economics.buyerPrice - repairs) * 100) / 100;
  return {
    location: {
      city: original.lead.city,
      county: original.lead.county,
      state: original.lead.state,
      zip: original.lead.zip,
    },
    property: {
      propertyType: original.lead.propertyType,
      sqft: original.lead.sqft,
      beds: original.lead.beds,
      baths: original.lead.baths,
      units: original.lead.units,
      askingPrice: original.lead.askingPrice ?? null,
    },
    economics,
    underwriting: {
      arv: analysis.arv,
      repairs: analysis.repairs,
      grossProfitPotential: {
        low: gross(analysis.arv.low, analysis.repairs.high),
        expected: gross(analysis.arv.expected, analysis.repairs.expected),
        caveat: "Gross spread only: excludes financing, closing, holding, resale, taxes and other costs. Not a profit guarantee.",
      },
      formula: "ARV − buyer price − repairs; estimates are scenario bounds, not a promise of resale value or profit.",
      calculatedAt: analysis.calculatedAt,
    },
    evidence: {
      status:"FROZEN_ANALYSIS_SNAPSHOT",
      sourceAnalysisSnapshotId,
      analysisEngineVersion:analysis.engineVersion,
      calculatedAt:analysis.calculatedAt,
      comparables:comparableEvidence,
      repairs:repairEvidence,
    },
    closeBy: contract.closingAt,
    contingencies: contract.contingencies,
    media: [],
    mediaNotice: "No imported property photos or media were present in the authorized underwriting snapshot.",
    disclosure: `Owner-authorized terms, locked ${now.toISOString()}. This private link grants access to a redacted deal packet; do not forward it. Acceptance is a recorded expression of intent, not an assignment contract or buyer commitment. Commitment requires owner review and externally executed buyer documents.`,
  } as DistributionPacketSnapshot;
}

async function liveContract(tx: Tx, leadId: string) {
  const [row] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId, leadId)).for("update");
  if (!row) throw new DomainError("Prepare and execute the acquisition contract first.", 409);
  return { row, contract: contractRecord(row) };
}

async function buildDistribution(tx: Store, packet: Packet | undefined) {
  if (!packet) return {
    packetId: null, version: 0, status: null, packet: null, authorizedBy: null,
    authorizedAt: null, expiresAt: null, acceptedBuyerId: null, acceptedAt: null, recipients: [],
  };
  const [recipients, buyers] = await Promise.all([
    tx.select().from(distributionRecipientsTable).where(eq(distributionRecipientsTable.packetId, packet.id)),
    tx.select().from(buyersTable),
  ]);
  const byId = new Map(buyers.map((buyer) => [buyer.id, String(buyer.payload.name ?? "Buyer")]));
  return {
    packetId: packet.id,
    version: packet.version,
    status: packet.status === "FIRST_ACCEPTED"
      ? "ACTIVE"
      : packetStatus(packet.status) ? packet.status : "REVOKED",
    packet: packet.snapshot as unknown as DistributionPacketSnapshot,
    authorizedBy: packet.authorizedBy,
    authorizedAt: packet.authorizedAt.toISOString(),
    expiresAt: packet.expiresAt.toISOString(),
    acceptedBuyerId: packet.acceptedBuyerId,
    acceptedAt: packet.acceptedAt?.toISOString() ?? null,
    recipients: recipients.filter((r) => recipientStatus(r.status)).map((r) => ({
      buyerId: r.buyerId,
      buyerName: byId.get(r.buyerId) ?? "Removed buyer",
      status: r.status,
      events: eventsOf(r),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export async function getDealDistribution(leadId: string) {
  const [packet] = await db.select().from(distributionPacketsTable).where(eq(distributionPacketsTable.leadId, leadId))
    .orderBy(desc(distributionPacketsTable.attemptNumber));
  return buildDistribution(db, packet);
}

export async function authorizeDealDistribution(
  leadId: string,
  input: z.infer<typeof AuthorizeDealDistributionBody>,
  actor: OfferActor,
  now = new Date(),
) {
  assertOperationsRole(actor, ["OWNER"]);
  const parsed = AuthorizeDealDistributionBody.parse(input);
  let packetId = "";
  await db.transaction(async (tx) => {
    await lockedLead(tx, leadId);
    const { row: contractRow, contract } = await liveContract(tx, leadId);
    if (contractRow.version !== parsed.version) throw new DomainError("Transaction changed. Reload before authorizing distribution.", 409);
    if (!["UNDER_CONTRACT", "CLOSING"].includes(contract.status) || contract.committedBuyerId) {
      throw new DomainError("Distribution requires an executed, active acquisition contract with no committed buyer.", 409);
    }
    if (!contract.assignmentAllowed) throw new DomainError("The executed contract does not authorize assignment.", 409);
    if (Date.parse(contract.closingAt) <= now.getTime()) throw new DomainError("The acquisition closing deadline has passed.", 409);
    const attemptNumber = contract.attemptNumber ?? 1;
    const [existingPacket] = await tx.select().from(distributionPacketsTable)
      .where(and(eq(distributionPacketsTable.leadId, leadId), eq(distributionPacketsTable.attemptNumber, attemptNumber)));
    if (existingPacket) throw new DomainError("This contract attempt already has a distribution authorization.", 409);

    const detail = await leadDetail(leadId, tx, now);
    const [offerRow] = await tx.select().from(offersTable).where(and(eq(offersTable.id, contract.offerId), eq(offersTable.leadId, leadId)));
    if (!offerRow || offerRow.status !== "COMMUNICATED" || offerRow.payload.assignmentIntent !== true ||
      Number(offerRow.payload.amount) !== contract.purchasePrice) {
      throw new DomainError("Distribution economics must trace to the exact owner-approved, communicated, assignable offer.", 409);
    }
    const [analysisRow] = await tx.select().from(analysesTable)
      .where(and(eq(analysesTable.id, offerRow.analysisSnapshotId), eq(analysesTable.leadId, leadId)));
    if (!analysisRow || detail.analysisSnapshotId !== offerRow.analysisSnapshotId || !detail.analysis ||
      detail.analysis.blockers.length || now.getTime() - Date.parse(detail.analysis.calculatedAt) < 0 ||
      now.getTime() - Date.parse(detail.analysis.calculatedAt) >= 7 * DAY) {
      throw new DomainError("Refresh and verify complete, current underwriting tied to the communicated offer before distribution.", 409);
    }
    const original = analysisRow.snapshot as OriginalSnapshot;
    if (!original?.lead || !original?.analysis || original.analysis.blockers.length ||
      original.analysis.assumptions.assignmentTarget !== contract.assignmentTarget) {
      throw new DomainError("The executed assignment target does not match its immutable underwriting snapshot.", 409);
    }
    const snapshot = buildPacket(original, contract, analysisRow.id, now);
    const [created] = await tx.insert(distributionPacketsTable).values({
      leadId, contractId: contractRow.id, attemptNumber,
      snapshot: snapshot as unknown as Record<string, unknown>,
      authorizedBy: actor.id, authorizedAt: now, expiresAt: new Date(contract.closingAt),
      status: "ACTIVE", createdAt: now, updatedAt: now,
    }).returning();
    if (!created) throw new Error("Distribution authorization could not be saved.");
    packetId = created.id;
    await audit(tx, actor.id, "DISTRIBUTION_AUTHORIZED", leadId,
      `Owner authorized buyer price $${snapshot.economics.buyerPrice} from executed acquisition $${contract.purchasePrice} plus the locked underwriting assignment target $${contract.assignmentTarget}; packet ${created.id}. Street address and seller contact details are excluded.`);
  });
  const [packet] = await db.select().from(distributionPacketsTable).where(eq(distributionPacketsTable.id, packetId));
  return buildDistribution(db, packet);
}

export async function shareDistributionRecipients(
  packetId: string,
  input: z.infer<typeof ShareDistributionRecipientsBody>,
  actor: OfferActor,
  now = new Date(),
) {
  assertOperationsRole(actor, ["OWNER", "OPERATOR"]);
  const parsed = ShareDistributionRecipientsBody.parse(input);
  if (new Set(parsed.buyerIds).size !== parsed.buyerIds.length) throw new DomainError("Choose each buyer only once.");
  const links: { buyerId: string; buyerName: string; token: string }[] = [];
  let leadId = "";
  await db.transaction(async (tx) => {
    const [packetLookup] = await tx.select().from(distributionPacketsTable).where(eq(distributionPacketsTable.id, packetId));
    if (!packetLookup) throw new DomainError("Distribution authorization not found.", 404);
    leadId = packetLookup.leadId;
    await lockedLead(tx, leadId);
    const { row: contractRow, contract } = await liveContract(tx, leadId);
    const [packet] = await tx.select().from(distributionPacketsTable).where(eq(distributionPacketsTable.id, packetId)).for("update");
    if (!packet) throw new DomainError("Distribution authorization not found.", 404);
    if (packet.version !== parsed.version) throw new DomainError("Distribution packet changed. Reload before sharing.", 409);
    if (contractRow.id !== packet.contractId || (contract.attemptNumber ?? 1) !== packet.attemptNumber ||
      !["UNDER_CONTRACT", "CLOSING"].includes(contract.status) || contract.committedBuyerId ||
      !["ACTIVE", "FIRST_ACCEPTED"].includes(packet.status) || packet.expiresAt.getTime() <= now.getTime()) {
      throw new DomainError("This distribution is no longer open for new buyers.", 409);
    }
    const detail = await leadDetail(leadId, tx, now);
    const candidates = await allBuyerRecords(tx, now);
    const contractRows = (await tx.select().from(contractsTable)).map(contractRecord);
    for (const buyerId of parsed.buyerIds) {
      const candidate = candidates.find((buyer) => buyer.id === buyerId);
      if (!candidate) throw new DomainError("One selected buyer no longer exists.", 404);
      if ((candidate.destinationKind ?? "BUYER") !== "BUYER") {
        throw new DomainError("Deal-finder and guru contacts cannot receive acquisition-buyer commitments.", 409);
      }
      const reservations = buyerReservations(contractRows, candidate.id, contract.id);
      const match = matchBuyer(candidate, detail, contract, now, undefined, reservations.count, reservations.funds);
      if (!match.eligible) throw new DomainError(`${candidate.name} is no longer qualified for this deal: ${match.mismatches.join("; ")}`, 409);
      const [existing] = await tx.select().from(distributionRecipientsTable)
        .where(and(eq(distributionRecipientsTable.packetId, packet.id), eq(distributionRecipientsTable.buyerId, buyerId))).for("update");
      if (existing && existing.status !== "INVITED") {
        throw new DomainError(`${candidate.name} already responded to this opportunity; a new link cannot erase that response.`, 409);
      }
      const token = randomBytes(32).toString("base64url");
      const linkHistory = Array.isArray(existing?.payload.linkHistory) ? existing.payload.linkHistory : [];
      const nextPayload = {
        ...(existing?.payload ?? {}),
        events: Array.isArray(existing?.payload.events) ? existing.payload.events : [],
        linkHistory: [...linkHistory, { kind: existing ? "LINK_ROTATED" : "LINK_CREATED", actor: actor.id, recordedAt: now.toISOString() }],
      };
      if (existing) {
        await tx.update(distributionRecipientsTable).set({
          tokenHash: hashToken(token), payload: nextPayload, updatedAt: now,
        }).where(eq(distributionRecipientsTable.id, existing.id));
      } else {
        await tx.insert(distributionRecipientsTable).values({
          packetId: packet.id, buyerId, tokenHash: hashToken(token), status: "INVITED",
          payload: nextPayload, createdAt: now, updatedAt: now,
        });
      }
      links.push({ buyerId, buyerName: candidate.name, token });
    }
    await tx.update(distributionPacketsTable).set({ version: packet.version + 1, updatedAt: now }).where(eq(distributionPacketsTable.id, packet.id));
    await audit(tx, actor.id, "DISTRIBUTION_LINKS_CREATED", leadId,
      `Created or rotated ${links.length} private capability link(s) for currently qualified acquisition buyers. No email or message was sent by the system.`);
  });
  const distribution = await getDealDistribution(leadId);
  return { distribution, links };
}

async function loadPortalRecord(tx: Store, tokenHash: string, now: Date) {
  const [recipient] = await tx.select().from(distributionRecipientsTable).where(eq(distributionRecipientsTable.tokenHash, tokenHash));
  if (!recipient || recipient.status === "REVOKED") throw new DomainError("This buyer link is invalid or no longer active.", 404);
  const [packet] = await tx.select().from(distributionPacketsTable).where(eq(distributionPacketsTable.id, recipient.packetId));
  if (!packet || !packetStatus(packet.status) || packet.status === "REVOKED" || packet.status === "CLOSED" ||
    packet.expiresAt.getTime() <= now.getTime()) throw new DomainError("This opportunity is no longer available.", 410);
  const [contractRow] = await tx.select().from(contractsTable).where(eq(contractsTable.id, packet.contractId));
  if (!contractRow) throw new DomainError("This opportunity is no longer available.", 410);
  const contract = contractRecord(contractRow);
  if (contract.status === "CLOSED" || contract.status === "CANCELLED" || contract.committedBuyerId) {
    throw new DomainError("This opportunity is no longer available.", 410);
  }
  const [buyerRow] = await tx.select().from(buyersTable).where(eq(buyersTable.id, recipient.buyerId));
  if (!buyerRow) throw new DomainError("This buyer link is invalid or no longer active.", 404);
  const buyer = buyerRecord(buyerRow, now);
  const detail = await leadDetail(packet.leadId, tx, now);
  const contracts = (await tx.select().from(contractsTable)).map(contractRecord);
  const reservations = buyerReservations(contracts, buyer.id, contract.id);
  const match = matchBuyer(buyer, detail, contract, now, undefined, reservations.count, reservations.funds);
  const events = eventsOf(recipient);
  const alreadyAccepted = recipient.status === "ACCEPTED";
  const canAccept = match.eligible && !alreadyAccepted && ["ACTIVE", "FIRST_ACCEPTED"].includes(packet.status);
  const unavailableReason = alreadyAccepted
    ? "Your acceptance is recorded as non-binding intent. Other qualified buyers may still respond; only an owner-reviewed valid commitment closes distribution."
    : !match.eligible
      ? "Your current reviewed buyer qualification no longer meets this opportunity's requirements."
      : !["ACTIVE", "FIRST_ACCEPTED"].includes(packet.status)
        ? "This opportunity is no longer accepting responses."
        : null;
  return {
    packet: packet.snapshot as unknown as DistributionPacketSnapshot,
    recipientStatus: recipient.status,
    canAccept,
    unavailableReason,
    events,
  };
}

export async function getBuyerPortalDeal(token: string | undefined, now = new Date()) {
  return loadPortalRecord(db, validateToken(token), now);
}

export async function respondToBuyerPortalDeal(
  token: string | undefined,
  input: Intent,
  now = new Date(),
) {
  const parsed = RespondToBuyerPortalDealBody.parse(input);
  const tokenHash = validateToken(token);
  let response: Awaited<ReturnType<typeof loadPortalRecord>> | undefined;
  await db.transaction(async (tx) => {
    const [recipientLookup] = await tx.select().from(distributionRecipientsTable).where(eq(distributionRecipientsTable.tokenHash, tokenHash));
    if (!recipientLookup) throw new DomainError("This buyer link is invalid or no longer active.", 404);
    const [packetLookup] = await tx.select().from(distributionPacketsTable).where(eq(distributionPacketsTable.id, recipientLookup.packetId));
    if (!packetLookup) throw new DomainError("This opportunity is no longer available.", 410);
    const lead = await lockedLead(tx, packetLookup.leadId);
    await liveContract(tx, packetLookup.leadId);
    const [packet] = await tx.select().from(distributionPacketsTable).where(eq(distributionPacketsTable.id, packetLookup.id)).for("update");
    const [recipient] = await tx.select().from(distributionRecipientsTable).where(eq(distributionRecipientsTable.id, recipientLookup.id)).for("update");
    if (!packet || !recipient || packet.expiresAt.getTime() <= now.getTime() || packet.status === "REVOKED" || packet.status === "CLOSED") {
      throw new DomainError("This opportunity is no longer available.", 410);
    }
    const previous = eventsOf(recipient);
    const duplicate = previous.find((event) => event.eventKey === parsed.eventKey);
    if (duplicate) {
      if (!isDeepStrictEqual(duplicate, {
        eventKey: parsed.eventKey, action: parsed.action, recordedAt: duplicate.recordedAt, note: parsed.note ?? "",
      })) throw new DomainError("This event key was already used for a different response.", 409);
      response = await loadPortalRecord(tx, tokenHash, now);
      return;
    }
    const [contractRow] = await tx.select().from(contractsTable).where(eq(contractsTable.id, packet.contractId));
    const [buyerRow] = await tx.select().from(buyersTable).where(eq(buyersTable.id, recipient.buyerId)).for("update");
    if (!contractRow || !buyerRow) throw new DomainError("This opportunity is no longer available.", 410);
    const contract = contractRecord(contractRow);
    if (contract.status === "CLOSED" || contract.status === "CANCELLED" || contract.committedBuyerId) {
      throw new DomainError("This opportunity is no longer available.", 410);
    }
    let currentMatch: ReturnType<typeof matchBuyer> | undefined;
    if (parsed.action !== "DECLINED") {
      const buyer = buyerRecord(buyerRow, now);
      const detail = await leadDetail(packet.leadId, tx, now);
      const contracts = (await tx.select().from(contractsTable)).map(contractRecord);
      const reservations = buyerReservations(contracts, buyer.id, contract.id);
      currentMatch = matchBuyer(buyer, detail, contract, now, undefined, reservations.count, reservations.funds);
      if (!currentMatch.eligible) throw new DomainError(`Your current buyer qualification is no longer eligible: ${currentMatch.mismatches.join("; ")}`, 409);
    }
    const event: BuyerPortalEvent = {
      eventKey: parsed.eventKey,
      action: parsed.action,
      recordedAt: now.toISOString(),
      note: parsed.note ?? "",
    };
    const status = parsed.action;
    await tx.update(distributionRecipientsTable).set({
      status,
      payload: { ...recipient.payload, events: [...previous, event] },
      updatedAt: now,
    }).where(eq(distributionRecipientsTable.id, recipient.id));
    const currentRecipients = await tx.select().from(distributionRecipientsTable)
      .where(eq(distributionRecipientsTable.packetId, packet.id));
    const activeAcceptances = currentRecipients
      .filter((candidate) => candidate.status === "ACCEPTED")
      .map((candidate) => {
        const acceptedEvent = [...eventsOf(candidate)].reverse().find((item) => item.action === "ACCEPTED");
        return {
          buyerId: candidate.buyerId,
          acceptedAt: acceptedEvent?.recordedAt ?? candidate.updatedAt.toISOString(),
        };
      })
      .sort((a, b) => Date.parse(a.acceptedAt) - Date.parse(b.acceptedAt) || a.buyerId.localeCompare(b.buyerId));
    const earliestActiveAcceptance = activeAcceptances.find((item) => item.buyerId === packet.acceptedBuyerId) ??
      activeAcceptances[0];
    await tx.update(distributionPacketsTable).set({
      status: "ACTIVE",
      acceptedBuyerId: earliestActiveAcceptance?.buyerId ?? null,
      acceptedAt: earliestActiveAcceptance ? new Date(earliestActiveAcceptance.acceptedAt) : null,
      version: packet.version + 1,
      updatedAt: now,
    }).where(eq(distributionPacketsTable.id, packet.id));
    if (parsed.action === "INTERESTED" || parsed.action === "ACCEPTED") {
      if (!currentMatch) throw new Error("Qualified portal response has no current buyer match.");
      const evidence = `Private buyer portal ${parsed.action.toLowerCase()} at ${now.toISOString()} (event ${parsed.eventKey})${parsed.note ? `: ${parsed.note}` : ""}. Acceptance is intent only; signed commitment review remains required.`;
      await tx.insert(matchesTable).values({
        leadId:packet.leadId,buyerId:recipient.buyerId,
        payload:{...currentMatch,status:"INTERESTED",evidence,agreedPrice:null,commitmentEvidenceUrl:null,
          responseSource:"PRIVATE_BUYER_PORTAL",portalAcceptanceAt:parsed.action==="ACCEPTED"?now.toISOString():null},
        updatedAt:now,
      }).onConflictDoUpdate({target:[matchesTable.leadId,matchesTable.buyerId],set:{
        payload:{...currentMatch,status:"INTERESTED",evidence,agreedPrice:null,commitmentEvidenceUrl:null,
          responseSource:"PRIVATE_BUYER_PORTAL",portalAcceptanceAt:parsed.action==="ACCEPTED"?now.toISOString():null},
        updatedAt:now,
      }});
      if (["UNDER_CONTRACT","BUYER_MATCHED"].includes(lead.stage)) {
        await move(tx,lead,"BUYER_INTERESTED","Qualified buyer responded through the private deal portal","Review signed commitment evidence and exact buyer terms; portal interest is not a commitment.",`PORTAL_BUYER:${recipient.buyerId}`,now);
        await tx.update(leadsTable).set({stage:lead.stage,nextAction:lead.nextAction,version:lead.version+1,updatedAt:now}).where(eq(leadsTable.id,lead.id));
      }
    } else if (parsed.action === "DECLINED") {
      const [existingMatch] = await tx.select().from(matchesTable)
        .where(and(eq(matchesTable.leadId,packet.leadId),eq(matchesTable.buyerId,recipient.buyerId))).for("update");
      if (existingMatch && existingMatch.payload.status !== "COMMITTED") {
        await tx.update(matchesTable).set({payload:{
          ...existingMatch.payload,status:"DECLINED",eligible:false,
          mismatches:[...(Array.isArray(existingMatch.payload.mismatches)?existingMatch.payload.mismatches as string[]:[]),"Buyer declined this authorized deal package."],
          evidence:`Private buyer portal decline at ${now.toISOString()} (event ${parsed.eventKey})${parsed.note?`: ${parsed.note}`:""}.`,
        },updatedAt:now}).where(eq(matchesTable.id,existingMatch.id));
      }
    }
    const [currentContractVersion] = await tx.select({version:contractsTable.version})
      .from(contractsTable).where(eq(contractsTable.id,contract.id));
    if (currentContractVersion) {
      await tx.update(contractsTable).set({version:currentContractVersion.version+1,updatedAt:now})
        .where(eq(contractsTable.id,contract.id));
    }
    await audit(tx, `PORTAL_BUYER:${recipient.buyerId}`, `PORTAL_BUYER_${parsed.action}`, packet.leadId,
      `Capability-link response ${parsed.action} for buyer ${recipient.buyerId}; event ${parsed.eventKey}. This records intent only and does not create a buyer commitment.`);
    response = await loadPortalRecord(tx, tokenHash, now);
  });
  if (!response) throw new Error("Buyer response did not produce a portal view.");
  return response;
}

export async function releaseDistributionAcceptance(
  leadId: string,
  input: z.infer<typeof ReleaseDistributionAcceptanceBody>,
  actor: OfferActor,
  now = new Date(),
) {
  assertOperationsRole(actor, ["OWNER"]);
  const parsed = ReleaseDistributionAcceptanceBody.parse(input);
  await db.transaction(async (tx) => {
    await lockedLead(tx, leadId);
    const { contract } = await liveContract(tx, leadId);
    if (contract.committedBuyerId) throw new DomainError("A committed buyer can only be released through the evidenced transaction exception workflow.", 409);
    const [packet] = await tx.select().from(distributionPacketsTable)
      .where(and(eq(distributionPacketsTable.leadId, leadId), eq(distributionPacketsTable.attemptNumber, contract.attemptNumber ?? 1))).for("update");
    if (!packet) throw new DomainError("Distribution packet not found.", 404);
    if (packet.version !== parsed.version || !["ACTIVE", "FIRST_ACCEPTED"].includes(packet.status) || !packet.acceptedBuyerId) {
      throw new DomainError("The informational earliest-response marker changed or is no longer present.", 409);
    }
    await tx.update(distributionPacketsTable).set({
      status: "ACTIVE", acceptedBuyerId: null, acceptedAt: null,
      version: packet.version + 1, updatedAt: now,
    }).where(eq(distributionPacketsTable.id, packet.id));
    await audit(tx, actor.id, "DISTRIBUTION_ACCEPTANCE_RELEASED", leadId,
      `Owner cleared the informational earliest-acceptance marker for buyer ${packet.acceptedBuyerId}: ${parsed.reason}. All qualified buyers remain eligible to respond; no buyer commitment was created or erased.`);
  });
  return getDealDistribution(leadId);
}
