import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { providerHealth } from "./provider-health";
import { assessOperationalReadiness, type ReadinessCheck } from "./operational-readiness";

const apiScripts = [
  ["auth", "test:auth", "TEST"],
  ["buyer-outreach", "test:buyer-outreach", "TEST"],
  ["command-center", "test:command-center", "TEST"],
  ["provider-health", "test:provider-health", "TEST"],
  ["transaction-readiness", "test:transaction-readiness", "TEST"],
  ["worker-recovery", "test:worker-recovery", "TEST"],
  ["canonical-deal-state", "test:canonical-deal-state", "TEST"],
  ["deal-domain", null, "TEST"],
  ["permitted-property-discovery", "exercise:property-source", "PERMITTED_SOURCE_CHECK"],
  ["seller-contactability", "exercise:seller-contact-enrichment", "PERSISTED_SYNTHETIC_EXERCISE"],
  ["qualification-underwriting-call-notes", "exercise:acquisition-queue", "PERSISTED_SYNTHETIC_EXERCISE"],
  ["deterministic-underwriting", "exercise:seller", "PERSISTED_SYNTHETIC_EXERCISE"],
  ["offer-authorization-gates", "exercise:offers", "PERSISTED_SYNTHETIC_EXERCISE"],
  ["verified-buyer-matching", "exercise:buyer-pool", "PERSISTED_SYNTHETIC_EXERCISE"],
  ["package-distribution-contract-closing", "exercise:transactions", "PERSISTED_SYNTHETIC_EXERCISE"],
  ["exception-recovery", "exercise:worker-recovery", "PERSISTED_SYNTHETIC_EXERCISE"],
  ["closing-outcome-reconciliation", "exercise:outcome-learning", "PERSISTED_SYNTHETIC_EXERCISE"],
  ["cross-domain-next-action", "exercise:intelligence-loop", "PERSISTED_SYNTHETIC_EXERCISE"],
] as const;

