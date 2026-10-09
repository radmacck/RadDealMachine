import { createInsertSchema } from "drizzle-zod";
import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, index } from "drizzle-orm/pg-core";
import { contractsTable } from "./operations";
import { leadsTable } from "./leads";

/**
 * Persisted, deterministic transaction exceptions. These rows summarize
 * unresolved evidence/readiness gaps; the source contract, documents,
 * milestones, packets and decision records remain authoritative.
 */
export const transactionReadinessExceptionsTable = pgTable("re_transaction_readiness_exceptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull().references(() => contractsTable.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  issueKey: text("issue_key").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  reason: text("reason").notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
  ownerRole: text("owner_role").notNull(),
  status: text("status").notNull().default("OPEN"),
  nextActionCode: text("next_action_code").notNull(),
  nextAction: text("next_action").notNull(),
  eventAt: timestamp("event_at", { withTimezone: true }),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionEvidenceRefs: jsonb("resolution_evidence_refs").$type<string[]>().notNull().default([]),
  snapshotHash: text("snapshot_hash").notNull(),
  synthetic: boolean("synthetic").notNull().default(false),
  history: jsonb("history").$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("re_transaction_readiness_contract_issue_uq").on(table.contractId, table.issueKey),
  index("re_transaction_readiness_status_severity_idx").on(table.status, table.severity),
  index("re_transaction_readiness_lead_status_idx").on(table.leadId, table.status),
]);

export const insertTransactionReadinessExceptionSchema = createInsertSchema(transactionReadinessExceptionsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTransactionReadinessException = typeof transactionReadinessExceptionsTable.$inferInsert;
export type TransactionReadinessExceptionRow = typeof transactionReadinessExceptionsTable.$inferSelect;
