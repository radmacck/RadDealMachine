import { createInsertSchema } from "drizzle-zod";
import { index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";

export const propertyDiscoveriesTable = pgTable("re_property_discoveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  identityKey: text("identity_key").notNull(),
  ownerKey: text("owner_key"),
  marketKey: text("market_key").notNull(),
  status: text("status").notNull().default("DISCOVERED_PROPERTY"),
  score: integer("score").notNull().default(0),
  confidence: real("confidence").notNull().default(0),
  version: integer("version").notNull().default(1),
  leadId: uuid("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("re_property_discoveries_identity_uq").on(t.identityKey),
  index("re_property_discoveries_market_status_idx").on(t.marketKey, t.status),
  index("re_property_discoveries_owner_key_idx").on(t.ownerKey),
  index("re_property_discoveries_rank_idx").on(t.score, t.updatedAt),
  index("re_property_discoveries_lead_idx").on(t.leadId),
]);

export const propertySourceObservationsTable = pgTable("re_property_source_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  discoveryId: uuid("discovery_id").notNull().references(() => propertyDiscoveriesTable.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  sourceId: text("source_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
  seenCount: integer("seen_count").notNull().default(1),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
}, (t) => [
  uniqueIndex("re_property_source_observations_source_uq").on(t.sourceKey),
  index("re_property_source_observations_discovery_idx").on(t.discoveryId, t.lastObservedAt),
]);

export const unmatchedPropertySourceObservationsTable = pgTable("re_property_source_unmatched", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketKey: text("market_key").notNull(),
  propertyId: text("property_id").notNull(),
  sourceKey: text("source_key").notNull(),
  sourceId: text("source_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  status: text("status").notNull().default("UNMATCHED"),
  linkedDiscoveryId: uuid("linked_discovery_id").references(() => propertyDiscoveriesTable.id, { onDelete: "set null" }),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
  seenCount: integer("seen_count").notNull().default(1),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("re_property_source_unmatched_source_uq").on(t.sourceKey),
  index("re_property_source_unmatched_market_status_idx").on(t.marketKey, t.status, t.lastObservedAt),
  index("re_property_source_unmatched_property_idx").on(t.propertyId),
]);

export const propertyQualificationCriteriaTable = pgTable("re_property_qualification_criteria", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketKey: text("market_key").notNull(),
  version: integer("version").notNull().default(1),
  criteria: jsonb("criteria").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("re_property_qualification_criteria_market_uq").on(t.marketKey)]);

export const insertPropertyDiscoverySchema = createInsertSchema(propertyDiscoveriesTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export const insertPropertySourceObservationSchema = createInsertSchema(propertySourceObservationsTable)
  .omit({ id: true });
export const insertPropertyQualificationCriteriaSchema = createInsertSchema(propertyQualificationCriteriaTable)
  .omit({ id: true, updatedAt: true });

export type PropertyDiscoveryRow = typeof propertyDiscoveriesTable.$inferSelect;
export type PropertySourceObservationRow = typeof propertySourceObservationsTable.$inferSelect;
export type PropertyQualificationCriteriaRow = typeof propertyQualificationCriteriaTable.$inferSelect;
