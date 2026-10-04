import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const membersTable = pgTable("re_members", {
  id: text("id").primaryKey(),
  role: text("role").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const settingsTable = pgTable("re_settings", {
  id: integer("id").primaryKey(),
  assumptions: jsonb("assumptions").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertMemberSchema = createInsertSchema(membersTable).omit({ createdAt: true });