import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, settingsTable, auditTable } from "@workspace/db";
import { DomainError } from "@workspace/deal-domain";
import { allPropertySourceConnectors } from "./property-source-connectors";
import { providerHealth } from "./provider-health";

export const WorkspaceSetupInput = z.object({
  sourceTermsReviewedIds: z.array(z.string().min(1).max(100)).max(30),
  contactResearchMethod: z.enum(["NONE", "MANUAL", "PROVIDER"]),
  contactResearchProvider: z.string().max(80),
  emailProvider: z.enum(["NONE", "SENDGRID", "MAILGUN"]),
  smsProvider: z.enum(["NONE", "TWILIO"]),
  signatureProvider: z.enum(["NONE", "DOCUSIGN", "ADOBE_SIGN"]),
  closingMode: z.enum(["MANUAL", "TITLE_PARTNER"]),
  closingPartnerName: z.string().max(120),
  states: z.array(z.string().regex(/^[A-Z]{2}$/)).max(20),
  counties: z.array(z.string().trim().min(1).max(80)).max(100),
  zipCodes: z.array(z.string().regex(/^\d{5}$/)).max(500),
  notifications: z.object({
    staleEvidence: z.boolean(),
    callFollowups: z.boolean(),
    contractDeadlines: z.boolean(),
    providerFailures: z.boolean(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.contactResearchMethod === "PROVIDER" && !value.contactResearchProvider.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["contactResearchProvider"], message: "Enter a provider name or choose manual route capture." });
  }
  if (value.closingMode === "TITLE_PARTNER" && !value.closingPartnerName.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["closingPartnerName"], message: "Enter a title/closing partner name or select manual tracking." });
  }
});
export type WorkspaceSetupInput = z.infer<typeof WorkspaceSetupInput>;
type SetupDb = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
const SECRET_KEY = /(?:api.?key|secret|token|password|credential|private.?key)/i;

function rejectSecretFields(value: unknown): void {
  if (typeof value === "string" &&
    (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) ||
      /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}/i.test(value) ||
      /^(?:AKIA|gh[pousr]_)[A-Za-z0-9_-]{16,}$/.test(value.trim()) ||
      /^(?:SG\.|AC[a-f0-9]{32})\S+$/i.test(value.trim()) ||
      /^[A-Za-z0-9_-]{40,}$/.test(value.trim()))) {
    throw new DomainError("A value looks like a credential. Remove it and use workspace Secrets; credentials are never saved here.", 400);
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new DomainError("Secret values cannot be saved here. Use workspace Secrets; this form stores provider names only.", 400);
    rejectSecretFields(child);
  }
}

export function validateWorkspaceSetup(input: unknown): WorkspaceSetupInput {
  rejectSecretFields(input);
  const parsed = WorkspaceSetupInput.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues.map(issue =>
    `${issue.path.join(".")}: ${issue.message}`).join("; "), 400);
  const providerName = parsed.data.contactResearchProvider.trim();
  if (/^(?:sk[-_]|akia|gh[pousr]_|eyJ)/i.test(providerName) || /^[A-Za-z0-9_-]{32,}$/.test(providerName)) {
    throw new DomainError("That value looks like a credential, not a provider name. Remove it and use workspace Secrets.", 400);
  }
  const sourceIds = new Set(allPropertySourceConnectors().flatMap(connector => connector.sources.map(source => source.id)));
  const unknownSource = parsed.data.sourceTermsReviewedIds.find(id => !sourceIds.has(id));
  if (unknownSource) throw new DomainError(`Unknown property source "${unknownSource}". Choose a registered source.`, 400);
  return parsed.data;
}

export function requireSetupOwner(role: string): void {
  if (role !== "OWNER") throw new DomainError("Only the workspace owner can change operational setup.", 403);
}

export function providerSetupStatus(selected: boolean, credentialsPresent: boolean, realCheckSucceeded: boolean) {
  if (!selected) return "MISSING" as const;
  if (!credentialsPresent) return "MISSING" as const;
  if (realCheckSucceeded) return "VERIFIED" as const;
  return "CONFIGURED" as const;
}

