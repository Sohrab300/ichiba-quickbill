/**
 * One-time flagging of loose fruit & vegetables as sold by weight (REQUIREMENTS.md section 17).
 *
 *   npm run products:flag-weighed -- --dry-run     # print what would change; change nothing
 *   npm run products:flag-weighed
 *
 * Options:
 *   --dry-run        Compare with the database and print the changes; write nothing.
 *   --file <path>    Reviewed list (default: data/weighed-items-review.csv).
 *
 * Reads the reviewed CSV and sets products.sold_by_weight = true for every row whose LAST column
 * is "Y" (matched by item_code). It never sets the flag to false: rows marked N or left blank,
 * and products not in the file, are not touched. Item codes that are not in the database are
 * reported. Safe to re-run (already-flagged products are skipped). Touches only
 * products.sold_by_weight — never prices, invoices or anything else.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local / .env), and
 * the 20261115400000_sold_by_weight migration applied.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { parseWeighedReview } from "./lib/weighed-review";

const CHUNK = 200; // item codes per request (keeps the URL short)

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

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      file: { type: "string", default: "data/weighed-items-review.csv" },
    },
    strict: true,
  });
  const dryRun = values["dry-run"]!;
  const file = resolve(values.file!);
  if (!existsSync(file)) fail(`CSV not found: ${file}`);

  let review;
  try {
    review = parseWeighedReview(readFileSync(file, "utf8"));
  } catch (err: unknown) {
    fail(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`${dryRun ? "[DRY RUN] " : ""}Reviewed list ${file}`);
  console.log(`  ${review.flagged.length} rows marked Y; ${review.notFlagged} rows N/blank (left as they are).`);
  for (const p of review.problems) console.log(`  ! line ${p.line}: ${p.message} (skipped)`);

  const { url, key } = loadEnv();
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const codes = review.flagged.map((r) => r.itemCode);
  const found = new Map<string, { id: string; name: string; sold_by_weight: boolean; is_active: boolean }>();
  for (const part of chunks(codes, CHUNK)) {
    const { data, error } = await supabase
      .from("products")
      .select("id, item_code, name, sold_by_weight, is_active")
      .in("item_code", part);
    if (error) {
      fail(`Could not read products: ${error.message}. Has the sold_by_weight migration been applied (npx supabase db push)?`);
    }
    for (const row of data) found.set(row.item_code, row);
  }

  const missing = review.flagged.filter((r) => !found.has(r.itemCode));
  const already = review.flagged.filter((r) => found.get(r.itemCode)?.sold_by_weight === true);
  const toFlag = review.flagged.filter((r) => found.get(r.itemCode)?.sold_by_weight === false);

  if (toFlag.length) {
    console.log(`\n${dryRun ? "Would flag" : "Flagging"} ${toFlag.length} product(s) as sold by weight:`);
    for (const r of toFlag) {
      const p = found.get(r.itemCode)!;
      const notes = [!p.is_active && "inactive", p.name !== r.name && `CSV name "${r.name}"`].filter(Boolean);
      console.log(`  + ${r.itemCode}  ${p.name}${notes.length ? `  (${notes.join("; ")})` : ""}`);
    }
  }
  if (already.length) console.log(`\nAlready sold by weight (unchanged): ${already.length}`);
  if (missing.length) {
    console.log(`\nNot found in products (${missing.length}) — not flagged:`);
    for (const r of missing) console.log(`  ? ${r.itemCode}  ${r.name}  (line ${r.line})`);
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Nothing was written. Run without --dry-run to flag ${toFlag.length} product(s).`);
    return;
  }
  if (toFlag.length === 0) {
    console.log("\nNothing to change.");
    return;
  }

  let updated = 0;
  for (const part of chunks(toFlag.map((r) => found.get(r.itemCode)!.id), CHUNK)) {
    // Only ever false -> true; never touches any other column.
    const { data, error } = await supabase
      .from("products")
      .update({ sold_by_weight: true })
      .in("id", part)
      .eq("sold_by_weight", false)
      .select("id");
    if (error) fail(`Update failed after ${updated} product(s): ${error.message}`);
    updated += data.length;
  }
  console.log(`\nDone: ${updated} product(s) flagged as sold by weight.${missing.length ? ` ${missing.length} code(s) not found (above).` : ""}`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
