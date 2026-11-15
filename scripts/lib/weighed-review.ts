import { parseCsv } from "./stock-csv";

/**
 * Reads data/weighed-items-review.csv (REQUIREMENTS.md section 17): a header row, then one row per
 * candidate item with item_code in the first column and the reviewer's decision in the LAST
 * column ("Y" = sold by weight). Blank or "N" means "not flagged by this list" — it never clears a
 * flag that is already set.
 */
export interface WeighedReview {
  /** Item codes marked Y, in file order, without duplicates. */
  flagged: { itemCode: string; name: string; line: number }[];
  /** Rows not marked Y (blank or N). */
  notFlagged: number;
  /** Rows that could not be used (no item code, or a decision other than Y / N / blank). */
  problems: { line: number; message: string }[];
}

export function parseWeighedReview(text: string): WeighedReview {
  const records = parseCsv(text).filter((r) => r.cells.some((c) => c.trim() !== ""));
  const [header, ...rows] = records;
  if (!header || header.cells[0]?.trim().toLowerCase() !== "item_code") {
    throw new Error('Expected a header row starting with "item_code".');
  }

  const out: WeighedReview = { flagged: [], notFlagged: 0, problems: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    const itemCode = (r.cells[0] ?? "").trim();
    const decision = (r.cells[r.cells.length - 1] ?? "").trim().toUpperCase();
    if (!/^[0-9A-Za-z_-]{1,32}$/.test(itemCode)) {
      out.problems.push({ line: r.line, message: `invalid item code "${itemCode}"` });
      continue;
    }
    if (decision === "Y") {
      if (seen.has(itemCode)) continue;
      seen.add(itemCode);
      out.flagged.push({ itemCode, name: (r.cells[1] ?? "").trim(), line: r.line });
    } else if (decision === "" || decision === "N") {
      out.notFlagged++;
    } else {
      out.problems.push({ line: r.line, message: `${itemCode}: last column is "${decision}", expected Y, N or blank` });
    }
  }
  return out;
}
