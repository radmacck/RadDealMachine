import { pgTable, uuid, text, jsonb, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";

export const buyersTable = pgTable("re_buyers",{
  id:uuid("id").primaryKey().defaultRandom(),
  version:integer("version").notNull().default(1),
  payload:jsonb("payload").$type<Record<string,unknown>>().notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
});
export const contractsTable = pgTable("re_contracts",{
  id:uuid("id").primaryKey().defaultRandom(),
  leadId:uuid("lead_id").notNull().references(()=>leadsTable.id,{onDelete:"cascade"}),
  version:integer("version").notNull().default(1),
  payload:jsonb("payload").$type<Record<string,unknown>>().notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("re_contracts_lead_idx").on(t.leadId)]);
export const matchesTable = pgTable("re_buyer_matches",{
  id:uuid("id").primaryKey().defaultRandom(),
  leadId:uuid("lead_id").notNull().references(()=>leadsTable.id,{onDelete:"cascade"}),
  buyerId:uuid("buyer_id").notNull().references(()=>buyersTable.id,{onDelete:"cascade"}),
  payload:jsonb("payload").$type<Record<string,unknown>>().notNull(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("re_buyer_matches_pair_idx").on(t.leadId,t.buyerId)]);
export const jobsTable = pgTable("re_worker_jobs",{
  id:uuid("id").primaryKey().defaultRandom(),
  kind:text("kind").notNull(),
  payload:jsonb("payload").$type<Record<string,unknown>>().notNull().default({}),
  state:text("state").notNull().default("QUEUED"),
  leadId:uuid("lead_id").references(()=>leadsTable.id,{onDelete:"cascade"}),
  idempotencyKey:text("idempotency_key").notNull(),
  requestedBy:text("requested_by").notNull(),
  message:text("message").notNull().default("Waiting for worker"),
  attempts:integer("attempts").notNull().default(0),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("re_worker_jobs_key_idx").on(t.idempotencyKey),index("re_worker_jobs_state_idx").on(t.state)]);