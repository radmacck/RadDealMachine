import assert from "node:assert/strict";
import { db, leadsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { commandCenter } from "./command-center";
import { addPropertyRelevanceSignal, recordPropertyObservation } from "./property-discovery-store";
import type { PublicProperty } from "@workspace/property-sources";

const now = new Date("2026-10-05T14:00:00.000Z");
const [lead] = await db.insert(leadsTable).values({
  payload:{
    address:"100 SYNTHETIC AVENUE",city:"Test City",state:"TX",county:"Test County",zip:"75001",
    propertyType:"SINGLE_FAMILY",sqft:1200,beds:3,baths:2,units:1,
    sellerName:"Synthetic Seller",sellerPhone:"555-0100",source:"Synthetic command-center exercise",
  },
  stage:"DISCOVERED",version:1,nextAction:"Review the sourced property record.",
  followUpAt:new Date("2026-10-07T14:00:00.000Z"),createdAt:now,updatedAt:now,
}).returning();
if (!lead) throw new Error("Could not create isolated command-center fixture.");

const discovery = await recordPropertyObservation({
  id: "SYNTHETIC-COMMAND-DISCOVERY",
  provider: "SYNTHETIC command-center source",
  classification: "OBSERVED",
  address: "101 SYNTHETIC AVENUE",
  city: "Philadelphia",
  state: "PA",
  zip: "19103",
  propertyType: "TOWNHOUSE",
  sqft: 1200,
  beds: 3,
  baths: 2,
  recordedOwner: null,
  entityCandidate: false,
  assessedValue: null,
  lastSalePrice: null,
  lastSaleAt: null,
  interiorCondition: null,
  exteriorCondition: null,
  lat: null,
  lng: null,
  sourceUrl: "https://example.com/synthetic-command-discovery",
  capturedAt: now.toISOString(),
} satisfies PublicProperty, "synthetic-command-center:SYNTHETIC-COMMAND-DISCOVERY", "synthetic-owner", now);
const candidate = await addPropertyRelevanceSignal(discovery.id, {
  version: discovery.version,
  key: "SELLER_MOTIVATION",
  group: "MOTIVATION",
  classification: "INDICATED",
  sourceType: "SELLER",
  statement: "SYNTHETIC fixture: seller asked about timing; not a real seller statement.",
  source: "SYNTHETIC command-center test",
  sourceUrl: "https://example.com/synthetic-seller-statement",
  evidenceRef: "synthetic:command-center:seller-note",
  capturedAt: now.toISOString(),
  confidence: 0.8,
}, { id: "synthetic-reviewer", role: "OWNER" }, now);
assert.equal(candidate.status, "RELEVANT_CANDIDATE");

const analystView = await commandCenter("ANALYST",now);
const candidateActions = analystView.actions.filter((action) => action.category === "DISCOVERY_REVIEW");
assert.equal(candidateActions.length, 1);
assert.equal(candidateActions[0]?.href, `/sources?discovery=${candidate.id}`);
assert.match(candidateActions[0]?.reason ?? "", /motivation|seller/i);
assert.equal(analystView.propertyDiscoveries.records[0]?.id, candidate.id);
const dealActions = analystView.actions.filter((action) => action.leadId === lead.id);
assert.equal(dealActions.length,1,"one principal action is shown for the deal");
assert.equal(dealActions[0]?.title,"Review the sourced property record.");
assert.equal(dealActions[0]?.dueAt,"2026-10-07T14:00:00.000Z");
assert.equal(dealActions[0]?.workGuidance?.responsibleRole,"ANALYST");
assert.equal(dealActions[0]?.workGuidance?.currentState,"The deal is in discovered.");
assert.ok(dealActions[0]?.workGuidance?.missingFacts.length);
assert.equal(analystView.deals[0]?.workGuidance?.humanMustDo,"Review the sourced property record.");

const operatorView = await commandCenter("OPERATOR",now);
assert.equal(operatorView.actions.filter((action) => action.leadId === lead.id).length,0,
  "research work is not assigned to an operator");

logger.info({checks:"isolated persisted nextAction/followUpAt → one role-assigned work item with stage guidance; role filtering and response validation"},"Command-center persistence exercise PASSED");
