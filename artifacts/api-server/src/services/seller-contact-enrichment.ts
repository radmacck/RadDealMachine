import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, lte, or } from "drizzle-orm";
import {
  db, leadsTable, sellerContactEnrichmentRequestsTable, type SellerContactEnrichmentRequestRow,
} from "@workspace/db";
import {
  assertOperationsRole, DomainError, type OfferActor,
} from "@workspace/deal-domain";
import {
  ContactProviderError, sellerContactEnrichmentRegistry, validateContactEnrichmentObservation,
  type ContactEnrichmentChannel, type ContactEnrichmentObservation, type ContactEnrichmentRegistryStatus,
  type ContactProviderState, type SellerContactEnrichmentProvider,
} from "@workspace/property-sources";
import { audit } from "./deal-store";
import { recordSellerContactObservation } from "./seller-contact-store";

type ProviderOutcome = { status: string; reason: string; observationsAdded: number };
type ProviderAttempt = { attempt: number; providerId: string; state: "SUBMITTED"|"CONFIRMED"|"FAILED"|"UNKNOWN"|"RATE_LIMITED"; at: string; responseCode?: string|null };
type IngestResult = {
  added: boolean;
  stale: boolean;
  staleEvidence: boolean;
  blocked: boolean;
  version: number;
};
const MAX_ATTEMPTS = 3;
const LEASE_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
const iso = (date: Date) => date.toISOString();
const asProviderOutcomes = (value: unknown): Record<string, ProviderOutcome> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, ProviderOutcome>
    : {};
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function responseRecord(row: SellerContactEnrichmentRequestRow) {
  const outcomes = asProviderOutcomes(row.providerOutcomes);
  const operation = outcomes.__externalOperation as {authorizationSnapshot?: unknown;attemptHistory?: ProviderAttempt[]}|undefined;
  const operationState = row.status === "UNAVAILABLE" && row.providerIds.length === 0 ? "NOT_CONFIGURED"
    : row.status === "BLOCKED_BY_PROVIDER_READINESS" ? "AWAITING_APPROVAL"
      : row.status === "QUEUED" ? "QUEUED"
        : row.status === "RUNNING" ? "SUBMITTED"
          : row.status === "RETRY_WAIT" ? "UNKNOWN"
            : ["SUCCEEDED", "NO_RESULT", "STALE_RESULT"].includes(row.status) ? "CONFIRMED" : "FAILED";
  return {
    id: row.id,
    leadId: row.leadId,
    idempotencyKey: row.idempotencyKey,
    channels: row.channels,
    status: row.status,
    operationState,
    requestedLeadVersion: row.requestedLeadVersion,
    providerIds: row.providerIds,
    providerResults: row.providerIds.map(providerId => ({
      providerId,
      status: outcomes[providerId]?.status ?? row.status,
      reason: outcomes[providerId]?.reason ?? "Waiting for a permitted provider to run.",
      observationsAdded: outcomes[providerId]?.observationsAdded ?? 0,
    })),
    authorizationSnapshot: operation?.authorizationSnapshot ?? {
      actorId: row.requestedBy, role: "UNKNOWN", leadVersion: row.requestedLeadVersion,
      channels: row.channels, providerIds: row.providerIds, capturedAt: iso(row.createdAt),
    },
    attemptHistory: operation?.attemptHistory ?? [],
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: row.nextAttemptAt ? iso(row.nextAttemptAt) : null,
    resultCount: row.resultCount,
    reason: row.reason,
    lastFailureCode: row.lastFailureCode,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function requestDisposition(registry: ContactEnrichmentRegistryStatus, channels: ContactEnrichmentChannel[]) {
  const states = registry.providers.map(provider => provider.state);
  if (states.includes("BLOCKED_BY_POLICY")) {
    return { status: "BLOCKED_BY_POLICY", reason: "No runnable provider is available; a registered provider is blocked by policy." };
  }
  if (states.includes("BLOCKED_BY_TERMS")) {
    return { status: "BLOCKED_BY_TERMS", reason: "No runnable provider is available; a registered provider is blocked by source terms." };
  }
  if (states.includes("CONFIGURED_BUT_UNEXERCISED")) {
    return { status: "BLOCKED_BY_PROVIDER_READINESS", reason: "A provider is configured but has not completed a permitted exercise; no lookup was attempted." };
  }
  if (states.includes("AVAILABLE_AND_EXERCISED")) {
    const supported = registry.providers
      .filter(provider => provider.state === "AVAILABLE_AND_EXERCISED")
      .flatMap(provider => provider.channels);
    const unsupported = channels.filter(channel => !supported.includes(channel));
    return {
      status: "UNAVAILABLE",
      reason: `No available provider supports the requested route types: ${unsupported.join(", ") || channels.join(", ")}.`,
    };
  }
  return { status: "UNAVAILABLE", reason: registry.reason };
}

export async function getSellerContactEnrichment(
  leadId: string,
  now = new Date(),
  registryStatus = sellerContactEnrichmentRegistry.status(),
) {
  const [lead] = await db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.id, leadId));
  if (!lead) throw new DomainError("Property lead not found.", 404);
  const rows = await db.select().from(sellerContactEnrichmentRequestsTable)
    .where(eq(sellerContactEnrichmentRequestsTable.leadId, leadId))
    .orderBy(asc(sellerContactEnrichmentRequestsTable.createdAt))
    .limit(20);
  return {
    leadId,
    registry: registryStatus,
    requests: rows.reverse().map(responseRecord),
    checkedAt: iso(now),
  };
}

