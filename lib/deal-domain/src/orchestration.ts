/**
 * Standalone boundary only. No dependency on unfinished Naelo/RDS/RDC.
 * Future orchestrators call domain commands through adapters, never bypass guards.
 * This is deliberately an interface, not a running worker framework.
 */
export interface DomainCommand {
  kind: "enrich_property" | "refresh_underwriting" | "verify_buyer" | "match_buyers" | "follow_up";
  entityId: string;
  idempotencyKey: string;
  requestedBy: string;
}
export interface OrchestrationPort {
  submit(command: DomainCommand): Promise<{ jobId: string }>;
  status(jobId: string): Promise<{ state: "queued" | "running" | "succeeded" | "failed"; error?: string }>;
}