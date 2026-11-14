/**
 * Parser for the "Current Stock Detail" report export (REQUIREMENTS.md section 2).
 *
 * The file is a report, not a flat table:
 *   - a few header records (store name, "CATEGORY : ..."), then a column-header record,
 *   - per item: one summary record (Item Name in column 0), then one or more batch records
 *     (column 0 empty, column 1 = item code), then a blank record,
 *   - a final "Grand Total" record.
 *
 * Pure functions only (no I/O) so the rules can be checked in isolation.
 */

export const ALLOWED_GST_RATES = [0, 5, 12, 18, 28, 40] as const;
export type GstRate = (typeof ALLOWED_GST_RATES)[number];
export type GstSource = "description" | "batch";

export interface ParsedProduct {
  item_code: string;
  name: string;
  selling_price: number; // paise, GST-inclusive
  mrp: number | null; // paise
  gst_rate: GstRate;
  hsn_code: string | null;
  uom: string;
  category: string | null;
  department: string | null;
  stock_qty: number;
  is_active: boolean;
}

export interface ParsedItem {
  product: ParsedProduct;
  /** Valid manufacturer barcode found in the "EAN Code" column, if any. */
  ean: string | null;
  line: number;
}

export type IssueType =
  | "price_conflict"
  | "gst_mismatch"
  | "missing_hsn"
  | "invalid_ean"
  | "ean_conflict"
  | "mrp_missing"
  | "unparsed_row"
  | "skipped_item";

export interface ImportIssue {
  type: IssueType;
  line: number;
  item_code: string;
  name: string;
  message: string;
  chosen: string;
  batches: string;
}

export interface ParseResult {
  items: ParsedItem[];
  issues: ImportIssue[];
  category: string | null;
  /** Number of summary rows (item groups) seen, including ones that were skipped. */
  itemGroups: number;
  batchRows: number;
}

export interface ParseOptions {
  gstSource: GstSource;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

export interface CsvRecord {
  cells: string[];
  /** 1-based line number where the record starts in the file. */
  line: number;
}

/** RFC 4180 CSV parser (quoted fields may contain commas, quotes and newlines). */
export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM

  const endRecord = () => {
    cells.push(field);
    records.push({ cells, line: recordLine });
    cells = [];
    field = "";
  };

  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cells.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new Error(`Unterminated quoted field starting near line ${recordLine}`);
  if (field !== "" || cells.length > 0) endRecord();
  return records;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decodes the HTML entities the export emits (`&amp;`, `&#39;`, `&#x27;`, ...). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? m;
  });
}

