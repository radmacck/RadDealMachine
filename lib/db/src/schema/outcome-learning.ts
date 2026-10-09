import {
  pgTable, uuid, text, jsonb, timestamp, boolean, integer, real, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";

/**
 * Append-only learning projection of canonical deal events.
 * The source record remains authoritative; these rows preserve the exact event
 * references and prediction/actual comparison used by outcome reporting.
 */
export const outcomeObservationsTable = pgTable("re_outcome_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  eventType: text("event_type").notNull(),
  sourceRecordType: text("source_record_type").notNull(),
  sourceRecordId: text("source_record_id").notNull(),
  source: text("source").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
  isSynthetic: boolean("is_synthetic").notNull().default(false),
  confidence: real("confidence"),
  verificationState: text("verification_state").notNull(),
  economicsSnapshotId: text("economics_snapshot_id"),
  decisionVersion: integer("decision_version"),
  predicted: jsonb("predicted").$type<Record<string, unknown> | null>(),
  actual: jsonb("actual").$type<Record<string, unknown> | null>(),
  delta: jsonb("delta").$type<Record<string, unknown> | null>(),
  causeCategories: jsonb("cause_categories").$type<string[]>().notNull().default([]),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  uniqueIndex("re_outcome_observation_idempotency_uq").on(table.idempotencyKey),
  index("re_outcome_observation_lead_idx").on(table.leadId, table.recordedAt),
  index("re_outcome_observation_metric_idx").on(table.eventType, table.isSynthetic, table.verificationState),
]);

/**
 * Rule recommendations are review records only. Accepting one does not mutate
 * live ranking, underwriting, offer authority, or economics.
 */
export const outcomeCalibrationReviewsTable = pgTable("re_outcome_calibration_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: text("idempotency_key").notNull(),
  metricKey: text("metric_key").notNull(),
  currentRuleVersion: text("current_rule_version").notNull(),
  proposedRuleVersion: text("proposed_rule_version").notNull(),
  status: text("status").notNull(),
  sampleSize: integer("sample_size").notNull(),
  minimumSampleSize: integer("minimum_sample_size").notNull(),
  observationRefs: jsonb("observation_refs").$type<string[]>().notNull().default([]),
  summary: text("summary").notNull(),
  isSynthetic: boolean("is_synthetic").notNull().default(false),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  history: jsonb("history").$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("re_outcome_calibration_idempotency_uq").on(table.idempotencyKey),
  index("re_outcome_calibration_metric_idx").on(table.metricKey, table.status),
]);

export type OutcomeObservationRow = typeof outcomeObservationsTable.$inferSelect;
export type OutcomeCalibrationReviewRow = typeof outcomeCalibrationReviewsTable.$inferSelect;
