import assert from "node:assert/strict";
import { db, jobsTable, leadsTable } from "@workspace/db";
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
  parcelId: "SYNTHETIC-COMMAND-PARCEL",
  provider: "SYNTHETIC command-center source",
  classification: "OBSERVED",
  address: "101 SYNTHETIC AVENUE",
  city: "Philadelphia",
  county: "Philadelphia",
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
  contactPaths: [],
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
assert.equal(candidateActions[0]?.workGuidance?.category, "DISCOVERY_REVIEW");
assert.ok(candidateActions[0]?.workGuidance?.knownFacts.length);
assert.ok(candidateActions[0]?.workGuidance?.missingFacts.length);
assert.ok(candidateActions[0]?.workGuidance?.why);
assert.ok(candidateActions[0]?.workGuidance?.systemCanDo);
assert.ok(candidateActions[0]?.workGuidance?.humanMustDo);
assert.ok(candidateActions[0]?.workGuidance?.completionRecord);
assert.equal(analystView.propertyDiscoveries.records[0]?.id, candidate.id);
const dealActions = analystView.actions.filter((action) => action.leadId === lead.id);
assert.equal(dealActions.length,1,"one principal action is shown for the deal");
assert.equal(dealActions[0]?.title,"Review the sourced property record.");
assert.equal(dealActions[0]?.dueAt,"2026-10-07T14:00:00.000Z");
assert.equal(dealActions[0]?.workGuidance?.responsibleRole,"ANALYST");
assert.equal(dealActions[0]?.workGuidance?.currentState,"The deal is in discovered.");
assert.ok(dealActions[0]?.workGuidance?.missingFacts.length);
assert.equal(analystView.deals[0]?.workGuidance?.humanMustDo,"Review the sourced property record.");
assert.ok(analystView.actions.every((action) => action.workGuidance),
  "Every action presented in the command center must include persisted next-step guidance.");
assert.equal(analystView.automation.lanes.find((lane) => lane.key === "property-discovery")?.state,"AWAITING_AUTHORIZATION",
  "recurring property discovery remains paused without current source terms");
assert.equal(analystView.automation.lanes.find((lane) => lane.key === "underwriting")?.state,"EVENT_DRIVEN");
assert.equal(analystView.automation.lanes.find((lane) => lane.key === "human-authority")?.state,"HUMAN_GATE");
assert.equal(analystView.automation.status,"STARTING");

const schedulerKinds = ["REVIEW_DEADLINES","REVIEW_BUYER_POOL","MATCH_BUYERS","REVIEW_HANDOFFS","DISCOVER_PROPERTIES","BUYER_DISCOVERY"];
await db.insert(jobsTable).values(schedulerKinds.map((kind) => ({
  kind,
  payload: {},
  state: "SUCCEEDED",
  idempotencyKey: `synthetic-scheduler:${kind}`,
  requestedBy: "system:scheduler",
  message: `Synthetic persisted ${kind} scheduler exercise completed.`,
  createdAt: now,
  updatedAt: now,
})));
await db.insert(jobsTable).values([
  {
    kind: "DISCOVER_PROPERTIES",
    payload: { termsReviewed: true, sourcePolicyVersion: "phila-property-sources-v4", recurringPropertyDiscovery: true },
    state: "SUCCEEDED",
    idempotencyKey: "synthetic-property-terms-reviewed",
    requestedBy: "synthetic-owner",
    message: "Synthetic property source terms review.",
    createdAt: now,
    updatedAt: now,
  },
  {
    kind: "BUYER_DISCOVERY",
    payload: { termsReviewed: true, sourcePolicyVersion: "phila-buyer-sources-v2", recurringDiscovery: true },
    state: "SUCCEEDED",
    idempotencyKey: "synthetic-buyer-terms-reviewed",
    requestedBy: "synthetic-owner",
    message: "Synthetic buyer source terms review.",
    createdAt: now,
    updatedAt: now,
  },
]);
const activeAutomationView = await commandCenter("OWNER",now);
assert.equal(activeAutomationView.automation.status,"CURRENT");
assert.equal(activeAutomationView.automation.lanes.find((lane) => lane.key === "property-discovery")?.state,"ACTIVE");
assert.equal(activeAutomationView.automation.lanes.find((lane) => lane.key === "buyer-discovery")?.state,"ACTIVE");
assert.equal(activeAutomationView.automation.lanes.find((lane) => lane.key === "deadlines")?.state,"ACTIVE");
assert.ok(activeAutomationView.automation.lanes.find((lane) => lane.key === "property-discovery")?.lastRunAt);
assert.equal(activeAutomationView.automation.failedJobs,0);

const oneTimeAt = new Date(now.getTime() + 1_000);
await db.insert(jobsTable).values({
  kind: "DISCOVER_PROPERTIES",
  payload: { termsReviewed: true, sourcePolicyVersion: "phila-property-sources-v4", recurringPropertyDiscovery: false },
  state: "SUCCEEDED",
  idempotencyKey: "synthetic-property-one-time-only-policy",
  requestedBy: "synthetic-owner",
  message: "Synthetic owner chose a one-time run only.",
  createdAt: oneTimeAt,
  updatedAt: oneTimeAt,
});
const oneTimeAutomationView = await commandCenter("OWNER",oneTimeAt);
assert.equal(oneTimeAutomationView.automation.lanes.find((lane) => lane.key === "property-discovery")?.state,"ONE_TIME_ONLY",
  "the dashboard distinguishes one-time source access from recurring permission");

const staleAt = new Date(now.getTime() + 6 * 60 * 60_000 + 2 * 60_000);
const staleAutomationView = await commandCenter("OWNER",staleAt);
assert.equal(staleAutomationView.automation.status,"DELAYED");
assert.equal(staleAutomationView.automation.lanes.find((lane) => lane.key === "buyer-discovery")?.state,"OVERDUE",
  "the dashboard flags a missed recurring source cycle instead of claiming it is current");

await db.insert(jobsTable).values({
  kind: "REVIEW_DEADLINES",
  payload: {},
  state: "FAILED",
  idempotencyKey: "synthetic-scheduler:REVIEW_DEADLINES:failed",
  requestedBy: "system:scheduler",
  message: "Synthetic persisted deadline worker failure.",
  createdAt: staleAt,
  updatedAt: staleAt,
});
const failedAutomationView = await commandCenter("OWNER",staleAt);
assert.equal(failedAutomationView.automation.status,"ACTION_REQUIRED");
assert.equal(failedAutomationView.automation.lanes.find((lane) => lane.key === "deadlines")?.state,"ACTION_REQUIRED");

const operatorView = await commandCenter("OPERATOR",now);
assert.equal(operatorView.actions.filter((action) => action.leadId === lead.id).length,0,
  "research work is not assigned to an operator");

logger.info({checks:"persisted role-assigned next actions; source-consent, one-time-only and recurring status; current, overdue and failed worker states; last-run data and human authority gates"},"Command-center persistence exercise PASSED");
