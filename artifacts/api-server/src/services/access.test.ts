import test, { after } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { db, pool, membersTable, auditTable } from "@workspace/db";
import { getAccess, claimWorkspace, updateMember } from "./access";
import { createAuthenticatedMiddleware, roles, sensitiveWorkspaceData } from "../middlewares/access";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Real PostgreSQL, isolated per connection with temporary shadow tables.
 * No real owner, member or audit record is added, edited, deleted or claimed.
 * Temp tables automatically disappear at transaction end.
 */
async function isolated(run: (tx: Tx) => Promise<void>) {
  await db.transaction(async tx => {
    await tx.execute(sql`create temporary table re_members (like public.re_members including all) on commit drop`);
    await tx.execute(sql`create temporary table re_audit (like public.re_audit including all) on commit drop`);
    await run(tx);
  });
}
after(async () => { await pool.end(); });

test("signing in creates pending membership, never automatic ownership",async () => {
  await isolated(async tx => {
    const access = await getAccess("synthetic-owner-candidate",tx);
    assert.deepEqual(access,{userId:"synthetic-owner-candidate",role:"PENDING",unclaimed:true,finderId:null});
    assert.equal((await tx.select().from(auditTable)).length,0);
    assert.deepEqual(await getAccess("synthetic-owner-candidate",tx),access);
  });
});
test("explicit first-owner claim persists and audits only the authenticated caller",async () => {
  await isolated(async tx => {
    await getAccess("synthetic-owner-candidate",tx);
    const claimed = await claimWorkspace("synthetic-owner-candidate",tx,"synthetic-owner-candidate");
    assert.equal(claimed.role,"OWNER");
    assert.equal(claimed.unclaimed,false);
    const audits = await tx.select().from(auditTable);
    assert.equal(audits.length,1);
    assert.equal(audits[0]!.actor,"synthetic-owner-candidate");
    assert.equal(audits[0]!.action,"WORKSPACE_CLAIMED");
  });
});
test("another user cannot take over a claimed workspace or repeat its claim",async () => {
  await isolated(async tx => {
    await claimWorkspace("synthetic-owner-candidate",tx,"synthetic-owner-candidate");
    await assert.rejects(claimWorkspace("synthetic-second-account",tx,"synthetic-owner-candidate"),e => (e as {status:number}).status===403);
    await assert.rejects(claimWorkspace("synthetic-owner-candidate",tx,"synthetic-owner-candidate"),e => (e as {status:number}).status===409);
    assert.equal((await getAccess("synthetic-second-account",tx)).role,"PENDING");
    assert.equal((await tx.select().from(auditTable)).length,1);
  });
});
test("only owner can approve teammate roles, including below the HTTP boundary",async () => {
  await isolated(async tx => {
    await claimWorkspace("synthetic-owner-candidate",tx,"synthetic-owner-candidate");
    await getAccess("synthetic-teammate",tx);
    await assert.rejects(updateMember("synthetic-teammate",{role:"ANALYST"},"synthetic-teammate",tx),e => (e as {status:number}).status===403);
    const approved = await updateMember("synthetic-teammate",{role:"OPERATOR"},"synthetic-owner-candidate",tx);
    assert.equal(approved.role,"OPERATOR");
    assert.equal((await getAccess("synthetic-teammate",tx)).unclaimed,false);
    await assert.rejects(updateMember("synthetic-teammate",{role:"ANALYST"},"synthetic-teammate",tx),e => (e as {status:number}).status===403);
    const audited = await tx.select().from(auditTable).where(eq(auditTable.action,"MEMBERSHIP_UPDATED"));
    assert.equal(audited.length,1);
    assert.equal(audited[0]!.actor,"synthetic-owner-candidate");
  });
});
test("membership editing cannot create another owner or demote the first owner",async () => {
  await isolated(async tx => {
    await claimWorkspace("synthetic-owner-candidate",tx,"synthetic-owner-candidate");
    await getAccess("synthetic-teammate",tx);
    await assert.rejects(updateMember("synthetic-owner-candidate",{role:"VIEWER"},"synthetic-owner-candidate",tx),e => (e as {status:number}).status===409);
    await assert.rejects(updateMember("synthetic-teammate",{role:"OWNER" as "OPERATOR"},"synthetic-owner-candidate",tx),e => (e as {status:number}).status===400);
    assert.equal((await getAccess("synthetic-owner-candidate",tx)).role,"OWNER");
    assert.equal((await getAccess("synthetic-teammate",tx)).role,"PENDING");
  });
});
test("revoked teammate access returns to pending without changing workspace ownership",async () => {
  await isolated(async tx => {
    await claimWorkspace("synthetic-owner-candidate",tx,"synthetic-owner-candidate");
    await getAccess("synthetic-teammate",tx);
    await updateMember("synthetic-teammate",{role:"OPERATOR"},"synthetic-owner-candidate",tx);
    await updateMember("synthetic-teammate",{role:"PENDING"},"synthetic-owner-candidate",tx);
    assert.equal((await getAccess("synthetic-teammate",tx)).role,"PENDING");
    assert.equal((await getAccess("synthetic-owner-candidate",tx)).role,"OWNER");
  });
});

