import { desc } from "drizzle-orm";
import { db, jobsTable } from "@workspace/db";
import { allPropertySourceConnectors } from "./property-source-connectors";

export type ProviderHealthStatus = "CONNECTED" | "DISCONNECTED" | "DEGRADED" | "RATE_LIMITED" | "UNCONFIGURED";
export type ProviderCheckKind = "PERSISTED_JOB" | "ADAPTER_REGISTRATION" | "READINESS_CHECK" | "CONFIGURATION_CHECK";
export type ProviderHealthEntry = {
  id: string;
  name: string;
  category: "PROPERTY_SOURCE" | "CONTACT_RESEARCH" | "MESSAGING" | "DOCUMENT_SIGNATURE" | "CLOSING_COORDINATION" | "FILE_STORAGE";
  status: ProviderHealthStatus;
  checkedAt: string;
  lastSuccessAt: string | null;
  checkKind: ProviderCheckKind;
  reason: string;
  nextAction: string;
};

export function classifyProviderHealth(configured: boolean, lastCheck?: {
  state: string;
  message?: string | null;
  completedAt?: Date | string | null;
  lastSuccessAt?: Date | string | null;
}): Pick<ProviderHealthEntry, "status" | "lastSuccessAt" | "checkKind" | "reason"> {
  if (!configured) return {
    status: "UNCONFIGURED", lastSuccessAt: null, checkKind: "CONFIGURATION_CHECK",
    reason: "No provider connection or permitted adapter is configured. No external request was made.",
  };
  if (!lastCheck) return {
    status: "DEGRADED", lastSuccessAt: null, checkKind: "ADAPTER_REGISTRATION",
    reason: "Adapter is registered, but no persisted successful health check is available.",
  };
  const message = lastCheck.message ?? "";
  const completedAt = lastCheck.completedAt instanceof Date
    ? lastCheck.completedAt.toISOString()
    : lastCheck.completedAt ?? null;
  const previousSuccess = lastCheck.lastSuccessAt instanceof Date
    ? lastCheck.lastSuccessAt.toISOString()
    : lastCheck.lastSuccessAt ?? null;
  if (lastCheck.state === "SUCCEEDED") return {
    status: "CONNECTED", lastSuccessAt: completedAt, checkKind: "PERSISTED_JOB",
    reason: "The latest persisted provider job completed successfully.",
  };
  if (/429|rate[\s_-]?limit|too many requests/i.test(message)) return {
    status: "RATE_LIMITED", lastSuccessAt: previousSuccess, checkKind: "PERSISTED_JOB",
    reason: "The latest persisted provider job reports rate limiting; respect the provider's retry window.",
  };
  if (/401|403|unauthorized|forbidden|invalid credential/i.test(message)) return {
    status: "DISCONNECTED", lastSuccessAt: previousSuccess, checkKind: "PERSISTED_JOB",
    reason: "The latest persisted provider job reports an authorization failure. Credential values are not exposed.",
  };
  return {
    status: "DEGRADED", lastSuccessAt: previousSuccess, checkKind: "PERSISTED_JOB",
    reason: lastCheck.state === "RUNNING" || lastCheck.state === "QUEUED"
      ? `The latest provider job is ${lastCheck.state.toLowerCase()}; connection health is not yet confirmed.`
      : `The latest provider job did not succeed (${lastCheck.state.toLowerCase()}); no success is claimed.`,
  };
}

export function applyProviderHealthFreshness<T extends Pick<ProviderHealthEntry, "status" | "checkKind" | "lastSuccessAt" | "reason">>(
  entry: T,
  now: Date,
  maxAgeMs = 12 * 60 * 60 * 1000,
): T {
  if (entry.status !== "CONNECTED" || entry.checkKind !== "PERSISTED_JOB" || !entry.lastSuccessAt) return entry;
  const age = now.getTime() - Date.parse(entry.lastSuccessAt);
  return age > maxAgeMs ? {
    ...entry,
    status: "DEGRADED" as T["status"],
    reason: "The last successful source job is older than 12 hours; refresh it before relying on current connectivity.",
  } : entry;
}

