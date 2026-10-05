import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { offersTable } from "./offers";

export const sellerOfferPortalsTable = pgTable("re_seller_offer_portals", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  offerId: uuid("offer_id").notNull().references(() => offersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  status: text("status").notNull().default("ACTIVE"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, t => [
  index("re_seller_portals_offer_idx").on(t.offerId, t.createdAt),
  index("re_seller_portals_lead_idx").on(t.leadId, t.createdAt),
]);

export const sellerOfferPortalEventsTable = pgTable("re_seller_offer_portal_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  portalId: uuid("portal_id").notNull().references(() => sellerOfferPortalsTable.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("re_seller_portal_events_one_response_idx").on(t.portalId),
  uniqueIndex("re_seller_portal_events_idempotency_idx").on(t.portalId, t.eventKey),
]);
