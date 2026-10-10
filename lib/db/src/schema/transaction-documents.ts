import { pgTable, uuid, text, jsonb, integer, timestamp, customType, uniqueIndex, index } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Registry entries describe which transaction documents are configured.
 * Legal templates remain unavailable until an approved template and its
 * evidence are actually registered; these rows never contain legal language.
 */
export const transactionDocumentTemplatesTable = pgTable("re_transaction_document_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateKey: text("template_key").notNull(),
  documentKind: text("document_kind").notNull(),
  jurisdiction: text("jurisdiction").notNull().default("US/UNSPECIFIED"),
  status: text("status").notNull(),
  version: integer("version").notNull().default(1),
  requiredFields: jsonb("required_fields").$type<string[]>().notNull().default([]),
  templateStorageRef: text("template_storage_ref"),
  templateHash: text("template_hash"),
  approvalEvidenceRef: text("approval_evidence_ref"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  sourceRef: text("source_ref"),
  sourceProvenance: jsonb("source_provenance").$type<Record<string, unknown> | null>(),
  reviewState: text("review_state").notNull().default("NOT_REVIEWED"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewerQualificationRef: text("reviewer_qualification_ref"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  supportedDealTypes: jsonb("supported_deal_types").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("re_transaction_document_templates_key_jurisdiction_idx").on(t.templateKey, t.jurisdiction),
  index("re_transaction_document_templates_status_idx").on(t.status),
]);

/**
 * Persistent, server-only binary store. It is a database-backed fallback, not
 * a claim that managed private object storage is configured.
 */
export const transactionDocumentBlobsTable = pgTable("re_transaction_document_blobs", {
  documentId: uuid("document_id").primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  content: bytea("content").notNull(),
  contentType: text("content_type").notNull(),
  contentHash: text("content_hash").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("re_transaction_document_blobs_lead_idx").on(t.leadId),
]);
