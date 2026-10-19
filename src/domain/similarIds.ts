import { normalizeSampleId } from "./sampleId";

/**
 * A looser form of a sample ID used ONLY to word a hint for the employee: letters and digits without separators,
 * leading zeros dropped from each number ("S-007" → "S7"). Matching never uses it (see sampleId.ts).
 */
export function looseSampleKey(raw: string): string {
  return normalizeSampleId(raw)
    .replace(/[^A-Z0-9]/g, "")
    .replace(/\d+/g, (digits) => String(Number(digits)));
}

/**
 * Registered sample IDs that look like a lab sample ID ("S7" → "S07"), for the text hint "Similar ID in register".
 * The result is never used to link anything: a lab row joins a zone only after the employee corrects its sample ID.
 */
export function similarRegisteredIds(labSampleId: string, registeredIds: readonly string[]): string[] {
  const wanted = looseSampleKey(labSampleId);
  const exact = normalizeSampleId(labSampleId);
  if (wanted === "") return [];
  const similar = registeredIds.map(normalizeSampleId).filter((id) => id !== exact && looseSampleKey(id) === wanted);
  return [...new Set(similar)];
}
