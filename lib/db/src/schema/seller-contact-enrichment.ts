import { pgTable, uuid, text, jsonb, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";

export const sellerContactEnrichmentRequestsTable = pgTable("re_seller_contact_enrichment_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  requestedBy: text("requested_by").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  channels: jsonb("channels").$type<string[]>().notNull(),
  status: text("status").notNull(),
  requestedLeadVersion: integer("requested_lead_version").notNull(),
  expectedLeadVersion: integer("expected_lead_version").notNull(),
  providerIds: jsonb("provider_ids").$type<string[]>().notNull().default([]),
  providerOutcomes: jsonb("provider_outcomes").$type<Record<string, Record<string, unknown>>>().notNull().default({}),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  resultCount: integer("result_count").notNull().default(0),
  reason: text("reason").notNull(),
  lastFailureCode: text("last_failure_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("re_seller_contact_enrichment_idempotency_idx").on(table.idempotencyKey),
  index("re_seller_contact_enrichment_lead_created_idx").on(table.leadId, table.createdAt),
  index("re_seller_contact_enrichment_work_idx").on(table.status, table.nextAttemptAt),
]);

export type SellerContactEnrichmentRequestRow = typeof sellerContactEnrichmentRequestsTable.$inferSelect;
