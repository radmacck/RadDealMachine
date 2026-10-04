import { pgTable, uuid, jsonb, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { leadsTable } from "./leads";
export const intelligenceTable = pgTable("re_intelligence", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("re_intelligence_lead_idx").on(t.leadId)]);
export const insertIntelligenceSchema = createInsertSchema(intelligenceTable).omit({ id: true, createdAt: true });