import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { leadsTable } from "./leads";
export const transitionsTable = pgTable("re_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  from: text("from_stage").notNull(),
  to: text("to_stage").notNull(),
  reason: text("reason").notNull(),
  nextAction: text("next_action").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("re_transitions_lead_idx").on(t.leadId)]);
export const insertTransitionSchema = createInsertSchema(transitionsTable).omit({ id: true, createdAt: true });