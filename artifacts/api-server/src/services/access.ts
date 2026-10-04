import { eq, sql } from "drizzle-orm";
import { db, membersTable, auditTable } from "@workspace/db";
import { DomainError } from "@workspace/deal-domain";
import { GetAccessResponse, UpdateMemberBody, UpdateMemberResponse, ListMembersResponse } from "@workspace/api-zod";
import type { z } from "zod";

export async function getAccess(userId: string) {
  await db.insert(membersTable).values({id:userId}).onConflictDoNothing();
  const [[member], owners] = await Promise.all([
    db.select().from(membersTable).where(eq(membersTable.id,userId)),
    db.select({id:membersTable.id}).from(membersTable).where(eq(membersTable.role,"OWNER")).limit(1),
  ]);
  return GetAccessResponse.parse({userId,role:member?.role ?? "PENDING",unclaimed:!owners.length});
}
/** First owner must explicitly claim before sharing the app. One claim, serialized across instances. */
export async function claimWorkspace(userId: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(814923701)`);
    const owners = await tx.select().from(membersTable).where(eq(membersTable.role,"OWNER")).limit(1);
    if (owners.length) throw new DomainError("Workspace has already been claimed. Ask its owner to approve your access.",409);
    await tx.insert(membersTable).values({id:userId,role:"OWNER"})
      .onConflictDoUpdate({target:membersTable.id,set:{role:"OWNER"}});
    await tx.insert(auditTable).values({actor:userId,action:"WORKSPACE_CLAIMED",entityId:"workspace",detail:"First authenticated owner explicitly claimed workspace. New accounts require owner approval."});
  });
  return getAccess(userId);
}
export async function listMembers() {
  const rows = await db.select().from(membersTable).orderBy(membersTable.createdAt);
  return ListMembersResponse.parse(rows.map(r => ({...r,createdAt:r.createdAt.toISOString()})));
}
export async function updateMember(id: string, input: z.infer<typeof UpdateMemberBody>, actor: string) {
  return db.transaction(async tx => {
    const [member] = await tx.select().from(membersTable).where(eq(membersTable.id,id)).for("update");
    if (!member) throw new DomainError("Member not found. Have the team member sign in first, then approve their pending account.",404);
    if (member.role === "OWNER") throw new DomainError("The workspace owner cannot be demoted by this operation.",409);
    const [updated] = await tx.update(membersTable).set({role:input.role}).where(eq(membersTable.id,id)).returning();
    if (!updated) throw new Error("Member update failed");
    await tx.insert(auditTable).values({actor,action:"MEMBERSHIP_UPDATED",entityId:id,detail:`Role ${member.role} → ${input.role}`});
    return UpdateMemberResponse.parse({...updated,createdAt:updated.createdAt.toISOString()});
  });
}