import { pgTable, uuid, text, jsonb, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const sellerPlaybookEntriesTable = pgTable("re_seller_playbook_entries", {
  slug: text("slug").primaryKey(),
  version: integer("version").notNull().default(1),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  sourceProvenance: jsonb("source_provenance").$type<Record<string, unknown>[]>().notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sellerPlaybookRevisionsTable = pgTable("re_seller_playbook_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().references(() => sellerPlaybookEntriesTable.slug, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  sourceProvenance: jsonb("source_provenance").$type<Record<string, unknown>[]>().notNull(),
  changeReason: text("change_reason").notNull(),
  actor: text("actor").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("re_seller_playbook_revision_version_idx").on(table.slug, table.version),
  index("re_seller_playbook_revision_slug_idx").on(table.slug, table.recordedAt),
]);
