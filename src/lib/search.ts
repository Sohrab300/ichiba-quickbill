/**
 * Turns free text into a term that is safe to embed in a PostgREST `.or()` ILIKE filter.
 *
 * Only letters, digits, spaces and & + - / ' # are kept; every other character becomes `_`
 * (LIKE's single-character wildcard, so "2.0" still matches "2.0"). The result can therefore
 * never contain PostgREST filter syntax (, . : ( ) " *) or LIKE metacharacters (% \).
 * Returns null when nothing searchable is left.
 */
export function toSafeIlikeTerm(input: string): string | null {
  const term = input
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .replace(/[^\p{L}\p{N} &+\-/'#]/gu, "_");
  return /[\p{L}\p{N}]/u.test(term) ? term : null;
}
