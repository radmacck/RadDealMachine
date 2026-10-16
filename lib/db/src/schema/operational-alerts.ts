import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index, integer } from "drizzle-orm/pg-core";

export const operationalAlertsTable = pgTable("re_operational_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  alertKey: text("alert_key").notNull(),
  sourceActionId: text("source_action_id").notNull(),
  sourceRecordId: text("source_record_id").notNull(),
  category: text("category").notNull(),
  priority: integer("priority").notNull(),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  href: text("href").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("ACTIVE"),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("re_operational_alert_key_uq").on(table.alertKey),
  index("re_operational_alert_status_priority_idx").on(table.status, table.priority),
]);
