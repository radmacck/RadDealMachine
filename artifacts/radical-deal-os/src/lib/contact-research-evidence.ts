export function normalizeContactResearchEvidenceReference(value: string): string | null {
  const reference = value.trim();
  return reference.length >= 3 ? reference : null;
}