export const emptyWorkspaceSetup: WorkspaceSetupInput = {
  sourceTermsReviewedIds: [],
  contactResearchMethod: "NONE",
  contactResearchProvider: "",
  emailProvider: "NONE",
  smsProvider: "NONE",
  signatureProvider: "NONE",
  closingMode: "MANUAL",
  closingPartnerName: "",
  states: [],
  counties: [],
  zipCodes: [],
  notifications: { staleEvidence: true, callFollowups: true, contractDeadlines: true, providerFailures: true },
};

export async function loadWorkspaceSetup(database: SetupDb = db): Promise<WorkspaceSetupInput> {
  return (await readSetupRecord(database)).setup;
}

async function readSetupRecord(database: SetupDb) {
  const [row] = await database.select().from(settingsTable).where(eq(settingsTable.id, 3));
  if (!row) return { setup: emptyWorkspaceSetup, persisted: false, invalidReason: null as string | null };
  const saved = row.assumptions.workspaceSetup;
  try {
    return { setup: validateWorkspaceSetup(saved), persisted: true, invalidReason: null as string | null };
  } catch (error) {
    return { setup: emptyWorkspaceSetup, persisted: true, invalidReason: error instanceof Error ? error.message : "Saved configuration is invalid." };
  }
}

export async function saveWorkspaceSetup(
  input: unknown,
  actor: string,
  role: string,
  database: SetupDb = db,
) {
  requireSetupOwner(role);
  const data = validateWorkspaceSetup(input);
  return database.transaction(async tx => {
    await tx.insert(settingsTable).values({ id: 3, assumptions: { workspaceSetup: data } })
      .onConflictDoUpdate({ target: settingsTable.id, set: { assumptions: { workspaceSetup: data }, updatedAt: new Date() } });
    await tx.insert(auditTable).values({
      actor, action: "WORKSPACE_SETUP_UPDATED", entityId: "workspace",
      detail: "Operational setup preferences updated; no credentials were submitted or stored.",
    });
    return data;
  });
}

