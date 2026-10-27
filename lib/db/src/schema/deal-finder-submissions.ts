import { pgTable, uuid, text, jsonb, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { buyersTable } from "./operations";

export const dealFinderSubmissionsTable = pgTable("re_deal_finder_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: text("idempotency_key").notNull(),
  finderId: uuid("finder_id").notNull().references(() => buyersTable.id),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("SUBMITTED"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  submittedBy: text("submitted_by").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("re_deal_finder_submission_key_uq").on(t.idempotencyKey),
  index("re_deal_finder_status_submitted_idx").on(t.status, t.submittedAt),
  index("re_deal_finder_finder_idx").on(t.finderId, t.submittedAt),
]);

export type DealFinderSubmissionRow = typeof dealFinderSubmissionsTable.$inferSelect;