export async function requestSellerContactEnrichment(
  leadId: string,
  input: { idempotencyKey: string; channels: ContactEnrichmentChannel[] },
  actor: OfferActor,
  now = new Date(),
  providers = sellerContactEnrichmentRegistry,
) {
  assertOperationsRole(actor, ["OWNER", "ANALYST"]);
  const channels = [...new Set(input.channels)].sort() as ContactEnrichmentChannel[];
  if (!input.idempotencyKey.trim() || channels.length !== input.channels.length || !channels.length) {
    throw new DomainError("Contact enrichment requires an idempotency key and unique requested route types.", 400);
  }
  const key = fingerprint(`${actor.id}\n${leadId}\n${input.idempotencyKey}`);
  const requestFingerprint = fingerprint({ actor: actor.id, leadId, channels });
  const registry = providers.status();
  const executable = providers.executableProviders().filter(provider =>
    channels.some(channel => provider.capability.channels.includes(channel)));
  const disposition = executable.length ? null : requestDisposition(registry, channels);

  const row = await db.transaction(async tx => {
    const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id, leadId)).for("update");
    if (!lead) throw new DomainError("Property lead not found.", 404);
    const [prior] = await tx.select().from(sellerContactEnrichmentRequestsTable)
      .where(eq(sellerContactEnrichmentRequestsTable.idempotencyKey, key)).limit(1);
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) {
        throw new DomainError("This idempotency key was already used for a different contact-enrichment request.", 409);
      }
      return prior;
    }
    const providerIds = executable.map(provider => provider.capability.providerId);
    const providerOutcomes: Record<string, ProviderOutcome> = Object.fromEntries(providerIds.map(providerId => [
      providerId,
      { status: "QUEUED", reason: "Waiting for a permitted source lookup.", observationsAdded: 0 },
    ]));
    (providerOutcomes as Record<string, unknown>).__externalOperation = {
      authorizationSnapshot: {
        actorId: actor.id, role: actor.role, leadVersion: lead.version, channels,
        providerIds, capturedAt: now.toISOString(),
      },
      attemptHistory: [],
    };
    const status = disposition?.status ?? "QUEUED";
    const reason = disposition?.reason ?? "Queued for permitted source lookups. No calls, messages, or emails are sent.";
    const [created] = await tx.insert(sellerContactEnrichmentRequestsTable).values({
      id: randomUUID(),
      leadId,
      requestedBy: actor.id,
      idempotencyKey: key,
      requestFingerprint,
      channels,
      status,
      requestedLeadVersion: lead.version,
      expectedLeadVersion: lead.version,
      providerIds,
      providerOutcomes,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      nextAttemptAt: null,
      leaseUntil: null,
      resultCount: 0,
      reason,
      lastFailureCode: null,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!created) throw new DomainError("Contact enrichment request was not persisted.", 500);
    await audit(tx, actor.id, "SELLER_CONTACT_ENRICHMENT_REQUESTED", leadId,
      `Request ${created.id} recorded with state ${status}. ${reason}`);
    return created;
  });
  return getSellerContactEnrichment(leadId, now, registry);
}

function retryDelayMs(attempt: number, retryAfterMs?: number) {
  const exponential = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
  return Math.min(MAX_BACKOFF_MS, Math.max(exponential, Math.max(0, retryAfterMs ?? 0)));
}

