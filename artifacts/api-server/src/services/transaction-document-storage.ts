import { eq } from "drizzle-orm";
import { transactionDocumentBlobsTable } from "@workspace/db";
import type { Store } from "./operations-records";

export interface TransactionDocumentBinaryStore {
  readonly mode: "PERSISTENT_DATABASE_BLOB";
  put(
    database: Store,
    input: {
      documentId: string;
      leadId: string;
      bytes: Buffer;
      contentType: string;
      contentHash: string;
      createdBy: string;
      createdAt: Date;
    },
  ): Promise<void>;
  get(database: Store, documentId: string): Promise<{
    bytes: Buffer;
    contentType: string;
    contentHash: string;
    sizeBytes: number;
  } | null>;
}

/**
 * Persistent and server-only, but intentionally reported as a DB fallback:
 * managed private object storage was not provisioned in this workspace.
 */
export const transactionDocumentBinaryStore: TransactionDocumentBinaryStore = {
  mode: "PERSISTENT_DATABASE_BLOB",
  async put(database, input) {
    await database.insert(transactionDocumentBlobsTable).values({
      documentId: input.documentId,
      leadId: input.leadId,
      content: input.bytes,
      contentType: input.contentType,
      contentHash: input.contentHash,
      sizeBytes: input.bytes.byteLength,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    });
  },
  async get(database, documentId) {
    const [row] = await database.select().from(transactionDocumentBlobsTable)
      .where(eq(transactionDocumentBlobsTable.documentId, documentId));
    return row ? {
      bytes: Buffer.from(row.content),
      contentType: row.contentType,
      contentHash: row.contentHash,
      sizeBytes: row.sizeBytes,
    } : null;
  },
};