type ExistingReadiness = {
  signingProvider: { status: string };
  deliveryProvider: { status: string };
  storage: { status: string };
};

export async function providerHealth(now = new Date(), readiness?: ExistingReadiness): Promise<ProviderHealthEntry[]> {
  const jobs = await db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt)).limit(100);
  const sourceJobs = jobs.filter((job) => /DISCOVER_PROPERTIES|PROPERTY_SOURCE|SOURCE_RESEARCH|REFRESH_SOURCE/i.test(job.kind));
  const sourceJob = sourceJobs[0];
  const sourceConfigured = allPropertySourceConnectors().length > 0;
  const sourceCheck = sourceJob ? {
    state: sourceJob.state,
    message: sourceJob.message,
    completedAt: sourceJob.state === "SUCCEEDED" ? sourceJob.updatedAt : null,
    lastSuccessAt: sourceJobs.find((job) => job.state === "SUCCEEDED")?.updatedAt ?? null,
  } : undefined;
  const source = applyProviderHealthFreshness(classifyProviderHealth(sourceConfigured, sourceCheck), now);
  const readinessStatus = (configured: boolean) => configured
    ? {
      status: "CONNECTED" as const, lastSuccessAt: null, checkKind: "READINESS_CHECK" as const,
      reason: "Provider/adapter is configured according to the current readiness check; no live network probe was run.",
    }
    : classifyProviderHealth(false);
  const signingConfigured = readiness?.signingProvider.status === "CONNECTED";
  const deliveryConfigured = readiness?.deliveryProvider.status === "CONNECTED";
  const storageConfigured = readiness?.storage.status.includes("MANAGED_PRIVATE") ?? false;
  const storageHealth = storageConfigured
    ? readinessStatus(true)
    : readiness?.storage
      ? {
        status: "DEGRADED" as const, lastSuccessAt: null, checkKind: "READINESS_CHECK" as const,
        reason: "Managed private storage is unavailable; only the protected database fallback is available.",
      }
      : classifyProviderHealth(false);
  return [
    { id: "phila-property-sources", name: "Philadelphia public-record adapters", category: "PROPERTY_SOURCE" as const, ...source, checkedAt: sourceJob?.updatedAt.toISOString() ?? now.toISOString(), nextAction: source.status === "CONNECTED" ? "Continue only within reviewed source terms and recorded rate limits." : "Review the latest source job; do not infer source coverage from adapter registration." },
    { id: "seller-contact-research", name: "Seller contact research", category: "CONTACT_RESEARCH" as const, ...classifyProviderHealth(false), checkedAt: now.toISOString(), nextAction: "Use permitted manual route capture with source, permission, identity and freshness evidence; no enrichment provider is connected." },
    { id: "outbound-messaging", name: "Email/SMS delivery", category: "MESSAGING" as const, ...readinessStatus(deliveryConfigured), checkedAt: now.toISOString(), nextAction: deliveryConfigured ? "Use the provider only after recipient authorization and persist a provider receipt for delivery claims." : "Connect a provider through the workspace integration flow before sending; drafts remain NOT_SENT." },
    { id: "electronic-signature", name: "Document/signature provider", category: "DOCUMENT_SIGNATURE" as const, ...readinessStatus(signingConfigured), checkedAt: now.toISOString(), nextAction: signingConfigured ? "Send only an authorized current document and retain provider envelope/signature receipts." : "No signature request can be sent; connect an approved provider before enabling this action." },
    { id: "closing-coordination", name: "Closing/title coordination", category: "CLOSING_COORDINATION" as const, ...classifyProviderHealth(false), checkedAt: now.toISOString(), nextAction: "Continue manual, evidence-linked title/closing milestones; no external closing coordinator is connected." },
    { id: "private-document-storage", name: "Private document storage", category: "FILE_STORAGE" as const, ...storageHealth, checkedAt: now.toISOString(), nextAction: storageConfigured ? "Validate authenticated object access on read/write; never expose private document URLs." : "Managed private storage is unavailable; database fallback remains protected but is not managed object storage." },
  ];
}