function run(label: string, args: string[], category: ReadinessCheck["category"], env?: NodeJS.ProcessEnv): ReadinessCheck {
  console.log(`\n=== Readiness check: ${label} ===`);
  const result = spawnSync("pnpm", args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  const passed = result.status === 0;
  console.log(`CHECK_RESULT ${label} ${passed ? "PASS" : "FAIL"}`);
  return {
    id: label,
    category,
    status: passed ? "PASS" : "FAIL",
    detail: passed
      ? `${label} completed successfully.`
      : `${label} failed (exit ${result.status ?? result.error?.message ?? "unknown"}).`,
  };
}

const checks: ReadinessCheck[] = [];
for (const [id, script, category] of apiScripts) {
  if (id === "deal-domain") {
    checks.push(run(id, ["--filter", "@workspace/deal-domain", "test"], category));
  } else {
    checks.push(run(id, ["--filter", "@workspace/api-server", "run", script!], category));
  }
}

checks.push(run("api-typecheck", ["--filter", "@workspace/api-server", "run", "typecheck"], "TYPECHECK"));
checks.push(run("web-typecheck", ["--filter", "@workspace/radical-deal-os", "run", "typecheck"], "TYPECHECK"));
checks.push(run("api-build", ["--filter", "@workspace/api-server", "run", "build"], "BUILD"));
checks.push(run("web-build", ["--filter", "@workspace/radical-deal-os", "run", "build"], "BUILD", {
  PORT: process.env.PORT ?? "20639",
  BASE_PATH: process.env.BASE_PATH ?? "/",
}));

try {
  const providers = await providerHealth();
  for (const provider of providers) {
    checks.push({
      id: `provider-snapshot:${provider.id}`,
      category: "LIVE_SYSTEM",
      status: "UNVERIFIED",
      detail: `${provider.name}: persisted health is ${provider.status}; check kind ${provider.checkKind}. This is a configuration/history snapshot, not a live network probe.`,
    });
  }
} catch (error) {
  checks.push({
    id: "provider-snapshot",
    category: "LIVE_SYSTEM",
    status: "UNVERIFIED",
    detail: `Could not read the persisted provider-health snapshot: ${error instanceof Error ? error.message : "unknown error"}.`,
  });
}

checks.push({
  id: "live-owner-and-external-evidence",
  category: "LIVE_SYSTEM",
  status: "UNVERIFIED",
  detail: "No legitimate signed-in owner session or provider-confirmed live source, outreach, signature, funds, or closing evidence was supplied to this gate.",
});

const assessment = assessOperationalReadiness(checks);
const statusFor = (id: string) => checks.find(check => check.id === id)?.status ?? "UNVERIFIED";
const liveProviderIds = checks.filter(check =>
  check.category === "LIVE_SYSTEM" && check.id.startsWith("provider-snapshot:"),
).map(check => check.id);
const readinessMatrix = [
  {
    area: "Permitted property discovery, provenance, and deduplication",
    syntheticStatus: statusFor("permitted-property-discovery"),
    syntheticScope: "Public Philadelphia feeds queried in an isolated persisted exercise; no raw discovery becomes an active lead.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["permitted-property-discovery", "provider-snapshot:phila-property-sources"],
  },
  {
    area: "Seller contactability and contact permissions",
    syntheticStatus: statusFor("seller-contactability"),
    syntheticScope: "Persisted synthetic contact-research permission, provenance, and contact-route checks.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["seller-contactability", "provider-snapshot:seller-contact-research"],
  },
  {
    area: "Underwriting formulas and offer gates",
    syntheticStatus: statusFor("deterministic-underwriting") === "PASS" && statusFor("offer-authorization-gates") === "PASS" ? "PASS" : "FAIL",
    syntheticScope: "Deterministic persisted underwriting and offer authorization exercises; no synthetic score grants approval.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["deterministic-underwriting", "offer-authorization-gates"],
  },
  {
    area: "Call briefs and persisted call notes",
    syntheticStatus: statusFor("qualification-underwriting-call-notes"),
    syntheticScope: "Persisted isolated acquisition-queue and call-note exercise.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["qualification-underwriting-call-notes", "live-owner-and-external-evidence"],
  },
  {
    area: "Buyer verification and matching",
    syntheticStatus: statusFor("verified-buyer-matching"),
    syntheticScope: "Persisted synthetic buyer evidence and match constraints; matches are not buyer approval or commitment.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["verified-buyer-matching", "live-owner-and-external-evidence"],
  },
  {
    area: "Approved seller/buyer outreach",
    syntheticStatus: statusFor("buyer-outreach"),
    syntheticScope: "Authorization and idempotency tests only; synthetic operations do not send messages.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["buyer-outreach", "provider-snapshot:outbound-messaging", "live-owner-and-external-evidence"],
  },
  {
    area: "Address-redacted package distribution",
    syntheticStatus: statusFor("package-distribution-contract-closing"),
    syntheticScope: "Persisted isolated transaction exercise verifies disclosure controls; no package was delivered externally.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["package-distribution-contract-closing", "provider-snapshot:private-document-storage", "provider-snapshot:outbound-messaging"],
  },
  {
    area: "Contract, signature, funds, and deadline tracking",
    syntheticStatus: statusFor("transaction-readiness") === "PASS" && statusFor("package-distribution-contract-closing") === "PASS" ? "PASS" : "FAIL",
    syntheticScope: "Persisted transaction/deadline state and signature/funds evidence constraints; no signature or funds transfer occurred.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["transaction-readiness", "package-distribution-contract-closing", "provider-snapshot:electronic-signature", "provider-snapshot:closing-coordination"],
  },
  {
    area: "Closing outcomes and reconciliation",
    syntheticStatus: statusFor("closing-outcome-reconciliation"),
    syntheticScope: "Persisted synthetic outcome reconciliation; not a real closing.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["closing-outcome-reconciliation", "provider-snapshot:closing-coordination"],
  },
  {
    area: "Exception recovery",
    syntheticStatus: statusFor("exception-recovery"),
    syntheticScope: "Failure/retry/dead-letter/replay behavior exercised with isolated synthetic jobs.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["exception-recovery", ...liveProviderIds],
  },
  {
    area: "Security",
    syntheticStatus: ["auth", "provider-health"].every(id => statusFor(id) === "PASS") ? "PASS" : "FAIL",
    syntheticScope: "Authentication and provider-boundary tests; latest dependency/SAST/privacy scanner findings are recorded in the checkpoint.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["auth", "provider-health", "live-owner-and-external-evidence"],
  },
  {
    area: "Command center next action",
    syntheticStatus: statusFor("cross-domain-next-action"),
    syntheticScope: "Persisted synthetic next-action selection; no authenticated owner UI session was available.",
    liveStatus: "UNVERIFIED",
    evidenceCheckIds: ["cross-domain-next-action", "command-center", "live-owner-and-external-evidence"],
  },
];
const report = {
  gate: "REAL_ESTATE_OS_OPERATIONAL_READINESS",
  generatedAt: new Date().toISOString(),
  syntheticWorkflowStatus: assessment.syntheticStatus,
  permittedSourceStatus: assessment.permittedSourceStatus,
  operationalStatus: assessment.operationalStatus,
  failedCheckIds: assessment.failedCheckIds,
  unverifiedLiveCheckIds: assessment.unverifiedLiveCheckIds,
  earliestBlocker: assessment.earliestBlocker,
  checks,
  readinessMatrix,
  limitations: [
    "Persisted exercises use isolated synthetic fixtures and do not establish a real deal, approved buyer, contact route, call, delivery, signature, transfer, or closing.",
    "Provider status is read from configuration and persisted job history; this gate does not send external requests or expose credentials.",
    "A signed-in owner browser session is not available to this gate.",
  ],
};
writeFileSync(resolve(process.cwd(), "../../docs/real-estate-os-readiness-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nOPERATIONAL READINESS REPORT\n${JSON.stringify(report, null, 2)}`);
if (assessment.operationalStatus !== "READY") process.exitCode = 2;
