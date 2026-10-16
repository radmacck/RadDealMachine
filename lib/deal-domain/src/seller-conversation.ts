export const SELLER_CONVERSATION_FIELDS = [
  "SITUATION", "DESIRED_PRICE", "TIMELINE", "OCCUPANCY", "CONDITION",
  "DECISION_AUTHORITY", "ACCESS", "OBJECTIONS", "FOLLOW_UP",
] as const;
export type SellerConversationFieldKey = typeof SELLER_CONVERSATION_FIELDS[number];
export type SellerConversationField = {
  field: SellerConversationFieldKey;
  value: string;
  sourceQuote: string;
  sourceStart: number;
  sourceEnd: number;
  confidence: number;
  attribution: "SELLER_REPORTED" | "INFERRED";
  edited: boolean;
  originalValue: string | null;
};
const rules: Array<[SellerConversationFieldKey, RegExp, RegExp]> = [
  ["DESIRED_PRICE", /\$\s?\d[\d,]*(?:\.\d{1,2})?/i, /\b(?:seller|he|she|they|owner)\b.*\b(?:asking|wants?|needs?|price|offer)\b/i],
  ["TIMELINE", /\b(?:by|within|in|before|after|next)\s+(?:\d+\s+)?(?:days?|weeks?|months?|years?|weekend|month|summer|spring|fall|winter)\b|\b(?:urgent|soon|deadline|flexible timing)\b/i, /\b(?:seller|he|she|they|owner)\b/i],
  ["OCCUPANCY", /\b(?:vacant|unoccupied|owner[- ]occupied|tenant(?:s)?|rented|occupied|living there)\b/i, /\b(?:seller|he|she|they|owner|tenant)\b/i],
  ["CONDITION", /\b(?:roof|foundation|hvac|kitchen|bath|plumb|electri|repair|damage|condition|as[- ]is|leak)\w*\b/i, /\b(?:seller|he|she|they|owner|property)\b/i],
  ["DECISION_AUTHORITY", /\b(?:co[- ]owner|spouse|wife|husband|sister|brother|partner|attorney|executor|power of attorney|decision maker|needs? to agree|sign)\b/i, /\b(?:seller|he|she|they|owner|we)\b/i],
  ["ACCESS", /\b(?:access|showing|show|inspection|lockbox|appointment|key|entry)\b/i, /\b(?:seller|he|she|they|owner|property)\b/i],
  ["OBJECTIONS", /\b(?:concern|worried|hesitant|doesn't want|not comfortable|refus|objection|won't|wouldn't)\b/i, /\b(?:seller|he|she|they|owner)\b/i],
  ["FOLLOW_UP", /\b(?:call back|follow[- ]up|send (?:the|an?)|text (?:the|an?)|check back|reach out)\b/i, /\b(?:seller|he|she|they|owner|we)\b/i],
  ["SITUATION", /\b(?:relocat|inherit|inherited|divorc|job transfer|financial|foreclos|tax delinquen|estate|downsizing|vacant property)\w*\b/i, /\b(?:seller|he|she|they|owner|because)\b/i],
];
export function extractSellerConversationFields(note: string): SellerConversationField[] {
  const out: SellerConversationField[] = [];
  for (const match of note.matchAll(/[^.!?\n]+[.!?]?/g)) {
    const quote = match[0].trim();
    const offset = match.index ?? 0;
    const start = offset + match[0].indexOf(quote);
    for (const [field, signal, attributionSignal] of rules) {
      if (out.some(item => item.field === field) || !signal.test(quote)) continue;
      const explicit = attributionSignal.test(quote) &&
        !/\b(?:may|might|possibly|could|apparently|seems?|assume|guess|probably)\b/i.test(quote);
      out.push({
        field, value: quote, sourceQuote: quote, sourceStart: start, sourceEnd: start + quote.length,
        confidence: explicit ? 0.82 : 0.46,
        attribution: explicit ? "SELLER_REPORTED" : "INFERRED",
        edited: false, originalValue: null,
      });
    }
  }
  return out;
}
export function editSellerConversationField(field: SellerConversationField, value: string): SellerConversationField {
  const cleaned = value.trim();
  return { ...field, value: cleaned, edited: cleaned !== field.value, originalValue: cleaned !== field.value ? field.value : field.originalValue };
}
export function validateSellerConversationFields(note: string, encoded: string): SellerConversationField[] {
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { throw new Error("Structured seller fields must be valid JSON."); }
  if (!Array.isArray(value) || value.length > 9) throw new Error("Structured seller fields must be an array of at most nine items.");
  for (const item of value) {
    if (!item || typeof item !== "object" || !SELLER_CONVERSATION_FIELDS.includes(item.field) ||
      typeof item.value !== "string" || typeof item.sourceQuote !== "string" ||
      !Number.isInteger(item.sourceStart) || !Number.isInteger(item.sourceEnd) ||
      note.slice(item.sourceStart, item.sourceEnd) !== item.sourceQuote ||
      !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1 ||
      !["SELLER_REPORTED", "INFERRED"].includes(item.attribution) || typeof item.edited !== "boolean") {
      throw new Error("A structured seller field has invalid provenance, confidence, attribution, or note offsets.");
    }
  }
  return value as SellerConversationField[];
}
export function unresolvedSellerConversationQuestions(fields: SellerConversationField[]) {
  const byKey = new Map(fields.map(item => [item.field, item]));
  const questions: Partial<Record<SellerConversationFieldKey, string>> = {
    SITUATION: "What is driving the possible sale, in the seller's own words?",
    DESIRED_PRICE: "What price does the seller want, and what supports it?",
    TIMELINE: "When would the seller like to close, and what deadline matters?",
    OCCUPANCY: "Who occupies the property now, and when can possession be delivered?",
    CONDITION: "What condition issues has the seller mentioned, and what still needs inspection?",
    DECISION_AUTHORITY: "Who must approve and sign the sale?",
    ACCESS: "When and how can the property be accessed?",
    OBJECTIONS: "What concerns or objections remain unresolved?",
    FOLLOW_UP: "What follow-up did the seller agree to, and by when?",
  };
  return SELLER_CONVERSATION_FIELDS.filter(key => !byKey.has(key)).map(key => questions[key]!);
}
