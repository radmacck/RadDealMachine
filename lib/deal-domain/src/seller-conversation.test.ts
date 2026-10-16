import assert from "node:assert/strict";
import test from "node:test";
import { editSellerConversationField, extractSellerConversationFields, unresolvedSellerConversationQuestions, validateSellerConversationFields } from "./seller-conversation";

test("note extraction retains exact source spans, explicit attribution, and conservative confidence", () => {
  const note = 'Seller said: "I want $180,000 and need to close within 30 days."';
  const fields = extractSellerConversationFields(note);
  assert.ok(fields.length);
  for (const field of fields) {
    assert.equal(note.slice(field.sourceStart, field.sourceEnd), field.sourceQuote);
    assert.ok(field.confidence >= 0 && field.confidence <= 1);
    assert.ok(["SELLER_REPORTED", "INFERRED"].includes(field.attribution));
  }
  assert.ok(fields.some(field => field.field === "DESIRED_PRICE"));
});

test("uncertain notes remain inferred, edits preserve original value, and anchors are validated", () => {
  const note = "The owner may be considering a sale because of an inheritance.";
  const fields = extractSellerConversationFields(note);
  const inferred = fields.find(field => field.field === "SITUATION");
  assert.ok(inferred);
  assert.equal(inferred.attribution, "INFERRED");
  assert.ok(inferred.confidence < 0.7);
  const edited = editSellerConversationField(inferred, "Owner reports inherited property.");
  assert.equal(edited.edited, true);
  assert.equal(edited.originalValue, inferred.value);
  assert.deepEqual(validateSellerConversationFields(note, JSON.stringify(fields)), fields);
  assert.throws(() => validateSellerConversationFields(note, JSON.stringify([{ ...fields[0], sourceStart: 1 }])), /invalid provenance/i);
});

test("next-call questions identify unrecorded conversation fields", () => {
  const questions = unresolvedSellerConversationQuestions([]);
  assert.ok(questions.length >= 5);
  assert.ok(questions.some(question => question.includes("Who must approve")));
  assert.ok(questions.some(question => question.includes("access")));
});