async function callProvider(
  provider: SellerContactEnrichmentProvider,
  context: Parameters<SellerContactEnrichmentProvider["enrich"]>[0],
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("PROVIDER_TIMEOUT"));
    }, 45_000);
    timer.unref?.();
  });
  try {
    return await Promise.race([provider.enrich(context, controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function updateRequest(
  row: SellerContactEnrichmentRequestRow,
  patch: Partial<typeof sellerContactEnrichmentRequestsTable.$inferInsert>,
  action: string,
  detail: string,
  now: Date,
) {
  return db.transaction(async tx => {
    const [updated] = await tx.update(sellerContactEnrichmentRequestsTable)
      .set({ ...patch, updatedAt: now })
      .where(eq(sellerContactEnrichmentRequestsTable.id, row.id))
      .returning();
    if (updated) {
      await audit(tx, `system:seller-contact-enrichment`, action, row.leadId,
        `Request ${row.id}: ${detail}`);
    }
    return updated ?? row;
  });
}

async function leadVersion(leadId: string) {
  const [lead] = await db.select({ version: leadsTable.version }).from(leadsTable)
    .where(eq(leadsTable.id, leadId));
  if (!lead) throw new DomainError("Property lead no longer exists.", 404);
  return lead.version;
}

function sourceType(observation: ContactEnrichmentObservation): "PUBLIC_RECORD" | "PUBLIC_PAGE" | "PERMITTED_LISTING" {
  return observation.source.type;
}

async function ingestObservation(
  row: SellerContactEnrichmentRequestRow,
  observation: ContactEnrichmentObservation,
  actor: OfferActor,
  expectedVersion: number,
  now: Date,
): Promise<IngestResult> {
  validateContactEnrichmentObservation(observation, now);
  if (observation.permission.assessment === "BLOCKED") {
    return { added: false, stale: false, staleEvidence: false, blocked: true, version: expectedVersion };
  }
  if (!row.channels.includes(observation.channel)) {
    throw new ContactProviderError("INVALID_RESPONSE", false);
  }
  const currentVersion = await leadVersion(row.leadId);
  if (currentVersion !== expectedVersion) {
    return { added: false, stale: true, staleEvidence: false, blocked: false, version: currentVersion };
  }
  const result = await recordSellerContactObservation(row.leadId, {
    version: expectedVersion,
    channel: observation.channel,
    routeValue: observation.routeValue,
    recipient: observation.recipient,
    recipientRole: observation.recipientRole,
    classification: "OBSERVED",
    confidence: observation.confidence,
    sourceType: sourceType(observation),
    sourceId: observation.source.id,
    sourceName: observation.source.name,
    sourceRecordId: observation.source.recordId,
    sourceUrl: observation.source.url,
    capturedAt: observation.observedAt,
    freshUntilAt: observation.freshUntilAt,
    permissionStatus: "NOT_REVIEWED",
    routeVerificationStatus: "UNREVIEWED",
  }, actor, now, {
    providerId: actor.id.replace("system:contact-provider:", ""),
    permissionEvidenceStatus: observation.permission.assessment,
    legalBasis: observation.permission.legalBasis,
    legalBasisScope: observation.permission.scope,
    legalBasisEvidenceUrl: observation.permission.evidenceUrl,
    epistemicStatus: observation.epistemicStatus,
    recipientIdentityEvidenceStatus: observation.identityEvidence.status,
    recipientIdentityEvidenceRef: observation.identityEvidence.reference,
  });
  return {
    added: result.leadVersion > currentVersion,
    stale: false,
    staleEvidence: Date.parse(observation.freshUntilAt) <= now.getTime(),
    blocked: false,
    version: result.leadVersion,
  };
}

export async function runSellerContactEnrichmentOnce(
  now = new Date(),
  providers = sellerContactEnrichmentRegistry,
) {
  const row = await db.transaction(async tx => {
    const due = or(
      eq(sellerContactEnrichmentRequestsTable.status, "QUEUED"),
      and(
        eq(sellerContactEnrichmentRequestsTable.status, "RETRY_WAIT"),
        lte(sellerContactEnrichmentRequestsTable.nextAttemptAt, now),
      ),
      and(
        eq(sellerContactEnrichmentRequestsTable.status, "RUNNING"),
        lte(sellerContactEnrichmentRequestsTable.leaseUntil, now),
      ),
    );
    const [waiting] = await tx.select().from(sellerContactEnrichmentRequestsTable)
      .where(due).orderBy(asc(sellerContactEnrichmentRequestsTable.createdAt))
      .limit(1).for("update", { skipLocked: true });
    if (!waiting) return null;
    const [claimed] = await tx.update(sellerContactEnrichmentRequestsTable).set({
      status: "RUNNING",
      attempts: waiting.attempts + 1,
      nextAttemptAt: null,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      updatedAt: now,
    }).where(eq(sellerContactEnrichmentRequestsTable.id, waiting.id)).returning();
    if (claimed) {
      await audit(tx, "system:seller-contact-enrichment", "SELLER_CONTACT_ENRICHMENT_STARTED", waiting.leadId,
        `Request ${waiting.id} attempt ${claimed.attempts} claimed.`);
    }
    return claimed ?? null;
  });
  if (!row) return null;

  const registry = providers.status();
  const providerById = new Map(providers.providers.map(provider => [provider.capability.providerId, provider]));
  const providerOutcomes = asProviderOutcomes(row.providerOutcomes);
  const operationAudit = (providerOutcomes.__externalOperation ?? {
    authorizationSnapshot: {
      actorId: row.requestedBy, role: "UNKNOWN", leadVersion: row.requestedLeadVersion,
      channels: row.channels, providerIds: row.providerIds, capturedAt: iso(row.createdAt),
    },
    attemptHistory: [],
  }) as unknown as {
    authorizationSnapshot: unknown;
    attemptHistory: ProviderAttempt[];
  };
  providerOutcomes.__externalOperation = operationAudit as unknown as ProviderOutcome;
  const missingProviders = row.providerIds.filter(id => !providerById.has(id));
  if (missingProviders.length) {
    return updateRequest(row, {
      status: "UNAVAILABLE",
      providerOutcomes,
      leaseUntil: null,
      reason: "A provider recorded on this request is no longer configured. No lookup was claimed for the missing provider.",
      lastFailureCode: "PROVIDER_REMOVED",
    }, "SELLER_CONTACT_ENRICHMENT_UNAVAILABLE", "A previously configured provider is no longer present.", now);
  }
  if (!row.providerIds.length) {
    const disposition = requestDisposition(registry, row.channels as ContactEnrichmentChannel[]);
    return updateRequest(row, {
      status: disposition.status,
      leaseUntil: null,
      reason: disposition.reason,
    }, "SELLER_CONTACT_ENRICHMENT_BLOCKED", disposition.reason, now);
  }
  let expectedLeadVersion = row.expectedLeadVersion;
  if (await leadVersion(row.leadId) !== expectedLeadVersion) {
    return updateRequest(row, {
      status: "STALE_RESULT",
      leaseUntil: null,
      reason: "The property record changed after this request was captured. No provider result was attached; refresh the contact request.",
      lastFailureCode: "LEAD_VERSION_CHANGED",
    }, "SELLER_CONTACT_ENRICHMENT_STALE", "Lead version changed before provider execution.", now);
  }

  let processed = 0;
  let added = 0;
  let stale = false;
  let staleEvidenceCount = 0;
  let blocked = false;
  let retryableError: ContactProviderError | null = null;
  for (const providerId of row.providerIds) {
    const prior = providerOutcomes[providerId];
    if (prior && ["SUCCEEDED", "NO_RESULT", "BLOCKED_BY_POLICY", "BLOCKED_BY_TERMS"].includes(prior.status)) continue;
    const provider = providerById.get(providerId)!;
    if (provider.capability.state === "BLOCKED_BY_POLICY" || provider.capability.state === "BLOCKED_BY_TERMS") {
      const status = provider.capability.state;
      providerOutcomes[providerId] = { status, reason: provider.capability.reason, observationsAdded: 0 };
      blocked = true;
      continue;
    }
    if (provider.capability.state !== "AVAILABLE_AND_EXERCISED") {
      providerOutcomes[providerId] = {
        status: "BLOCKED_BY_PROVIDER_READINESS",
        reason: "Provider has not completed a permitted exercise; no lookup was attempted.",
        observationsAdded: 0,
      };
      blocked = true;
      continue;
    }
    if (await leadVersion(row.leadId) !== expectedLeadVersion) {
      stale = true;
      providerOutcomes[providerId] = {
        status: "STALE_RESULT",
        reason: "Property evidence changed while this request was running; provider output was not attached.",
        observationsAdded: 0,
      };
      break;
    }
    operationAudit.attemptHistory.push({
      attempt: row.attempts, providerId, state: "SUBMITTED", at: now.toISOString(),
    });
    await updateRequest(row, { providerOutcomes }, "EXTERNAL_PROVIDER_SUBMITTED",
      `Provider ${providerId} submitted under durable request ${row.id}, attempt ${row.attempts}.`, now);
    try {
      const providerChannels = (row.channels as ContactEnrichmentChannel[])
        .filter(channel => provider.capability.channels.includes(channel));
      const result = await callProvider(provider, {
        leadId: row.leadId,
        leadVersion: expectedLeadVersion,
        idempotencyKey: row.idempotencyKey,
        requestedAt: iso(row.createdAt),
        channels: providerChannels,
      });
      processed++;
      if (result.outcome === "BLOCKED_BY_POLICY") {
        providerOutcomes[providerId] = {
          status: "BLOCKED_BY_POLICY",
          reason: "Provider policy or terms blocked this lookup; no contact data was collected.",
          observationsAdded: 0,
        };
        operationAudit.attemptHistory.push({attempt:row.attempts,providerId,state:"CONFIRMED",at:now.toISOString(),responseCode:result.outcome});
        blocked = true;
        continue;
      }
      if (result.outcome === "NO_RESULT") {
        providerOutcomes[providerId] = {
          status: "NO_RESULT",
          reason: "Provider returned no contact observations.",
          observationsAdded: 0,
        };
        operationAudit.attemptHistory.push({attempt:row.attempts,providerId,state:"CONFIRMED",at:now.toISOString(),responseCode:result.outcome});
        continue;
      }
      if (!result.observations.length) throw new ContactProviderError("INVALID_RESPONSE", false);
      for (const observation of result.observations) {
        if (observation.source.id !== providerId || !providerChannels.includes(observation.channel)) {
          throw new ContactProviderError("INVALID_RESPONSE", false);
        }
        validateContactEnrichmentObservation(observation, now);
      }
      let providerAdded = 0;
      let providerStale = false;
      let providerBlocked = false;
      let providerStaleEvidence = 0;
      for (const observation of result.observations) {
        const ingested = await ingestObservation(row, observation, {
          id: `system:contact-provider:${providerId}`,
          role: "ANALYST",
        }, expectedLeadVersion, now);
        if (ingested.stale) {
          providerStale = true;
          stale = true;
          break;
        }
        if (ingested.staleEvidence) {
          staleEvidenceCount++;
          providerStaleEvidence++;
        }
        if (ingested.blocked) {
          blocked = true;
          providerBlocked = true;
          continue;
        }
        expectedLeadVersion = ingested.version;
        if (ingested.added) {
          providerAdded++;
          added++;
        }
      }
      const providerOnlyStale = providerAdded > 0 && providerAdded === providerStaleEvidence;
      providerOutcomes[providerId] = {
        status: providerStale || providerOnlyStale ? "STALE_RESULT"
          : providerAdded === 0 && providerBlocked ? "BLOCKED_BY_POLICY"
            : "SUCCEEDED",
        reason: providerStale
          ? "Property evidence changed before the observation could be attached."
          : providerOnlyStale
            ? "Only expired observations were retained. They remain blocked and cannot be selected as a current route."
          : providerAdded === 0 && providerBlocked
            ? "Provider returned contact data that its own permission evidence marks blocked; no route was stored."
            : `${providerAdded} new route observation${providerAdded === 1 ? "" : "s"} persisted through the existing owner-review pipeline.`,
        observationsAdded: providerAdded,
      };
      if (providerStale) break;
      operationAudit.attemptHistory.push({attempt:row.attempts,providerId,state:"CONFIRMED",at:now.toISOString(),responseCode:providerOutcomes[providerId]?.status});
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "PROVIDER_TIMEOUT";
      const safeError = timedOut
        ? new ContactProviderError("TEMPORARY_FAILURE", true)
        : error instanceof ContactProviderError
        ? error
        : new ContactProviderError("TEMPORARY_FAILURE", false);
      providerOutcomes[providerId] = {
        status: safeError.retryable ? "RETRY_WAIT" : "FAILED",
        reason: safeError.retryable
          ? "Provider reported a retryable failure; no unconfirmed contact route was added."
          : "Provider result failed validation or execution; details withheld and no route was added.",
        observationsAdded: 0,
      };
      operationAudit.attemptHistory.push({
        attempt:row.attempts,providerId,state:timedOut?"UNKNOWN":safeError.code==="RATE_LIMITED"?"RATE_LIMITED":safeError.retryable?"UNKNOWN":"FAILED",
        at:now.toISOString(),responseCode:safeError.code,
      });
      if (safeError.retryable) retryableError = safeError;
    }
    await updateRequest(row, { providerOutcomes }, "EXTERNAL_PROVIDER_RESPONSE",
      `Provider ${providerId} response is retained without raw contact data.`, now);
  }

  const externalOutcomes = Object.entries(providerOutcomes)
    .filter(([providerId]) => providerId !== "__externalOperation")
    .map(([, outcome]) => outcome);
  const retryNeeded = externalOutcomes.some(result => result.status === "RETRY_WAIT");
  if (retryNeeded && row.attempts < row.maxAttempts) {
    const retryAt = new Date(now.getTime() + retryDelayMs(row.attempts, retryableError?.retryAfterMs));
    return updateRequest(row, {
      status: "RETRY_WAIT",
      providerOutcomes,
      expectedLeadVersion,
      resultCount: row.resultCount + added,
      nextAttemptAt: retryAt,
      leaseUntil: null,
      reason: `A provider failed transiently. Retry scheduled for ${iso(retryAt)}; no outreach occurred.`,
      lastFailureCode: retryableError?.code ?? "TEMPORARY_FAILURE",
    }, "SELLER_CONTACT_ENRICHMENT_RETRY_SCHEDULED",
    `Retry scheduled at ${iso(retryAt)} after attempt ${row.attempts}.`, now);
  }
  if (retryNeeded) {
    for (const [providerId, outcome] of Object.entries(providerOutcomes).filter(([id]) => id !== "__externalOperation")) {
      if (outcome.status === "RETRY_WAIT") providerOutcomes[providerId] = {
        ...outcome, status: "FAILED", reason: "Retry limit reached; no unconfirmed route was accepted.",
      };
    }
  }
  const terminalOutcomes = Object.entries(providerOutcomes)
    .filter(([providerId]) => providerId !== "__externalOperation")
    .map(([, outcome]) => outcome);
  const allNoResult = processed > 0 && added === 0 && terminalOutcomes
    .filter(result => result.status !== "BLOCKED_BY_POLICY" && result.status !== "BLOCKED_BY_TERMS")
    .every(result => result.status === "NO_RESULT");
  const allStale = stale || (staleEvidenceCount > 0 && staleEvidenceCount === added) ||
    terminalOutcomes.some(result => result.status === "STALE_RESULT");
  const allBlocked = !added && blocked && terminalOutcomes.every(result =>
    ["BLOCKED_BY_POLICY", "BLOCKED_BY_TERMS", "BLOCKED_BY_PROVIDER_READINESS"].includes(result.status));
  const allFailed = terminalOutcomes.some(result => result.status === "FAILED");
  const status = allStale ? "STALE_RESULT"
    : allBlocked ? (terminalOutcomes.some(result => result.status === "BLOCKED_BY_PROVIDER_READINESS")
      ? "BLOCKED_BY_PROVIDER_READINESS"
      : terminalOutcomes.some(result => result.status === "BLOCKED_BY_TERMS")
        ? "BLOCKED_BY_TERMS" : "BLOCKED_BY_POLICY")
      : allNoResult ? "NO_RESULT"
        : allFailed && !added ? "FAILED"
          : "SUCCEEDED";
  const reason = status === "STALE_RESULT"
    ? "Source evidence was stale or the property changed during enrichment. The route remains blocked pending review."
    : status === "NO_RESULT"
      ? "Permitted providers returned no contact observations. No contact route was invented."
      : status === "BLOCKED_BY_POLICY" || status === "BLOCKED_BY_TERMS"
        ? "Provider policy or source terms blocked contact enrichment; no route was added."
        : status === "FAILED"
          ? "All provider attempts failed or returned invalid evidence. Retry with a fresh request after review."
          : `${added} new observation${added === 1 ? "" : "s"} persisted as unreviewed evidence. They do not establish identity, permission, signing authority, or CALL READY.${staleEvidenceCount ? ` ${staleEvidenceCount} stale observation(s) remain blocked.` : ""}`;
  return updateRequest(row, {
    status,
    providerOutcomes,
    expectedLeadVersion,
    resultCount: row.resultCount + added,
    nextAttemptAt: null,
    leaseUntil: null,
    reason,
    lastFailureCode: status === "FAILED" ? "PROVIDER_FAILURE" : null,
  }, `SELLER_CONTACT_ENRICHMENT_${status}`,
  `${reason} Processed ${processed} provider result${processed === 1 ? "" : "s"}.`, now);
}