test("first-owner claim fails closed without the configured identity and denies other authenticated users",async () => {
  await isolated(async tx => {
    await assert.rejects(claimWorkspace("synthetic-attacker",tx,""),e => (e as {status:number}).status===503);
    await assert.rejects(claimWorkspace("synthetic-attacker",tx,"synthetic-owner-candidate"),e => (e as {status:number}).status===403);
    assert.equal((await tx.select().from(membersTable)).length,0);
    assert.equal((await tx.select().from(auditTable)).length,0);
    const claimed = await claimWorkspace("synthetic-owner-candidate",tx,"synthetic-owner-candidate");
    assert.equal(claimed.role,"OWNER");
  });
});
test("owner-only role middleware rejects pending, viewer, analyst and operator",() => {
  for (const role of ["PENDING","VIEWER","ANALYST","OPERATOR","OWNER"]) {
    let status: number|undefined;
    let continued = false;
    const res = {
      locals:{role},status(n:number) { status=n; return this; },json(_value:unknown) { return this; },
    } as unknown as Response;
    roles("OWNER")({} as Request,res,() => { continued=true; });
    assert.equal(continued,role==="OWNER");
    assert.equal(status,role==="OWNER"?undefined:403);
  }
});

test("finder portal routes admit only the approved finder role; operators use internal routes instead",() => {
  for (const role of ["PENDING","VIEWER","ANALYST","OPERATOR","OWNER","FINDER"]) {
    let status: number|undefined;
    let continued = false;
    const res = {
      locals:{role},status(n:number) { status=n; return this; },json(_value:unknown) { return this; },
    } as unknown as Response;
    roles("FINDER")({} as Request,res,() => {continued=true;});
    assert.equal(continued,role==="FINDER",`${role} cannot use the limited finder portal route.`);
    assert.equal(status,role==="FINDER"?undefined:403);
  }
});

test("call logging and follow-up middleware permits only owner and operator roles",() => {
  for (const role of ["PENDING","VIEWER","ANALYST","OPERATOR","OWNER"]) {
    let status: number|undefined;
    let continued = false;
    const res = {
      locals:{role},status(n:number) { status=n; return this; },json(_value:unknown) { return this; },
    } as unknown as Response;
    roles("OWNER","OPERATOR")({} as Request,res,() => { continued=true; });
    const allowed = role==="OWNER"||role==="OPERATOR";
    assert.equal(continued,allowed,`${role} call/follow-up access must match the route's operation roles.`);
    assert.equal(status,allowed?undefined:403);
  }
});

test("sensitive contact, property, finance and transaction routes deny viewer before any payload handler runs", () => {
  for (const role of ["PENDING","VIEWER","FINDER","ANALYST","OPERATOR","OWNER"]) {
    let status: number|undefined;
    let responseBody: unknown;
    const res = {
      locals:{role},status(n:number) { status=n; return this; },
      json(value:unknown) { responseBody=value; return this; },
    } as unknown as Response;
    let continued = false;
    sensitiveWorkspaceData({} as Request,res,() => { continued=true; });
    const allowed = ["OWNER","ANALYST","OPERATOR"].includes(role);
    assert.equal(continued,allowed,`${role} must not reach a sensitive response handler unless explicitly allowed.`);
    assert.equal(status,allowed?undefined:403);
    assert.deepEqual(responseBody,allowed?undefined:{error:"Your role is not permitted to perform this action."});
  }
});

test("unauthenticated requests stop before finder authorization", () => {
  let status: number|undefined;
  let body: unknown;
  let continued = false;
  const res = {
    locals:{}, status(n:number) {status=n; return this;}, json(value:unknown) {body=value; return this;},
  } as unknown as Response;
  createAuthenticatedMiddleware(() => null)({} as Request,res,() => {continued=true;});
  assert.equal(status,401);
  assert.equal(continued,false);
  assert.deepEqual(body,{error:"Sign in to access the internal operating system."});
});