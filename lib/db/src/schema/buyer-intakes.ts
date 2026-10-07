import { pgTable, uuid, integer, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { buyersTable } from "./operations";

export const buyerIntakesTable = pgTable("re_buyer_intakes", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("PENDING_REVIEW"),
  buyerId: uuid("buyer_id").references(() => buyersTable.id, { onDelete: "set null" }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("re_buyer_intakes_submission_idx").on(table.submissionId),
  index("re_buyer_intakes_status_created_idx").on(table.status, table.createdAt),
  index("re_buyer_intakes_buyer_idx").on(table.buyerId),
]);

export type BuyerIntake = typeof buyerIntakesTable.$inferSelect;
