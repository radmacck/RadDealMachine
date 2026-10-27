import { pgTable, text, timestamp, integer, jsonb, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { buyersTable } from "./operations";
export const membersTable = pgTable("re_members", {
  id: text("id").primaryKey(),
  role: text("role").notNull().default("PENDING"),
  finderId: uuid("finder_id").references(() => buyersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("re_members_finder_id_uq").on(t.finderId)]);
export const settingsTable = pgTable("re_settings", {
  id: integer("id").primaryKey(),
  assumptions: jsonb("assumptions").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertMemberSchema = createInsertSchema(membersTable).omit({ createdAt: true });