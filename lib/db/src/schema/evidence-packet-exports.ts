import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";

export const evidencePacketExportsTable=pgTable("re_evidence_packet_exports",{
  id:uuid("id").primaryKey().defaultRandom(),
  leadId:uuid("lead_id").notNull().references(()=>leadsTable.id,{onDelete:"cascade"}),
  version:integer("version").notNull(),
  contentHash:text("content_hash").notNull(),
  generatedBy:text("generated_by").notNull(),
  purpose:text("purpose").notNull(),
  redactionLevel:text("redaction_level").notNull(),
  snapshot:jsonb("snapshot").$type<Record<string,unknown>>().notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},table=>[uniqueIndex("re_evidence_packet_exports_lead_version_uq").on(table.leadId,table.version)]);
