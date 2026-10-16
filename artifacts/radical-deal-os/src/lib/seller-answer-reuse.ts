import type { CallSellerAnswers } from '@workspace/api-client-react';

export type SellerAnswerDraft = {
  motivation: string;
  urgency: string;
  condition: string;
  conditionsByCategory: Record<string, string>;
  timing: string;
  askingPrice: string;
  occupancy: string;
  repairsCompleted: string;
  knownDefects: string;
  titleTenantIssues: string;
  accessConstraints: string;
  willingnessToAcceptTerms: string;
  sellerNextStep: string;
  otherMaterialStatements: string;
};

export function reuseSellerAnswerDraft(answers: CallSellerAnswers): SellerAnswerDraft {
  return {
    motivation: answers.motivationStatement ?? '',
    urgency: answers.urgency ?? '',
    condition: answers.conditionDescription ?? '',
    conditionsByCategory: Object.fromEntries((answers.conditionByCategory ?? []).map(item => [item.category, item.statement])),
    timing: answers.timing ?? '',
    askingPrice: answers.askingPrice == null ? '' : String(answers.askingPrice),
    occupancy: answers.occupancy ?? '',
    repairsCompleted: answers.repairsCompleted ?? '',
    knownDefects: answers.knownDefects ?? '',
    titleTenantIssues: answers.titleTenantIssues ?? '',
    accessConstraints: answers.accessConstraints ?? '',
    willingnessToAcceptTerms: answers.willingnessToAcceptTerms ?? '',
    sellerNextStep: answers.nextStepOutcome ?? '',
    otherMaterialStatements: answers.otherMaterialStatements ?? '',
  };
}

export function sellerAnswersFromEvidence(items: Array<{
  category: string;
  statement: string;
  sourceType: string;
  sourceRecordId?: string | null;
  capturedAt?: string;
}>): CallSellerAnswers | undefined {
  const sourceRecordId = [...items].filter(item => item.sourceType === 'SELLER' &&
    item.category.startsWith('seller_call_') && item.sourceRecordId)
    .sort((a, b) => Date.parse(b.capturedAt ?? '') - Date.parse(a.capturedAt ?? ''))[0]?.sourceRecordId;
  if (!sourceRecordId) return undefined;
  const current = items.filter(item => item.sourceType === 'SELLER' && item.sourceRecordId === sourceRecordId);
  const byCategory = (category: string) => current.find(item => item.category === category)?.statement;
  const stripLabel = (value: string | undefined, prefix: string) =>
    value?.startsWith(prefix) ? value.slice(prefix.length).trim() : undefined;
  const answers: CallSellerAnswers = {};
  const fields: Array<[string, keyof CallSellerAnswers, string]> = [
    ['seller_call_motivation', 'motivationStatement', ''],
    ['seller_call_urgency', 'urgency', ''],
    ['seller_call_timing', 'timing', ''],
    ['seller_call_condition', 'conditionDescription', ''],
    ['seller_call_occupancy', 'occupancy', 'Seller-reported occupancy: '],
    ['seller_call_repairs_completed', 'repairsCompleted', 'Seller-reported completed repairs: '],
    ['seller_call_known_defects', 'knownDefects', 'Seller-reported defects: '],
    ['seller_call_title_tenant_issues', 'titleTenantIssues', 'Seller-reported title or tenant issues: '],
    ['seller_call_access_constraints', 'accessConstraints', 'Seller-reported access constraints: '],
    ['seller_call_terms', 'willingnessToAcceptTerms', 'Seller-reported terms flexibility: '],
    ['seller_call_next_step', 'nextStepOutcome', 'Seller-reported next-step outcome: '],
    ['seller_call_other_statement', 'otherMaterialStatements', 'Other seller-reported material statement: '],
  ];
  for (const [category, key, label] of fields) {
    const value = byCategory(category);
    const restored = label ? stripLabel(value, label) : value;
    if (restored) (answers as Record<string, unknown>)[key] = restored;
  }
  const price = byCategory('seller_call_asking_price')?.match(/\$([\d,]+)/)?.[1]?.replaceAll(',', '');
  if (price && Number.isFinite(Number(price))) answers.askingPrice = Number(price);
  const conditions = current.flatMap(item => {
    const match = item.category.match(/^seller_call_condition_(.+)$/);
    if (!match || item.category === 'seller_call_condition') return [];
    const statement = item.statement.replace(/^Seller reported [^:]+ condition:\s*/i, '').trim();
    return statement ? [{ category: match[1].toUpperCase() as NonNullable<CallSellerAnswers['conditionByCategory']>[number]['category'], statement }] : [];
  });
  if (conditions.length) answers.conditionByCategory = conditions;
  return Object.keys(answers).length ? answers : undefined;
}
