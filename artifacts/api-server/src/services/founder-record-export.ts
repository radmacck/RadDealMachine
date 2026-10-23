import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  auditTable, buyersTable, db, propertyDiscoveriesTable, propertySourceObservationsTable,
} from "@workspace/db";
import { DomainError } from "@workspace/deal-domain";
import { sanitizeEvidenceExport, stableEvidenceJson } from "./evidence-packet";

type Actor = { id: string; role: string };
type ExportKind = "BUYER" | "PROPERTY";

function recordClass(payload: unknown): "SYNTHETIC" | "UNMARKED" {
  const value = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  return value.synthetic === true || value.fixture === true ? "SYNTHETIC" : "UNMARKED";
}

function exportEnvelope(kind: ExportKind, id: string, recordVersion: number, payload: unknown, snapshot: unknown) {
  return {
    format: "RADICAL_DEAL_PRIVATE_RECORD_EXPORT_V1",
    recordType: kind,
    recordId: id,
    recordVersion,
    exportedAt: new Date().toISOString(),
    recordClass: recordClass(payload),
    unmarkedIsNotProofOfRealData: true,
    verificationBoundary: "Stored labels and references only; export does not independently verify facts.",
    redactionLevel: "PRIVATE_FIELDS_REDACTED",
    snapshot: sanitizeEvidenceExport(snapshot, false),
  };
}

async function exportRecord(kind: ExportKind, id: string, actor: Actor) {
  if (actor.role !== "OWNER") throw new DomainError("Only the Owner can export private founder records.", 403);
  return db.transaction(async tx => {
    let sourcePayload: unknown;
    let recordVersion = 1;
    let snapshot: unknown;

    if (kind === "BUYER") {
      const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id, id)).for("update");
      if (!row) throw new DomainError("Buyer not found.", 404);
      sourcePayload = row.payload;
      recordVersion = row.version;
      const payload = { ...row.payload, name: "[REDACTED]" };
      snapshot = { id: row.id, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt, payload };
    } else {
      const [row] = await tx.select().from(propertyDiscoveriesTable)
        .where(eq(propertyDiscoveriesTable.id, id)).for("update");
      if (!row) throw new DomainError("Property discovery not found.", 404);
      sourcePayload = row.payload;
      recordVersion = row.version;
      const observations = await tx.select().from(propertySourceObservationsTable)
        .where(eq(propertySourceObservationsTable.discoveryId, id));
      snapshot = {
        id: row.id, version: row.version, marketKey: row.marketKey, status: row.status,
        score: row.score, confidence: row.confidence, createdAt: row.createdAt, updatedAt: row.updatedAt,
        payload: row.payload,
        sourceObservations: observations,
      };
    }

    const envelope = exportEnvelope(kind, id, recordVersion, sourcePayload, snapshot);
    const contentHash = createHash("sha256").update(stableEvidenceJson(envelope)).digest("hex");
    const result = { ...envelope, contentHash };
    await tx.insert(auditTable).values({
      actor: actor.id,
      action: "FOUNDER_RECORD_EXPORTED",
      entityId: id,
      detail: `${kind} private record export; version ${recordVersion}; redacted; sha256 ${contentHash}.`,
    });
    return result;
  });
}

export function exportBuyerRecord(id: string, actor: Actor) {
  return exportRecord("BUYER", id, actor);
}

export function exportPropertyDiscoveryRecord(id: string, actor: Actor) {
  return exportRecord("PROPERTY", id, actor);
}

export function classifyExportRecord(payload: unknown) {
  return recordClass(payload);
}
