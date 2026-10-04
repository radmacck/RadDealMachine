import { pgTable, uuid, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { leadsTable } from "./leads";
export const analysesTable = pgTable("re_analysis_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertAnalysisSchema = createInsertSchema(analysesTable).omit({ id: true, createdAt: true });