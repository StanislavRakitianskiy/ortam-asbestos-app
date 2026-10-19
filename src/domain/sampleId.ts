/**
 * The only normalization applied before comparing sample IDs: surrounding whitespace and letter case.
 * "S7" never matches "S07": no fuzzy matching, no zero padding, no prefix guessing.
 */
export function normalizeSampleId(raw: string): string {
  return raw.trim().toUpperCase();
}
