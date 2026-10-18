import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSettlementProceeds, validateDestinationFeeFields } from "./transaction-fees";

test("fee event requires exact amount and currency; ordinary activity cannot carry fee terms", () => {
  for (const kind of ["FEE_RECEIVED", "FEE_DISPUTED", "FEE_WAIVED"]) {
    assert.throws(() => validateDestinationFeeFields(kind, null, "USD"), /exact evidenced amount and currency/);
    assert.throws(() => validateDestinationFeeFields(kind, 1000, null), /exact evidenced amount and currency/);
    assert.doesNotThrow(() => validateDestinationFeeFields(kind, 1000, "USD"));
  }
  assert.throws(() => validateDestinationFeeFields("SUBMITTED", 1000, "USD"), /belong on a fee outcome/);
  assert.doesNotThrow(() => validateDestinationFeeFields("SUBMITTED", null, null));
});

test("settlement fee must reconcile to frozen buyer minus acquisition price and net only subtracts costs", () => {
  assert.equal(reconcileSettlementProceeds(18000, 18000, 1200), 16800);
  assert.throws(() => reconcileSettlementProceeds(18000, 17500, 1200), /reconcile to the frozen committed price/);
  assert.throws(() => reconcileSettlementProceeds(18000, -1, 1200), /nonnegative amount in whole cents/);
  assert.throws(() => reconcileSettlementProceeds(18000, 18000, -1), /Closing costs/);
  assert.throws(() => reconcileSettlementProceeds(18000, 18000.001, 1200), /nonnegative amount in whole cents/);
});
