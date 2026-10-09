import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index, integer, boolean } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { propertyDiscoveriesTable } from "./property-discoveries";

export const dealDecisionEvaluationsTable = pgTable("re_deal_decision_evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  leadId: uuid("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
  discoveryId: uuid("discovery_id").references(() => propertyDiscoveriesTable.id, { onDelete: "cascade" }),
  snapshotHash: text("snapshot_hash").notNull(),
  ruleVersion: text("rule_version").notNull(),
  evaluatedBy: text("evaluated_by").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("re_decision_eval_snapshot_uq").on(table.subjectType, table.subjectId, table.snapshotHash),
  index("re_decision_eval_subject_idx").on(table.subjectType, table.subjectId, table.createdAt),
]);

export const dealDecisionWorkItemsTable = pgTable("re_deal_decision_work_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  leadId: uuid("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
  discoveryId: uuid("discovery_id").references(() => propertyDiscoveriesTable.id, { onDelete: "cascade" }),
  evaluationId: uuid("evaluation_id").notNull().references(() => dealDecisionEvaluationsTable.id, { onDelete: "restrict" }),
  actionCode: text("action_code").notNull(),
  gapKey: text("gap_key").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  evidenceSnapshotHash: text("evidence_snapshot_hash").notNull().default(""),
  subjectVersion: integer("subject_version").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  retryable: boolean("retryable").notNull().default(false),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  leaseOwner: text("lease_owner"),
  leaseToken: uuid("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  stateVersion: integer("state_version").notNull().default(1),
  completionKey: text("completion_key"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("re_decision_work_idempotency_uq").on(table.idempotencyKey),
  index("re_decision_work_subject_status_idx").on(table.subjectType, table.subjectId, table.status),
  index("re_decision_work_lead_status_idx").on(table.leadId, table.status),
  index("re_decision_work_retry_idx").on(table.status, table.nextAttemptAt),
  index("re_decision_work_lease_idx").on(table.status, table.leaseExpiresAt),
]);

export const dealDecisionWorkEventsTable = pgTable("re_deal_decision_work_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workItemId: uuid("work_item_id").notNull().references(() => dealDecisionWorkItemsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  actor: text("actor").notNull(),
  reason: text("reason").notNull(),
  evaluationId: uuid("evaluation_id").references(() => dealDecisionEvaluationsTable.id, { onDelete: "set null" }),
  evidenceSnapshotHash: text("evidence_snapshot_hash"),
  attempt: integer("attempt").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("re_decision_work_event_item_idx").on(table.workItemId, table.createdAt),
  index("re_decision_work_event_type_idx").on(table.eventType, table.createdAt),
]);
