import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { analysesTable } from "./analysis";

export const offersTable = pgTable("re_offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id,{onDelete:"cascade"}),
  analysisSnapshotId: uuid("analysis_snapshot_id").notNull().references(() => analysesTable.id,{onDelete:"cascade"}),
  status: text("status").notNull().default("DRAFT"),
  payload: jsonb("payload").$type<Record<string,unknown>>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt: timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t => [index("re_offers_lead_idx").on(t.leadId),index("re_offers_status_idx").on(t.status)]);
export type OfferRow = typeof offersTable.$inferSelect;