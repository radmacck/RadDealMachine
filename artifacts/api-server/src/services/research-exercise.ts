import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db,pool,intelligenceTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { createLead,leadDetail } from "./deal-store";
import { submitWorkerJob,runWorkerOnce } from "./workers";
const actor = {id:`synthetic-research:${randomUUID()}`,role:"OWNER"};
try {
  const lead = await createLead({address:"1600 Pennsylvania Avenue NW",city:"Washington",state:"DC",
    county:"District of Columbia",zip:"20500",propertyType:"OTHER",sqft:0,beds:0,baths:0,units:1,
    sellerName:"SYNTHETIC NON-SELLER",source:"Isolated synthetic exercise with a public government address. NOT a property for sale.",
    sellerDescription:"Synthetic scenario only: no condition, ownership or seller-motive facts are established."},actor.id);
  const geo = await submitWorkerJob({kind:"ENRICH_PROPERTY",leadId:lead.id,idempotencyKey:"synthetic-live-public-source"},actor);
  const geoResult = await runWorkerOnce(new Date(),false,geo.id);
  assert.equal(geoResult?.state,"SUCCEEDED",geoResult?.message);
  const ai = await submitWorkerJob({kind:"PREPARE_BRIEF",leadId:lead.id,idempotencyKey:"synthetic-live-ai-preparation"},actor);
  const aiResult = await runWorkerOnce(new Date(),false,ai.id);
  assert.equal(aiResult?.state,"SUCCEEDED",aiResult?.message);
  let detail = await leadDetail(lead.id);
  const hypotheses = detail.intelligence.filter(e=>e.sourceType==="MODEL");
  assert.ok(hypotheses.length>=1&&hypotheses.length<=3);
  assert.ok(hypotheses.every(e=>e.classification==="AI_HYPOTHESIS"&&e.confidence<1&&e.question&&e.action));
  assert.ok(detail.intelligence.some(e=>e.classification==="OBSERVED"&&e.sourceUrl?.startsWith("https://geocoding.geo.census.gov/")));
  assert.equal(detail.analysis,null); assert.equal(detail.offers.length,0);
  const count = (await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,lead.id))).length;
  const {prepareSellerBrief} = await import("./research-worker");
  await prepareSellerBrief(lead.id,ai.id);
  assert.equal((await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,lead.id))).length,count);
  for (let i=0;i<5;i++) {
    const queued = await submitWorkerJob({kind:"PREPARE_BRIEF",leadId:lead.id,idempotencyKey:`synthetic-budget-${i}`},actor);
    assert.equal(queued.state,"QUEUED");
  }
  const capped = await submitWorkerJob({kind:"PREPARE_BRIEF",leadId:lead.id,idempotencyKey:"synthetic-budget-overflow"},actor);
  assert.equal(capped.state,"FAILED");
  assert.match(capped.message,/Daily AI budget/);
  assert.equal(capped.attempts,0);
  logger.info({checks:"real Census fetch and persisted source; real managed OpenAI call and validated persisted hypotheses/questions; no promotion, calculations, offer or external contact; repeated-job cached output"},"Prepared intelligence exercise PASSED (isolated synthetic schema, real external calls)");
} finally {await pool.end();}