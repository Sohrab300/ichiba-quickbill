/**
 * Imports the "Current Stock Detail" CSV export into `products` (REQUIREMENTS.md section 2).
 *
 *   npm run import:products -- --dry-run
 *   npm run import:products
 *
 * Options:
 *   --dry-run              Parse, compare with the database and write the report; change nothing.
 *   --file <path>          CSV to import (default: data/stock.csv).
 *   --report <path>        Report CSV to write (default: data/import-report.csv).
 *   --gst-source <source>  "description" (default) or "batch". See GST note below.
 *   --with-ean             Also add each item's "EAN Code" (if a valid EAN/UPC) to product_barcodes.
 *
 * Safe to re-run: products are upserted on item_code. Rows whose values already match are not
 * written. Products that are not in the CSV are left alone (never deleted or deactivated).
 * A re-import overwrites manual edits made in the app to imported fields (price, GST, name, ...).
 *
 * GST note: the export has two tax columns. "Sales Tax %" is recorded per batch at purchase time,
 * so older batches still show the pre-22-Sep-2025 slabs (12% -> 5%, and 18% -> 5% for soaps,
 * shampoos, hair oil, ...). "Tax Description" ("GST 5%") is the item's current tax class and is
 * identical on every batch of an item. The default uses Tax Description and falls back to the
 * chosen batch's Sales Tax %; every disagreement is written to the report as gst_mismatch.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local / .env).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { parseStockReport, type GstSource, type ImportIssue, type ParsedProduct } from "./lib/stock-csv";

type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type Client = SupabaseClient<Database>;

const PAGE_SIZE = 1000; // Supabase max_rows default
const WRITE_CHUNK = 500;
const COMPARED_FIELDS: (keyof ParsedProduct)[] = [
  "name",
  "selling_price",
  "mrp",
  "gst_rate",
  "hsn_code",
  "uom",
  "category",
  "department",
  "stock_qty",
  "is_active",
];

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) loadEnvFile(file); // does not override variables already set
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
  if (missing.length) fail(`Missing ${missing.join(" and ")} (set them in .env.local).`);
  return { url: url!, key: key! };
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeReport(path: string, issues: ImportIssue[]) {
  const header = ["type", "line", "item_code", "name", "message", "chosen", "batches"] as const;
  const lines = [header.join(",")];
  for (const i of issues) lines.push(header.map((h) => csvEscape(i[h])).join(","));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}

async function fetchAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) fail(`Could not read ${label}: ${error.message}. Has the migration been applied (npx supabase db push)?`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return out;
  }
}

function isChanged(existing: ProductRow, next: ParsedProduct): boolean {
  return COMPARED_FIELDS.some((f) => {
    const a = existing[f];
    const b = next[f];
    if (f === "stock_qty") return Number(a) !== Number(b);
    return (a ?? null) !== (b ?? null);
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      file: { type: "string", default: "data/stock.csv" },
      report: { type: "string", default: "data/import-report.csv" },
      "gst-source": { type: "string", default: "description" },
      "with-ean": { type: "boolean", default: false },
    },
    strict: true,
  });
  const dryRun = values["dry-run"]!;
  const withEan = values["with-ean"]!;
  const gstSource = values["gst-source"] as GstSource;
  if (gstSource !== "description" && gstSource !== "batch") fail(`--gst-source must be "description" or "batch".`);
  const file = resolve(values.file!);
  const reportPath = resolve(values.report!);
  if (!existsSync(file)) fail(`CSV not found: ${file}`);

  console.log(`${dryRun ? "[DRY RUN] " : ""}Importing ${file}`);
  const parsed = parseStockReport(readFileSync(file, "utf8"), { gstSource });
  const issues = [...parsed.issues];
  console.log(
    `Parsed ${parsed.itemGroups} items / ${parsed.batchRows} batch rows (category: ${parsed.category ?? "-"}); ` +
      `${parsed.items.length} importable.`
  );

  const { url, key } = loadEnv();
  const supabase: Client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Classify against what is already in the database.
  const existingRows = await fetchAll<ProductRow>("products", (from, to) =>
    supabase.from("products").select("*").order("item_code").range(from, to)
  );
  const existing = new Map(existingRows.map((r) => [r.item_code, r]));

  const toInsert: ParsedProduct[] = [];
  const toUpdate: ParsedProduct[] = [];
  let unchanged = 0;
  for (const { product } of parsed.items) {
    const row = existing.get(product.item_code);
    if (!row) toInsert.push(product);
    else if (isChanged(row, product)) toUpdate.push(product);
    else unchanged++;
  }

  // Write products.
  const idByCode = new Map(existingRows.map((r) => [r.item_code, r.id]));
  if (!dryRun) {
    const writes = [...toInsert, ...toUpdate];
    for (let i = 0; i < writes.length; i += WRITE_CHUNK) {
      const chunk = writes.slice(i, i + WRITE_CHUNK);
      const { data, error } = await supabase
        .from("products")
        .upsert(chunk, { onConflict: "item_code" })
        .select("id, item_code");
      if (error) fail(`Upsert failed at rows ${i + 1}-${i + chunk.length}: ${error.message}. Re-running is safe.`);
      for (const r of data ?? []) idByCode.set(r.item_code, r.id);
      process.stdout.write(`  wrote ${Math.min(i + WRITE_CHUNK, writes.length)}/${writes.length}\r`);
    }
    if (writes.length) process.stdout.write("\n");
  }

  // Optional: EAN aliases.
  let eanAdded = 0;
  let eanExisting = 0;
  if (withEan) {
    const barcodes = await fetchAll<{ barcode: string; product_id: string }>("product_barcodes", (from, to) =>
      supabase.from("product_barcodes").select("barcode, product_id").order("barcode").range(from, to)
    );
    const byBarcode = new Map(barcodes.map((b) => [b.barcode, b.product_id]));
    const codeById = new Map([...idByCode].map(([code, id]) => [id, code]));
    const newAliases: { barcode: string; product_id: string }[] = [];
    for (const item of parsed.items) {
      if (!item.ean) continue;
      const productId = idByCode.get(item.product.item_code);
      const owner = byBarcode.get(item.ean);
      if (owner) {
        if (owner === productId) eanExisting++;
        else
          issues.push({
            type: "ean_conflict",
            line: item.line,
            item_code: item.product.item_code,
            name: item.product.name,
            message: `EAN ${item.ean} is already linked to item ${codeById.get(owner) ?? owner}; not changed`,
            chosen: "",
            batches: "",
          });
        continue;
      }
      if (!productId && !dryRun) continue; // product write failed; reported above
      newAliases.push({ barcode: item.ean, product_id: productId ?? "" });
      byBarcode.set(item.ean, productId ?? "");
    }
    if (!dryRun) {
      for (let i = 0; i < newAliases.length; i += WRITE_CHUNK) {
        const chunk = newAliases.slice(i, i + WRITE_CHUNK);
        const { error } = await supabase
          .from("product_barcodes")
          .upsert(chunk, { onConflict: "barcode", ignoreDuplicates: true });
        if (error) fail(`Barcode insert failed: ${error.message}. Re-running is safe.`);
      }
    }
    eanAdded = newAliases.length;
  }

  writeReport(reportPath, issues);

  const count = (t: ImportIssue["type"]) => issues.filter((i) => i.type === t).length;
  const skipped = parsed.itemGroups - parsed.items.length;
  const verb = dryRun ? "would be " : "";
  console.log(`\n${dryRun ? "DRY RUN — nothing was written.\n" : ""}Totals`);
  console.table({
    items: parsed.itemGroups,
    [`${verb}inserted`]: toInsert.length,
    [`${verb}updated`]: toUpdate.length,
    unchanged,
    skipped,
    conflicts: count("price_conflict"),
  });
  console.log(
    [
      `Report: ${reportPath} (${issues.length} rows)`,
      `  price_conflict ${count("price_conflict")}, gst_mismatch ${count("gst_mismatch")}, ` +
        `missing_hsn ${count("missing_hsn")}, invalid_ean ${count("invalid_ean")}, ean_conflict ${count("ean_conflict")}, mrp_missing ${count("mrp_missing")}, ` +
        `unparsed_row ${count("unparsed_row")}, skipped_item ${count("skipped_item")}`,
      withEan ? `EAN aliases: ${verb}added ${eanAdded}, already linked ${eanExisting}` : `EAN aliases: not imported (pass --with-ean)`,
    ].join("\n")
  );
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
