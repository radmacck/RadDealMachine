import { pgTable, uuid, text, jsonb, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { buyersTable, contractsTable } from "./operations";

export const distributionPacketsTable = pgTable("re_distribution_packets", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  contractId: uuid("contract_id").notNull().references(() => contractsTable.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("ACTIVE"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  authorizedBy: text("authorized_by").notNull(),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedBuyerId: uuid("accepted_buyer_id").references(() => buyersTable.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("re_distribution_packet_attempt_idx").on(t.leadId, t.attemptNumber),
  index("re_distribution_packet_status_idx").on(t.status),
]);

export const distributionRecipientsTable = pgTable("re_distribution_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  packetId: uuid("packet_id").notNull().references(() => distributionPacketsTable.id, { onDelete: "cascade" }),
  buyerId: uuid("buyer_id").notNull().references(() => buyersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  status: text("status").notNull().default("INVITED"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("re_distribution_recipient_pair_idx").on(t.packetId, t.buyerId),
  index("re_distribution_recipient_status_idx").on(t.packetId, t.status),
]);

export type DistributionPacketRow = typeof distributionPacketsTable.$inferSelect;
export type DistributionRecipientRow = typeof distributionRecipientsTable.$inferSelect;
