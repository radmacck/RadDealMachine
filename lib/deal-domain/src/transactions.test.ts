import assert from "node:assert/strict";
import test from "node:test";
import type { BuyerMatch, DealContract } from "./buyers";
import { assertNewClosingMilestone, closingBlockers } from "./transactions";

const at = "2026-10-16T12:00:00.000Z";
const evidence = "https://example.test/synthetic-evidence";
const milestoneKinds = [
  "TITLE_CLEARED",
  "INSPECTION_COMPLETED",
  "EARNEST_MONEY_CONFIRMED",
  "ASSIGNMENT_SIGNED",
  "FUNDS_CONFIRMED",
] as const;

function validContract(overrides: Record<string, unknown> = {}): DealContract {
  const milestones = milestoneKinds.map(kind => ({
    kind,
    evidenceUrl: kind === "FUNDS_CONFIRMED" ? "https://example.test/synthetic-funding" : evidence,
    effectiveAt: at,
    recordedAt: at,
    ...(kind === "EARNEST_MONEY_CONFIRMED" ? {
      amount: 1000, currency: "USD", evidenceKind: "ESCROW_RECEIPT",
      counterpartyName: "Synthetic escrow", paymentReference: "SYNTHETIC-RECEIPT-1",
    } : {}),
    ...(kind === "FUNDS_CONFIRMED" ? {
      amount: 120000, currency: "USD", evidenceKind: "BANK_CONFIRMATION",
      counterpartyName: "Synthetic bank", paymentReference: "SYNTHETIC-FUNDS-1",
    } : {}),
  }));
  return {
    id: "synthetic-contract",
    leadId: "synthetic-lead",
    status: "CLOSING",
    executedDocumentUrl: "https://example.test/synthetic-executed-agreement",
    sellerSignedAt: "2026-10-14T12:00:00.000Z",
    acquisitionSignedAt: "2026-10-15T12:00:00.000Z",
    assignmentAllowed: true,
    committedBuyerId: "synthetic-buyer",
    buyerCommittedAt: "2026-10-15T12:00:00.000Z",
    purchasePrice: 100000,
    assignmentTarget: 5000,
    agreedBuyerPrice: 105000,
    earnestMoney: 1000,
    commitmentSnapshot: {
      buyer: {
        availableFunds: 120000,
        fundingEvidenceUrl: "https://example.test/synthetic-funding",
        evidenceAt: "2026-10-15T10:00:00.000Z",
      },
    },
    milestones,
    deadlineSchedule: null,
    ...overrides,
  } as unknown as DealContract;
}

const committedMatch = { eligible: true, status: "COMMITTED" } as BuyerMatch;

test("closing requires executed terms, a qualified committed buyer and every applicable evidence milestone", () => {
  const blocked = closingBlockers(validContract({
    status: "UNDER_CONTRACT",
    executedDocumentUrl: null,
    committedBuyerId: null,
    milestones: [],
  }), undefined);
  assert.ok(blocked.some(item => /Start closing/.test(item)));
  assert.ok(blocked.some(item => /Executed acquisition document/.test(item)));
  assert.ok(blocked.some(item => /qualified, verified, committed buyer/.test(item)));
  assert.ok(blocked.some(item => /Missing evidence: title cleared/.test(item)));
  assert.ok(blocked.some(item => /Missing evidence: funds confirmed/.test(item)));
});

test("complete synthetic settlement evidence clears the closing blockers without implying a real closing", () => {
  assert.deepEqual(closingBlockers(validContract(), committedMatch), []);
});

test("stale or mismatched escrow and funding evidence keeps settlement blocked", () => {
  const contract = validContract({
    milestones: [
      ...validContract().milestones.filter(item => item.kind !== "EARNEST_MONEY_CONFIRMED" && item.kind !== "FUNDS_CONFIRMED"),
      { kind: "EARNEST_MONEY_CONFIRMED", evidenceUrl: evidence, effectiveAt: "2026-10-13T12:00:00Z", recordedAt: at,
        amount: 999, currency: "USD", evidenceKind: "ESCROW_RECEIPT", counterpartyName: "Synthetic escrow",
        paymentReference: "SYNTHETIC-RECEIPT-2" },
      { kind: "FUNDS_CONFIRMED", evidenceUrl: evidence, effectiveAt: "2026-10-14T12:00:00Z", recordedAt: at,
        amount: 110000, currency: "USD", evidenceKind: "BANK_CONFIRMATION", counterpartyName: "Synthetic bank",
        paymentReference: "SYNTHETIC-FUNDS-2" },
    ],
  });
  const blockers = closingBlockers(contract, committedMatch);
  assert.ok(blockers.some(item => /earnest-money evidence is incomplete or does not match/.test(item)));
  assert.ok(blockers.some(item => /Buyer-funds evidence is incomplete, stale, or does not match/.test(item)));
});

test("a milestone kind is append-once; duplicate evidence cannot replace its history", () => {
  const existing = validContract().milestones.filter(milestone => milestone.kind === "TITLE_CLEARED");
  const original = structuredClone(existing);
  assert.throws(() => assertNewClosingMilestone(existing, "TITLE_CLEARED"), /already recorded; evidence history is immutable/);
  assert.deepEqual(existing, original);
  assert.doesNotThrow(() => assertNewClosingMilestone(existing, "INSPECTION_COMPLETED"));
});
