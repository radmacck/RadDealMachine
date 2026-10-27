import { eq, sql, and, ne } from "drizzle-orm";
import { db, membersTable, auditTable, buyersTable } from "@workspace/db";
import { DomainError } from "@workspace/deal-domain";
import { buyerRecord } from "./operations-records";
import { GetAccessResponse, UpdateMemberBody, UpdateMemberResponse, ListMembersResponse } from "@workspace/api-zod";
import type { z } from "zod";

type AccessDatabase = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getAccess(userId: string, database: AccessDatabase = db) {
  await database.insert(membersTable).values({id:userId}).onConflictDoNothing();
  const [member] = await database.select().from(membersTable).where(eq(membersTable.id,userId));
  const owners = await database.select({id:membersTable.id}).from(membersTable).where(eq(membersTable.role,"OWNER")).limit(1);
  return GetAccessResponse.parse({userId,role:member?.role ?? "PENDING",unclaimed:!owners.length,finderId:member?.role==="FINDER"?member.finderId:null});
}
/** First owner is explicitly configured; claim is serialized across instances. */
export async function claimWorkspace(
  userId: string,
  database: AccessDatabase = db,
  initialOwnerUserId = process.env.INITIAL_WORKSPACE_OWNER_USER_ID,
) {
  const configuredOwnerId = initialOwnerUserId?.trim();
  if (!configuredOwnerId) {
    throw new DomainError("First-owner claim is disabled until INITIAL_WORKSPACE_OWNER_USER_ID is configured.",503);
  }
  if (userId !== configuredOwnerId) {
    throw new DomainError("This authenticated account is not configured as the initial workspace owner.",403);
  }
  await database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(814923701)`);
    const owners = await tx.select().from(membersTable).where(eq(membersTable.role,"OWNER")).limit(1);
    if (owners.length) throw new DomainError("Workspace has already been claimed. Ask its owner to approve your access.",409);
    await tx.insert(membersTable).values({id:userId,role:"OWNER"})
      .onConflictDoUpdate({target:membersTable.id,set:{role:"OWNER"}});
    await tx.insert(auditTable).values({actor:userId,action:"WORKSPACE_CLAIMED",entityId:"workspace",detail:"First authenticated owner explicitly claimed workspace. New accounts require owner approval."});
  });
  return getAccess(userId,database);
}
export async function listMembers() {
  const rows = await db.select().from(membersTable).orderBy(membersTable.createdAt);
  return ListMembersResponse.parse(rows.map(r => ({...r,finderId:r.role==="FINDER"?r.finderId:null,createdAt:r.createdAt.toISOString()})));
}
export async function updateMember(id: string, input: z.infer<typeof UpdateMemberBody>, actor: string, database: AccessDatabase = db) {
  const parsed = UpdateMemberBody.safeParse(input);
  if (!parsed.success) throw new DomainError("Choose a valid team role. Ownership is granted only by the first-owner claim mechanism.",400);
  return database.transaction(async tx => {
    const [owner] = await tx.select().from(membersTable).where(eq(membersTable.id,actor)).for("update");
    if (owner?.role !== "OWNER") throw new DomainError("Only the workspace owner can approve or change team access.",403);
    const [member] = await tx.select().from(membersTable).where(eq(membersTable.id,id)).for("update");
     if (!member) throw new DomainError("Member not found. Have the team member sign in first, then approve their pending account.",404);
    if (member.role === "OWNER") throw new DomainError("The workspace owner cannot be demoted by this operation.",409);
     const finderId = parsed.data.role === "FINDER" ? parsed.data.finderId : null;
     if (parsed.data.role === "FINDER" && !finderId) throw new DomainError("Select the registered finder profile to bind to this account.",400);
     if (finderId) {
       const [finderRow] = await tx.select().from(buyersTable).where(eq(buyersTable.id,finderId));
       if (!finderRow || !["DEAL_FINDER","GURU"].includes(buyerRecord(finderRow).destinationKind))
         throw new DomainError("Finder accounts can only be bound to a registered deal-finder or guru destination.",409);
       const [other] = await tx.select().from(membersTable).where(and(eq(membersTable.finderId,finderId),ne(membersTable.id,id)));
       if (other) throw new DomainError("That finder profile is already bound to another account.",409);
     }
     const [updated] = await tx.update(membersTable).set({role:parsed.data.role,finderId}).where(eq(membersTable.id,id)).returning();
    if (!updated) throw new Error("Member update failed");
     await tx.insert(auditTable).values({actor,action:"MEMBERSHIP_UPDATED",entityId:id,detail:`Role ${member.role} → ${input.role}; finder binding ${member.finderId ?? "none"} → ${finderId ?? "none"}.`});
     return UpdateMemberResponse.parse({...updated,finderId:updated.role==="FINDER"?updated.finderId:null,createdAt:updated.createdAt.toISOString()});
  });
}