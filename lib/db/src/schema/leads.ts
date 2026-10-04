import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const leadsTable = pgTable("re_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  stage: text("stage").notNull().default("DISCOVERED"),
  version: integer("version").notNull().default(1),
  nextAction: text("next_action").notNull(),
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  underwriting: jsonb("underwriting").$type<Record<string, unknown>>(),
  analysis: jsonb("analysis").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("re_leads_stage_idx").on(t.stage), index("re_leads_follow_up_idx").on(t.followUpAt)]);
export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type LeadRow = typeof leadsTable.$inferSelect;