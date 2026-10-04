import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db,pool,buyersTable,auditTable,jobsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { createBuyer, updateBuyer, verifyBuyer } from "./buyer-store";
import { getBuyerRecord } from "./operations-records";
const actor = {id:`synthetic-buyer-exercise:${randomUUID()}`,role:"OWNER"};
let id: string|undefined;
try {
  const buyer = await createBuyer({name:"SYNTHETIC BUYER EXERCISE ONLY",email:"synthetic@example.com",phone:"",
    source:"Synthetic database exercise, not real proof",status:"ACTIVE",
    criteria:{states:["TX"],cities:["Synthetic City"],zipCodes:[],propertyTypes:["SINGLE_FAMILY"],
      maxPurchasePrice:200000,maxRepairs:50000,minBeds:2,minSqft:500,maxSqft:2000,closingDays:3}},actor);
  id = buyer.id;
  assert.equal(buyer.verificationStatus,"UNVERIFIED");
  assert.equal((await getBuyerRecord(id)).name,buyer.name);
  const now = new Date();
  const verification = {version:buyer.version,identityEvidenceUrl:"https://example.com/synthetic-identity",
    fundingEvidenceUrl:"https://example.com/synthetic-funds",verificationNote:"SYNTHETIC TEST only, not actual proof.",
    availableFunds:200000,evidenceAt:now.toISOString(),validUntil:new Date(now.getTime()+10*86400000).toISOString()};
  await assert.rejects(verifyBuyer(id,verification,{...actor,role:"OPERATOR"},now),e=>(e as {status:number}).status===403);
  const verified = await verifyBuyer(id,verification,actor,now);
  assert.equal(verified.verificationStatus,"VERIFIED");
  await assert.rejects(verifyBuyer(id,verification,actor,now),e=>(e as {status:number}).status===409);
  assert.equal((await getBuyerRecord(id,db,new Date(now.getTime()+11*86400000))).verificationStatus,"STALE");
  const updated = await updateBuyer(id,{...buyer,version:verified.version,name:"SYNTHETIC REVISED IDENTITY"},actor);
  assert.equal(updated.verificationStatus,"UNVERIFIED");
  assert.ok((await db.select().from(jobsTable).where(eq(jobsTable.requestedBy,actor.id))).length>=3);
  logger.info({checks:"create/reload, owner-only verification, dated funding, stale evidence, version conflict, identity invalidation, queued matching"},"Buyer persistence exercise PASSED (synthetic data)");
} finally {
  if (id) await db.delete(buyersTable).where(eq(buyersTable.id,id));
  await db.delete(jobsTable).where(eq(jobsTable.requestedBy,actor.id));
  await db.delete(auditTable).where(eq(auditTable.actor,actor.id));
  await pool.end();
}