/** Decodes entities, trims and collapses internal whitespace. */
export function cleanText(s: string): string {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

const NUMBER_RE = /^-?(\d{1,3}(,\d{2,3})*|\d+)(\.\d+)?$/;

/** Parses "1,190.00" style numbers. Returns null when the cell is not a number. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (!NUMBER_RE.test(s)) return null;
  return Number(s.replace(/,/g, ""));
}

/** Converts a rupee amount string ("1,190.00") to integer paise without float drift. */
export function toPaise(raw: string): number | null {
  const s = raw.trim();
  if (!NUMBER_RE.test(s)) return null;
  const negative = s.startsWith("-");
  const [intPart, fracPart = ""] = s.replace(/^-/, "").replace(/,/g, "").split(".");
  let paise = Number(intPart) * 100 + Number((fracPart + "00").slice(0, 2));
  // Round half up on the third decimal, if present.
  if (fracPart.length > 2 && Number(fracPart[2]) >= 5) paise += 1;
  return negative ? -paise : paise;
}

/** GTIN-8/12/13/14 check-digit validation. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

function formatPaise(p: number | null): string {
  return p === null ? "-" : (p / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// Report parsing
// ---------------------------------------------------------------------------

const COL = {
  itemName: "Item Name",
  itemCode: "Item Code",
  selling: "Selling",
  mrp: "MRP",
  batchNo: "Batch No",
  expiry: "Expiry Date",
  stock: "Current Stock",
  salesTax: "Sales Tax %",
  hsnTxn: "HSN_SAC Code(Transaction)",
  hsnItem: "HSN_SAC Code",
  dept: "Dept. Name",
  uom: "UOM",
  ean: "EAN Code",
  taxDescription: "Tax Description",
  status: "Status",
} as const;

const REQUIRED_COLUMNS = [
  COL.itemName,
  COL.itemCode,
  COL.selling,
  COL.mrp,
  COL.batchNo,
  COL.expiry,
  COL.stock,
  COL.salesTax,
  COL.hsnTxn,
  COL.dept,
  COL.uom,
];

interface Batch {
  line: number;
  index: number; // position within the item, 0-based
  itemCode: string;
  selling: number;
  mrp: number | null;
  stock: number;
  expiry: string; // YYYY-MM-DD or ""
  batchNo: string;
  salesTax: number | null;
  taxDescriptionRate: number | null;
  hsnTxn: string;
  hsnItem: string;
  dept: string;
  uom: string;
  ean: string;
  inactive: boolean;
}

interface ItemGroup {
  name: string;
  line: number;
  rows: CsvRecord[];
}

const isBlank = (r: CsvRecord) => r.cells.every((c) => c.trim() === "");

function describeBatch(b: Batch): string {
  return [
    `batch=${b.batchNo || "-"}`,
    `exp=${b.expiry || "-"}`,
    `stock=${b.stock}`,
    `selling=${formatPaise(b.selling)}`,
    `mrp=${formatPaise(b.mrp)}`,
    `tax=${b.salesTax ?? "-"}%`,
  ].join(" ");
}

/**
 * Price rule (REQUIREMENTS.md section 2, [DEFAULT]):
 * the batch with Current Stock > 0; if several, the one with the latest expiry; if none in stock,
 * the last batch listed. Batches without an expiry rank below dated ones; ties go to the batch
 * listed last.
 */
export function chooseBatch<T extends { stock: number; expiry: string; index: number }>(batches: T[]): T {
  const inStock = batches.filter((b) => b.stock > 0);
  if (inStock.length === 0) return batches[batches.length - 1];
  return inStock.reduce((best, b) => {
    if (b.expiry === best.expiry) return b.index > best.index ? b : best;
    if (b.expiry === "") return best;
    if (best.expiry === "") return b;
    return b.expiry > best.expiry ? b : best;
  });
}

export function parseStockReport(text: string, options: ParseOptions): ParseResult {
  const records = parseCsv(text);
  const issues: ImportIssue[] = [];

  const headerIdx = records.findIndex(
    (r) => r.cells[0]?.trim() === COL.itemName && r.cells[1]?.trim() === COL.itemCode
  );
  if (headerIdx === -1) {
    throw new Error(`Column header row not found (expected a row starting "${COL.itemName},${COL.itemCode}").`);
  }
  const header = records[headerIdx].cells.map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const missing = REQUIRED_COLUMNS.filter((c) => col(c) === -1);
  if (missing.length) throw new Error(`Missing columns in header row: ${missing.join(", ")}`);

  // Category comes from the report header ("CATEGORY : Beauty &amp; Personal Care ;").
  let category: string | null = null;
  for (const r of records.slice(0, headerIdx)) {
    for (const cell of r.cells) {
      const m = decodeEntities(cell).match(/CATEGORY\s*:\s*([^;\n]+)/i);
      if (m) category = cleanText(m[1]) || null;
    }
  }

  // Group rows: summary row starts an item, batch rows attach to it.
  const groups: ItemGroup[] = [];
  let current: ItemGroup | null = null;
  let sawGrandTotal = false;
  let batchRows = 0;

  const unparsed = (r: CsvRecord, message: string) =>
    issues.push({
      type: "unparsed_row",
      line: r.line,
      item_code: r.cells[1]?.trim() ?? "",
      name: cleanText(r.cells[0] ?? ""),
      message,
      chosen: "",
      batches: r.cells.slice(0, 5).join(" | "),
    });

  for (const r of records.slice(headerIdx + 1)) {
    if (isBlank(r)) {
      current = null;
      continue;
    }
    const c0 = r.cells[0]?.trim() ?? "";
    const c1 = r.cells[1]?.trim() ?? "";
    if (/^grand total$/i.test(c0)) {
      sawGrandTotal = true;
      current = null;
      continue;
    }
    if (sawGrandTotal) {
      unparsed(r, "Row after Grand Total");
    } else if (c0 && !c1) {
      current = { name: cleanText(c0), line: r.line, rows: [] };
      groups.push(current);
    } else if (!c0 && c1) {
      batchRows++;
      if (current) current.rows.push(r);
      else unparsed(r, "Batch row without a preceding item summary row");
    } else {
      unparsed(r, "Row has both Item Name and Item Code (not a summary or batch row)");
    }
  }

  const items: ParsedItem[] = [];
  const seenCodes = new Map<string, number>();

  for (const g of groups) {
    const skip = (message: string, itemCode = "", batches = "") =>
      issues.push({ type: "skipped_item", line: g.line, item_code: itemCode, name: g.name, message, chosen: "", batches });

    if (!g.name) {
      skip("Empty item name");
      continue;
    }
    if (g.rows.length === 0) {
      skip("Item has no batch rows");
      continue;
    }

    const batches: Batch[] = [];
    for (const r of g.rows) {
      const cell = (name: string) => {
        const i = col(name);
        return i === -1 ? "" : (r.cells[i] ?? "").trim();
      };
      const selling = toPaise(cell(COL.selling));
      const mrp = toPaise(cell(COL.mrp));
      const stock = parseNumber(cell(COL.stock));
      const expiry = cell(COL.expiry);
      const problems: string[] = [];
      if (selling === null || selling < 0) problems.push(`Selling "${cell(COL.selling)}"`);
      if (mrp === null || mrp < 0) problems.push(`MRP "${cell(COL.mrp)}"`);
      if (stock === null) problems.push(`Current Stock "${cell(COL.stock)}"`);
      if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) problems.push(`Expiry Date "${expiry}"`);
      if (problems.length) {
        unparsed(r, `Unparseable ${problems.join(", ")}`);
        continue;
      }
      const taxDesc = cleanText(cell(COL.taxDescription));
      const descMatch = taxDesc.match(/GST\s*(\d+(?:\.\d+)?)\s*%/i);
      batches.push({
        line: r.line,
        index: batches.length,
        itemCode: cell(COL.itemCode),
        selling: selling!,
        mrp: mrp === 0 ? null : mrp,
        stock: stock!,
        expiry,
        batchNo: cleanText(cell(COL.batchNo)),
        salesTax: parseNumber(cell(COL.salesTax)),
        taxDescriptionRate: descMatch ? Number(descMatch[1]) : null,
        hsnTxn: cell(COL.hsnTxn),
        hsnItem: cell(COL.hsnItem),
        dept: cleanText(cell(COL.dept)),
        uom: cleanText(cell(COL.uom)),
        ean: cell(COL.ean),
        inactive: /^inactive$/i.test(cell(COL.status)),
      });
    }

    const allBatches = batches.map(describeBatch).join(" || ");
    if (batches.length === 0) {
      skip("No parseable batch rows", g.rows[0]?.cells[1]?.trim() ?? "");
      continue;
    }

    const codes = [...new Set(batches.map((b) => b.itemCode))];
    if (codes.length > 1) {
      skip(`Batches have different item codes: ${codes.join(", ")}`, codes.join("/"), allBatches);
      continue;
    }
    const itemCode = codes[0];
    if (!/^[0-9A-Za-z_-]{1,32}$/.test(itemCode)) {
      skip(`Invalid item code "${itemCode}"`, itemCode, allBatches);
      continue;
    }
    if (seenCodes.has(itemCode)) {
      skip(`Duplicate item code (first seen on line ${seenCodes.get(itemCode)})`, itemCode, allBatches);
      continue;
    }
    if (g.name.length > 255) {
      skip("Item name longer than 255 characters", itemCode, allBatches);
      continue;
    }

    const chosen = chooseBatch(batches);
    const chosenDesc = describeBatch(chosen);
    const issue = (type: IssueType, message: string) =>
      issues.push({ type, line: g.line, item_code: itemCode, name: g.name, message, chosen: chosenDesc, batches: allBatches });

    // Price conflicts: batches disagree on selling price or MRP.
    const pricePairs = new Set(batches.map((b) => `${b.selling}/${b.mrp}`));
    if (pricePairs.size > 1) {
      const reason =
        batches.some((b) => b.stock > 0)
          ? batches.filter((b) => b.stock > 0).length > 1
            ? "several batches in stock: latest expiry"
            : "only batch in stock"
          : "none in stock: last batch listed";
      issue("price_conflict", `${pricePairs.size} different selling/MRP prices; used ${reason}`);
    }

    if (chosen.mrp === null) issue("mrp_missing", "MRP is 0 or empty; stored as no MRP");
    if (chosen.mrp !== null && chosen.selling > chosen.mrp) {
      skip(`Selling price ${formatPaise(chosen.selling)} is above MRP ${formatPaise(chosen.mrp)}`, itemCode, allBatches);
      continue;
    }

    // GST: "Tax Description" is the item's current tax class (identical on every batch of an item);
    // "Sales Tax %" is the rate recorded on the batch at purchase time (pre-Sept-2025 batches still
    // carry the old 12%/18% slabs). See the import script header for the decision.
    const descRate = chosen.taxDescriptionRate ?? batches.find((b) => b.taxDescriptionRate !== null)?.taxDescriptionRate ?? null;
    const batchRate = chosen.salesTax;
    const rate = options.gstSource === "description" ? (descRate ?? batchRate) : (batchRate ?? descRate);
    if (rate === null || !(ALLOWED_GST_RATES as readonly number[]).includes(rate)) {
      skip(`GST rate not usable (Sales Tax % = ${batchRate ?? "-"}, Tax Description = ${descRate ?? "-"})`, itemCode, allBatches);
      continue;
    }
    if (descRate !== null && batchRate !== null && descRate !== batchRate) {
      issue(
        "gst_mismatch",
        `Tax Description says ${descRate}%, chosen batch Sales Tax % says ${batchRate}%; used ${rate}% (--gst-source=${options.gstSource})`
      );
    }

    // HSN: the item-level column is consistent per item; the per-transaction one is often blank.
    const hsnCandidates = [
      ...batches.map((b) => b.hsnItem),
      chosen.hsnTxn,
      ...batches.map((b) => b.hsnTxn),
    ].filter((h) => /^\d{4,8}$/.test(h));
    const hsn = hsnCandidates[0] ?? null;
    if (!hsn) issue("missing_hsn", "No valid HSN code on any batch");

    // UOM: the export's UOM column holds a conversion factor ("1.00"), not a unit name.
    const uomRaw = chosen.uom;
    const uom = uomRaw && parseNumber(uomRaw) === null ? uomRaw.toUpperCase().slice(0, 16) : "PCS";

    // EAN: optional manufacturer barcode column.
    const eanRaw = batches.map((b) => b.ean).find((e) => e !== "") ?? "";
    let ean: string | null = null;
    if (eanRaw) {
      if (isValidGtin(eanRaw)) ean = eanRaw;
      else issue("invalid_ean", `EAN Code "${eanRaw}" is not a valid EAN/UPC (check digit or length)`);
    }

    const stockQty = Math.round(batches.reduce((s, b) => s + b.stock, 0) * 1000) / 1000;

    seenCodes.set(itemCode, g.line);
    items.push({
      line: g.line,
      ean,
      product: {
        item_code: itemCode,
        name: g.name,
        selling_price: chosen.selling,
        mrp: chosen.mrp,
        gst_rate: rate as GstRate,
        hsn_code: hsn,
        uom,
        category,
        department: chosen.dept || null,
        stock_qty: stockQty,
        is_active: !batches.every((b) => b.inactive),
      },
    });
  }

  return { items, issues, category, itemGroups: groups.length, batchRows };
}
