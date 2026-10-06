import assert from "node:assert/strict";
import { test } from "node:test";
import { commandCenterCallDisplay } from "./command-center-display";

const call = (id: string) => ({ lead: { id } });

test("selected seller call is embedded in the primary action and removed from the follow-on queue", () => {
  const view = commandCenterCallDisplay({ category: "CALL", leadId: "seller-a" }, [
    call("seller-a"), call("seller-b"),
  ]);
  assert.equal(view.primaryCall?.lead.id, "seller-a");
  assert.deepEqual(view.additionalCalls.map((item) => item.lead.id), ["seller-b"]);
});

test("a higher-priority non-call action stays primary and its deal is not repeated as another task", () => {
  const view = commandCenterCallDisplay({ category: "CONTRACT", leadId: "seller-a" }, [
    call("seller-a"), call("seller-b"),
  ]);
  assert.equal(view.primaryCall, null);
  assert.deepEqual(view.additionalCalls.map((item) => item.lead.id), ["seller-b"]);
});

test("a call remains available when no primary action is selected", () => {
  const view = commandCenterCallDisplay(null, [call("seller-a")]);
  assert.equal(view.primaryCall, null);
  assert.deepEqual(view.additionalCalls.map((item) => item.lead.id), ["seller-a"]);
});
