import test from "node:test";
import assert from "node:assert/strict";
import { evaluateIntelligenceLoop, type DecisionOperations } from "./intelligence-loop";
import type { LeadDetail, AcquisitionQueueItem } from "./types";

const now = new Date("2026-10-08T15:00:00.000Z");
const makeDetail = (overrides: Record<string, unknown> = {}) => {
  const { lead: leadOverrides, ...rest } = overrides;
  return ({
    lead: {
    id: "11111111-1111-4111-8111-111111111111",
    stage: "ANALYZED",
    sellerName: "Synthetic seller",
    address: "100 Synthetic Street",
    nextAction: "Review current evidence.",
    updatedAt: now.toISOString(),
    propertyQualification: { discoveryId: "discovery-1", missingInformation: [], signals: [] },
    ...((leadOverrides ?? {}) as object),
    },
    intelligence: [],
    analysis: null,
    analysisSnapshotId: null,
    underwriting: null,
    offers: [],
    transitions: [],
    calls: [],
    workGuidance: null,
    ...rest,
  } as unknown as LeadDetail);
};

const makeQueue = (overrides: Record<string, unknown> = {}) => ({
  lead: { id: "11111111-1111-4111-8111-111111111111" },
  decision: "BLOCKED",
  rank: 1,
  evidenceScore: 0,
  rankingReason: "Synthetic exercise only.",
  propertySignals: [],
  contactReadiness: {
    directRouteStatus: "NO_DIRECT_ROUTE",
    contactPaths: [],
    selectedPhonePath: null,
    selectedEmailPath: null,
  },
  blockerCode: "CONTACT_NO_DIRECT_ROUTE",
  blocker: "Synthetic exercise: no direct seller route is recorded.",
  nextAction: "Research permitted direct contact evidence.",
  callBrief: null,
  ...overrides,
} as unknown as AcquisitionQueueItem);

const ops = (overrides: Partial<DecisionOperations> = {}): DecisionOperations => ({
  contract: null, matches: [], nextAction: "Review transaction.",
  ...overrides,
});

test("A: qualified lead without direct contact gets a research action and blocked CALL NEXT", () => {
  const result = evaluateIntelligenceLoop({
    subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail(), acquisition: makeQueue(), operations: null, now,
  });
  assert.equal(result.recommendedAction?.code, "RESEARCH_CONTACT");
  assert.equal(result.recommendedAction?.eligible, true);
  assert.equal(result.blockedActions[0]?.code, "CALL_NEXT");
  assert.equal(result.blockedActions[0]?.eligible, false);
  assert.match(result.unknowns.join(" "), /no direct seller route/i);
});

test("B: only a queue item that passes the current readiness gate can recommend CALL NEXT", () => {
  const result = evaluateIntelligenceLoop({
    subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail({
      analysis: { classification: "STRONG", calculatedAt: now.toISOString(), blockers: [], mao: 1 },
      analysisSnapshotId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }), acquisition: makeQueue({
      decision: "CALL_NEXT", blockerCode: null, blocker: null,
      contactReadiness: { directRouteStatus: "PHONE_ROUTE_AVAILABLE", contactPaths: [] },
    }), operations: null, now,
  });
  assert.equal(result.recommendedAction?.code, "CALL_NEXT");
  assert.equal(result.humanAuthorizationRequired, true);
});

test("imminent and overdue contract deadlines outrank routine transaction work and stay human-gated", () => {
  for (const closingAt of [
    new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
    new Date(now.getTime() - 60 * 60_000).toISOString(),
  ]) {
    const result = evaluateIntelligenceLoop({
      subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
      leadId: "11111111-1111-4111-8111-111111111111", discoveryId: null,
      detail: makeDetail(), acquisition: null,
      operations: ops({ contract: { id: "contract-1", status: "UNDER_CONTRACT", committedBuyerId: "buyer-1", closingAt } }),
      now,
    });
    assert.equal(result.recommendedAction?.code, "TRANSACTION_NEXT");
    assert.equal(result.recommendedAction?.priority, 130);
    assert.equal(result.recommendedAction?.requiresHumanAuthorization, true);
    assert.match(result.recommendedAction?.reason ?? "", /overdue|within 72 hours/i);
  }
});

test("distant closing deadlines do not displace the recorded buyer transaction step", () => {
  const result = evaluateIntelligenceLoop({
    subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: null,
    detail: makeDetail(), acquisition: null,
    operations: ops({ contract: { id: "contract-1", status: "UNDER_CONTRACT", committedBuyerId: "buyer-1",
      closingAt: new Date(now.getTime() + 10 * 24 * 60 * 60_000).toISOString() } }),
    now,
  });
  assert.equal(result.recommendedAction?.priority, 112);
  assert.doesNotMatch(result.recommendedAction?.title ?? "", /deadline/i);
});

