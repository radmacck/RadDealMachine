import { desc, eq } from "drizzle-orm";
import {
  db,
  sellerPlaybookEntriesTable,
  sellerPlaybookRevisionsTable,
  auditTable,
} from "@workspace/db";
import {
  DomainError,
  SELLER_NEGOTIATION_PLAYBOOK_SEEDS,
  evaluateSellerPlaybookRelevance,
  type SellerPlaybookContent,
  type SellerPlaybookEvidence,
  type SellerPlaybookSource,
} from "@workspace/deal-domain";
import { leadDetail, audit } from "./deal-store";

type EditableContent = Omit<SellerPlaybookContent, "kind" | "matchTerms">;
type EntryRow = typeof sellerPlaybookEntriesTable.$inferSelect;
type RevisionRow = typeof sellerPlaybookRevisionsTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function asJsonObject(value: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function asSources(value: unknown): SellerPlaybookSource[] {
  return Array.isArray(value) ? value as SellerPlaybookSource[] : [];
}

function asContent(value: unknown): SellerPlaybookContent {
  return value as SellerPlaybookContent;
}

async function seedLibrary(tx: Tx) {
  for (const seed of SELLER_NEGOTIATION_PLAYBOOK_SEEDS) {
    const sourceProvenance = seed.sourceProvenance.map((item) => ({ ...item }));
    const [inserted] = await tx.insert(sellerPlaybookEntriesTable).values({
      slug: seed.slug,
      version: 1,
      content: asJsonObject(seed.content),
      sourceProvenance: sourceProvenance as unknown as Record<string, unknown>[],
      updatedBy: "SYSTEM_SEED",
    }).onConflictDoNothing().returning();
    if (!inserted) continue;
    await tx.insert(sellerPlaybookRevisionsTable).values({
      slug: seed.slug,
      version: 1,
      content: asJsonObject(seed.content),
      sourceProvenance: sourceProvenance as unknown as Record<string, unknown>[],
      changeReason: "Initial original guidance library; public references support listening/question methods only.",
      actor: "SYSTEM_SEED",
    });
    await audit(tx, "SYSTEM_SEED", "SELLER_PLAYBOOK_SEEDED", `seller-playbook:${seed.slug}`,
      "Version 1 created from original, non-legal conversation guidance and recorded public-source references.");
  }
}

async function ensureLibrary() {
  await db.transaction(seedLibrary);
}

function responseEntry(
  row: EntryRow,
  revisions: RevisionRow[],
  evidence: SellerPlaybookEvidence[],
) {
  const content = asContent(row.content);
  return {
    slug: row.slug,
    version: row.version,
    content,
    sourceProvenance: asSources(row.sourceProvenance),
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
    revisions: revisions.map((revision) => ({
      version: revision.version,
      changeReason: revision.changeReason,
      actor: revision.actor,
      recordedAt: revision.recordedAt.toISOString(),
    })),
    relevance: evaluateSellerPlaybookRelevance(content, evidence),
  };
}

export async function getSellerPlaybook(leadId: string) {
  const detail = await leadDetail(leadId);
  await ensureLibrary();
  const rows = await db.select().from(sellerPlaybookEntriesTable).orderBy(sellerPlaybookEntriesTable.slug);
  const evidence: SellerPlaybookEvidence[] = detail.intelligence.map((item) => ({
    id: item.id,
    category: item.category,
    statement: item.statement,
    sourceType: item.sourceType,
    classification: item.classification,
  }));
  const entries = [];
  for (const row of rows) {
    const revisions = await db.select().from(sellerPlaybookRevisionsTable)
      .where(eq(sellerPlaybookRevisionsTable.slug, row.slug))
      .orderBy(desc(sellerPlaybookRevisionsTable.version))
      .limit(20);
    entries.push(responseEntry(row, revisions.reverse(), evidence));
  }
  return { leadId, entries };
}

export async function updateSellerPlaybookEntry(
  leadId: string,
  slug: string,
  expectedVersion: number,
  changeReason: string,
  editableContent: EditableContent,
  actor: string,
) {
  await leadDetail(leadId);
  await ensureLibrary();
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(sellerPlaybookEntriesTable)
      .where(eq(sellerPlaybookEntriesTable.slug, slug))
      .for("update");
    if (!current) throw new DomainError("Seller playbook entry not found.", 404);
    if (current.version !== expectedVersion) {
      throw new DomainError("This playbook entry changed in another session. Reload before editing.", 409);
    }
    const nextVersion = current.version + 1;
    const content = {
      ...asContent(current.content),
      ...editableContent,
    };
    const sourceProvenance = asSources(current.sourceProvenance);
    const [updated] = await tx.update(sellerPlaybookEntriesTable)
      .set({
        version: nextVersion,
        content: asJsonObject(content),
        updatedBy: actor,
        updatedAt: new Date(),
      })
      .where(eq(sellerPlaybookEntriesTable.slug, slug))
      .returning();
    if (!updated) throw new Error("Seller playbook update was not persisted.");
    await tx.insert(sellerPlaybookRevisionsTable).values({
      slug,
      version: nextVersion,
      content: asJsonObject(content),
      sourceProvenance: sourceProvenance as unknown as Record<string, unknown>[],
      changeReason,
      actor,
    });
    await audit(tx, actor, "SELLER_PLAYBOOK_REVISED", `seller-playbook:${slug}`,
      `Version ${nextVersion}; reason: ${changeReason}. Existing source references were preserved; no lead or economics record was changed.`);
  });
  const [row] = await db.select().from(sellerPlaybookEntriesTable)
    .where(eq(sellerPlaybookEntriesTable.slug, slug));
  if (!row) throw new Error("Updated playbook entry could not be reloaded.");
  const revisions = await db.select().from(sellerPlaybookRevisionsTable)
    .where(eq(sellerPlaybookRevisionsTable.slug, slug))
    .orderBy(desc(sellerPlaybookRevisionsTable.version))
    .limit(20);
  const detail = await leadDetail(leadId);
  const evidence: SellerPlaybookEvidence[] = detail.intelligence.map((item) => ({
    id: item.id,
    category: item.category,
    statement: item.statement,
    sourceType: item.sourceType,
    classification: item.classification,
  }));
  return responseEntry(row, revisions.reverse(), evidence);
}
