import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
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
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("re_decision_work_idempotency_uq").on(table.idempotencyKey),
  index("re_decision_work_subject_status_idx").on(table.subjectType, table.subjectId, table.status),
  index("re_decision_work_lead_status_idx").on(table.leadId, table.status),
]);