test("C and D: seller condition and price statements trigger separate deterministic next actions", () => {
  const detail = (category: string, id: string) => makeDetail({
    intelligence: [{
      id, sourceType: "SELLER", category, classification: "INDICATED",
      statement: "Synthetic seller statement.", source: "Synthetic seller interview",
      sourceRecordId: `interview:${id}`, confidence: 0.8, capturedAt: now.toISOString(),
      createdAt: now.toISOString(),
    }],
  });
  const base = {
    subjectType: "LEAD" as const, subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    acquisition: null, operations: null, now,
  };
  assert.equal(evaluateIntelligenceLoop({ ...base, detail: detail("condition_roof", "call-evidence-1") }).recommendedAction?.code, "GATHER_REPAIR_EVIDENCE");
  assert.equal(evaluateIntelligenceLoop({ ...base, detail: detail("asking_price", "call-evidence-2") }).recommendedAction?.code, "RECALCULATE_UNDERWRITING");
});

test("E: unresolved public-versus-seller evidence conflict takes precedence over routine work", () => {
  const result = evaluateIntelligenceLoop({
    subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail({ intelligence: [{
      id: "conflict-1", sourceType: "SELLER", category: "occupancy", classification: "INDICATED",
      statement: "Synthetic conflicting seller statement.", createdAt: now.toISOString(),
      reconciliation: { state: "CONFLICT_REVIEW" },
    }] }),
    acquisition: null, operations: null, now,
  });
  assert.equal(result.recommendedAction?.code, "RECONCILE_EVIDENCE");
  assert.equal(result.conflicts[0]?.epistemicStatus, "INDICATED");
});

test("F and G: contracted no-match action differs from already committed transaction progression", () => {
  const base = {
    subjectType: "LEAD" as const, subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail(), acquisition: null, now,
  };
  const contract = { id: "contract-1", status: "UNDER_CONTRACT", committedBuyerId: null };
  assert.equal(evaluateIntelligenceLoop({ ...base, operations: ops({ contract }) }).recommendedAction?.code, "BUYER_DEMAND");
  assert.equal(evaluateIntelligenceLoop({
    ...base,
    operations: ops({ contract: { ...contract, committedBuyerId: "buyer-1" } }),
  }).recommendedAction?.code, "TRANSACTION_NEXT");
});

test("H: terminal deal records the outcome and emits no stale recommended action", () => {
  const result = evaluateIntelligenceLoop({
    subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail({ lead: { stage: "CLOSED" }, transitions: [{
      to: "CLOSED", actor: "synthetic:operator", createdAt: now.toISOString(), reason: "Synthetic closeout.",
    }] }),
    acquisition: null, operations: null, now,
  });
  assert.equal(result.recommendedAction, null);
  assert.equal(result.eligibleActions.length, 0);
  assert.match(result.outcomeRecord ?? "", /CLOSED recorded/);
});

test("discovery remains separate from a lead, and AI hypotheses remain explicitly unverified", () => {
  const discovery = evaluateIntelligenceLoop({
    subjectType: "DISCOVERY", subjectId: "22222222-2222-4222-8222-222222222222",
    discoveryId: "22222222-2222-4222-8222-222222222222", leadId: null,
    discovery: {
      id: "22222222-2222-4222-8222-222222222222", status: "DISCOVERED_PROPERTY", leadId: null,
      address: "200 Synthetic Street", reason: "Synthetic source record.",
      nextAction: "Review qualification.", observedAt: now.toISOString(), missingInformation: [], signalRefs: [],
    },
    now,
  });
  assert.equal(discovery.recommendedAction?.code, "QUALIFY_DISCOVERY");
  assert.equal(discovery.blockedActions[0]?.code, "CALL_NEXT");

  const hypothesis = evaluateIntelligenceLoop({
    subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail({ intelligence: [{
      id: "hypothesis-1", sourceType: "AI", category: "motivation", classification: "AI_HYPOTHESIS",
      statement: "Synthetic hypothesis.", createdAt: now.toISOString(),
    }] }),
    acquisition: makeQueue(), operations: null, now,
  });
  assert.equal(hypothesis.known.find(item => item.ref === "intelligence:hypothesis-1")?.epistemicStatus, "AI_HYPOTHESIS");
  assert.equal(hypothesis.evidenceRefs.includes("intelligence:hypothesis-1"), true);
});

test("identical evidence snapshot produces stable action code, order and evidence references", () => {
  const input = {
    subjectType: "LEAD" as const, subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail(), acquisition: makeQueue(), operations: null, now,
  };
  const first = evaluateIntelligenceLoop(input);
  const second = evaluateIntelligenceLoop(input);
  assert.deepEqual(first, second);
});

