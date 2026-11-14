/**
 * CSV building for the exports (RFC 4180: comma separated, CRLF line ends, fields quoted when
 * needed). Excel needs the UTF-8 byte order mark to read non-ASCII text (₹, names) correctly.
 * Pure; safe anywhere.
 */

export const CSV_BOM = "\uFEFF";

/** A field written in quotes whatever it contains (see quoted()). */
export interface QuotedCsvValue {
  readonly quoted: string;
}

export type CsvValue = string | number | null | undefined | QuotedCsvValue;

/**
 * Codes that must stay text (item code, HSN): always written in quotes, e.g. "0401". Quoting
 * alone does not stop Excel from reading "0401" as the number 401 when the file is simply
 * double-clicked; import the file with these columns set to Text (docs/EXPORTS.md). No ="…"
 * formula wrapper: exports never contain formulas (see csvText()). Empty values stay empty.
 */
export function quoted(value: string | null | undefined): QuotedCsvValue | null {
  return value ? { quoted: value } : null;
}

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** One field, quoted if it contains a comma, quote or line break (always, for quoted()). */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return quote(value.quoted);
  const s = String(value);
  return /[",\r\n]/.test(s) ? quote(s) : s;
}

/** One line including its CRLF. */
export function csvRow(values: readonly CsvValue[]): string {
  return values.map(csvField).join(",") + "\r\n";
}

/**
 * Free text (product names, cashier names) that a spreadsheet could otherwise run as a formula
 * ("=HYPERLINK(…)"): prefixed with an apostrophe, which Excel hides. Never use it for numbers.
 */
export function csvText(value: string | null | undefined): string {
  if (!value) return "";
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Integer paise → rupees with exactly 2 decimals and no grouping: 123456 → "1234.56", -40 → "-0.40". */
export function paiseToRupees(paise: number): string {
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${paise < 0 ? "-" : ""}${rupees}.${rest}`;
}