export async function getWorkspaceSetupStatus(now = new Date()) {
  const [record, providers] = await Promise.all([readSetupRecord(db), providerHealth(now)]);
  const { setup } = record;
  const health = new Map(providers.map(provider => [provider.id, provider]));
  const sources = allPropertySourceConnectors().flatMap(connector => connector.sources.map(source => {
    const check = health.get("phila-property-sources");
    const reviewed = setup.sourceTermsReviewedIds.includes(source.id);
    const status = record.invalidReason ? "INVALID" : check?.status === "CONNECTED" && check.checkKind === "PERSISTED_JOB" && reviewed ? "VERIFIED"
      : reviewed ? "CONFIGURED" : "MISSING";
    return {
      id: source.id, name: source.name, coverage: source.coverage, termsUrl: source.termsUrl,
      status, detail: status === "INVALID"
        ? `Saved source configuration is invalid: ${record.invalidReason}`
        : status === "VERIFIED" ? "A successful persisted source job and terms review are recorded."
        : reviewed ? "Terms are marked reviewed; a successful persisted source check is still required."
          : "Review this source's terms before relying on or refreshing it.",
      nextAction: status === "VERIFIED" ? "Keep activity within reviewed terms and coverage."
        : "Review terms, save the source selection, then run an owner-authorized source refresh.",
    };
  }));
  const credentialEnv: Record<string, string[]> = {
    SENDGRID: ["SENDGRID_API_KEY"],
    MAILGUN: ["MAILGUN_API_KEY"],
    TWILIO: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    DOCUSIGN: ["DOCUSIGN_ACCESS_TOKEN"],
    ADOBE_SIGN: ["ADOBE_SIGN_ACCESS_TOKEN"],
  };
  const selectedProvider = (id: string, selected: string, healthId: string) => {
    const required = credentialEnv[selected] ?? [];
    const credentialsPresent = required.length > 0 && required.every(key => Boolean(process.env[key]));
    const check = health.get(healthId);
    const realCheckSucceeded = check?.status === "CONNECTED" && check.checkKind === "PERSISTED_JOB";
    const status = providerSetupStatus(selected !== "NONE", credentialsPresent, realCheckSucceeded);
    return {
      id, label: id === "email" ? "Email provider" : id === "sms" ? "Text messaging" : id === "signature" ? "Document/signature provider" : id, selected: selected !== "NONE", provider: selected, status,
      detail: status === "VERIFIED" ? "A successful persisted provider check is recorded."
        : status === "CONFIGURED" ? "Provider credentials are present, but no successful real health check is recorded."
          : selected === "NONE" ? "No provider selected; no connection is claimed."
            : required.length ? "Provider selected, but required credentials are missing from workspace Secrets."
              : "Provider selected, but credential requirements and a health check are not configured.",
      nextAction: status === "VERIFIED" ? "Continue to monitor check freshness and provider receipts."
        : status === "CONFIGURED" ? "Run an owner-authorized provider health check before relying on connectivity."
          : selected === "NONE" ? "Choose a supported provider or keep the manual workflow."
            : "Add credentials through workspace Secrets; never paste them into this form.",
    };
  };
  const method = setup.contactResearchMethod;
  return {
    setup,
    sources,
    settings: [
      { ...selectedProvider("contact-research", method === "PROVIDER" ? setup.contactResearchProvider || "SELECT_PROVIDER" : method, "seller-contact-research"), label: "Contact research", status: method === "MANUAL" ? "CONFIGURED" : "MISSING", detail: method === "MANUAL" ? "Manual route capture selected; this is not an enrichment provider." : "No verified enrichment provider. Manual capture remains available." },
      selectedProvider("email", setup.emailProvider, "outbound-messaging"),
      selectedProvider("sms", setup.smsProvider, "outbound-messaging"),
      selectedProvider("signature", setup.signatureProvider, "electronic-signature"),
      {
        id: "closing-workflow", provider: setup.closingMode, selected: true, label: "Closing workflow",
        status: setup.closingMode === "MANUAL" ? "CONFIGURED" : setup.closingPartnerName.trim() ? "CONFIGURED" : "INVALID",
        detail: setup.closingMode === "MANUAL" ? "Manual evidence-linked milestones selected; no partner integration is claimed."
          : setup.closingPartnerName.trim() ? `Partner named: ${setup.closingPartnerName}; no connection check is available.`
            : "A title partner is required when partner coordination is selected.",
        nextAction: setup.closingMode === "MANUAL" ? "Record milestones and evidence in the transaction workflow."
          : setup.closingPartnerName.trim() ? "Confirm partner workflow and access outside this configuration form."
            : "Enter the title/closing partner name or switch to manual.",
      },
      {
        id: "geography", provider: "Workspace coverage", selected: setup.states.length > 0,
        status: setup.states.length ? "CONFIGURED" : "MISSING",
        detail: setup.states.length ? `${setup.states.length} state(s), ${setup.counties.length} county/cities, ${setup.zipCodes.length} ZIP codes saved.` : "No acquisition geography is configured.",
        nextAction: "Add only markets the team is authorized and able to serve.",
      },
      {
        id: "underwriting", provider: "Existing workspace assumptions", selected: true,
        status: "CONFIGURED", detail: "Underwriting thresholds are managed in the existing Assumptions section below.",
        nextAction: "Review the existing underwriting assumptions; changes affect future calculations only.",
      },
      {
        id: "notifications", provider: "Workspace preferences", selected: record.persisted, status: record.invalidReason ? "INVALID" : record.persisted ? "CONFIGURED" : "MISSING",
        detail: record.invalidReason ? `Saved settings are invalid: ${record.invalidReason}` : record.persisted ? "Notification preferences are saved with this workspace setup." : "Default notification preferences are shown but not yet saved.",
        nextAction: record.invalidReason ? "Correct and save the setup form to replace the invalid saved record." : "Save preferences; delivery channels remain unconfigured unless separately connected.",
      },
    ],
    persisted: record.persisted,
    persistenceStatus: record.invalidReason ? "INVALID" : record.persisted ? "CONFIGURED" : "MISSING",
    providerHealth: providers,
  };
}