test("expired seller claim blocks routine work and preserves source-backed next-step evidence", () => {
  const oldAt = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const result = evaluateIntelligenceLoop({
    subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail({ intelligence: [{
      id: "seller-claim-old", sourceType: "SELLER", category: "occupancy",
      classification: "INDICATED", statement: "Synthetic seller says vacant.",
      source: "Synthetic interview", sourceRecordId: "interview:old", confidence: 0.8,
      capturedAt: oldAt, createdAt: oldAt,
    }] }),
    acquisition: makeQueue({ decision: "CALL_NEXT", blockerCode: null, blocker: null }),
    operations: null, now,
  });
  assert.equal(result.recommendedAction?.code, "REFRESH_SOURCE_EVIDENCE");
  assert.equal(result.recommendedAction?.eligible, true);
  assert.match(result.recommendedAction?.reason ?? "", /Re-verify expired evidence/);
  assert.ok(result.staleEvidence.some(item => item.ref === "intelligence:seller-claim-old"));
  assert.ok(result.recommendedAction?.evidenceRefs.includes("intelligence:seller-claim-old"));
  assert.match(result.known.find(item => item.ref === "intelligence:seller-claim-old")?.summary ?? "", /Seller-reported.*source Synthetic interview.*80%/);
});

test("contradictory source records remain visible and require reviewer reconciliation before dependent actions", () => {
  const evidence = (id: string, source: string, value: string) => ({
    id, sourceType: source === "Owner interview" ? "SELLER" : "PUBLIC_RECORD",
    category: "occupancy", classification: "OBSERVED", statement: value,
    source, sourceRecordId: `record:${id}`, confidence: 0.9,
    capturedAt: now.toISOString(), createdAt: now.toISOString(),
  });
  const result = evaluateIntelligenceLoop({
    subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail({ intelligence: [
      evidence("occupancy-public", "Municipal record", "Occupied"),
      evidence("occupancy-seller", "Owner interview", "Vacant"),
    ] }),
    acquisition: makeQueue({ decision: "CALL_NEXT", blockerCode: null, blocker: null }),
    operations: null, now,
  });
  assert.equal(result.recommendedAction?.code, "RECONCILE_EVIDENCE");
  assert.equal(result.conflicts.length, 2);
  assert.deepEqual(result.conflicts.map(item => item.ref), ["intelligence:occupancy-public", "intelligence:occupancy-seller"]);
  assert.ok(result.known.some(item => item.summary.includes("Occupied")));
  assert.ok(result.known.some(item => item.summary.includes("Vacant")));
  assert.match(result.recommendedAction?.reason ?? "", /preserved/);
  assert.equal(result.recommendedAction?.requiresHumanAuthorization, true);
});

test("current dated seller evidence removes the stale-evidence block but keeps its provenance", () => {
  const result = evaluateIntelligenceLoop({
    subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail({ intelligence: [{
      id: "seller-claim-current", sourceType: "SELLER", category: "asking_price",
      classification: "INDICATED", statement: "Synthetic seller says $150,000.",
      source: "Synthetic interview", sourceRecordId: "interview:current", confidence: 0.75,
      capturedAt: now.toISOString(), createdAt: now.toISOString(),
    }] }),
    acquisition: null, operations: null, now,
  });
  assert.equal(result.staleEvidence.length, 0);
  assert.ok(result.known.some(item => item.ref === "intelligence:seller-claim-current" && item.freshness === "CURRENT"));
  assert.notEqual(result.recommendedAction?.code, "REFRESH_SOURCE_EVIDENCE");
});

test("same-valued re-verification clears the stale block while retaining the old source in history", () => {
  const oldAt = new Date(now.getTime() - 31 * 86_400_000).toISOString();
  const result = evaluateIntelligenceLoop({
    subjectType: "LEAD", subjectId: "11111111-1111-4111-8111-111111111111",
    leadId: "11111111-1111-4111-8111-111111111111", discoveryId: "discovery-1",
    detail: makeDetail({ intelligence: [
      {
        id: "seller-claim-prior", sourceType: "SELLER", category: "occupancy",
        classification: "INDICATED", statement: "Seller says vacant.",
        source: "Synthetic interview", sourceRecordId: "interview:prior", confidence: 0.8,
        capturedAt: oldAt, createdAt: oldAt,
      },
      {
        id: "seller-claim-reverified", sourceType: "SELLER", category: "occupancy",
        classification: "INDICATED", statement: "Seller says vacant.",
        source: "Synthetic follow-up interview", sourceRecordId: "interview:reverified", confidence: 0.9,
        capturedAt: now.toISOString(), createdAt: now.toISOString(),
      },
    ] }),
    acquisition: makeQueue({ decision: "CALL_NEXT", blockerCode: null, blocker: null }),
    operations: null, now,
  });
  assert.equal(result.staleEvidence.length, 0);
  assert.ok(result.known.some(item => item.ref === "intelligence:seller-claim-prior"
    && item.summary.includes("historical evidence retained")));
  assert.ok(result.known.some(item => item.ref === "intelligence:seller-claim-reverified"));
  assert.notEqual(result.recommendedAction?.code, "REFRESH_SOURCE_EVIDENCE");
});
