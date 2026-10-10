import { pgTable, uuid, text, jsonb, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";

/**
 * Owner-entered special-clause requests are evidence/work items only.
 * They are never inserted into a legal document by this table.
 */
export const transactionClauseRequestsTable = pgTable("re_transaction_clause_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("re_transaction_clause_requests_key_idx").on(table.idempotencyKey),
  index("re_transaction_clause_requests_lead_idx").on(table.leadId, table.createdAt),
]);
