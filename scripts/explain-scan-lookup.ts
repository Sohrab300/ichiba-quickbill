/**
 * Scan lookup performance check (REQUIREMENTS.md section 11: scan-to-cart under ~300 ms with
 * ~2,000 products). Read-only: it never writes to the database.
 *
 * 1. EXPLAIN (ANALYZE) of the deployed lookup_product() query — its body is read from
 *    pg_proc, so this tests what is really installed — for a barcode alias, an item code and an
 *    unknown code. Fails unless every lookup is an index scan (no Seq Scan).
 * 2. EXPLAIN of the billing screen's name search (getProducts), for information: at this
 *    catalog size Postgres may prefer a sequential scan, which is fine while it stays fast.
 * 3. Times lookup_product RPC round trips from this machine (information only). This is mostly
 *    network distance to the database region. In production a scan is browser → Vercel function
 *    → Supabase, and each server action makes 2–3 database calls, so the Vercel functions must run
 *    in the database's region (vercel.json "regions"); then this number approximates a scan.
 *
 * The EXPLAINs run through the Supabase CLI in a read-only transaction (EXPLAIN plans are not
 * available over the REST API):
 *
 *   npm run db:explain                     # the linked project (npx supabase link)
 *   npm run db:explain -- --local          # local stack (npx supabase start)
 *   npm run db:explain -- --calls 50       # more round trips (default 20)
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local) for step 3.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    local: { type: "boolean", default: false },
    calls: { type: "string", default: "20" },
  },
});

/** Per-lookup database execution time we consider healthy (the 300 ms budget is end to end). */
const MAX_EXECUTION_MS = 20;

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Runs one SQL statement through the Supabase CLI, read-only, and returns its rows. */
function query<Row = Record<string, unknown>>(sql: string): Row[] {
  const target = args.local ? [] : ["--remote"];
  const out = execFileSync("npx", ["supabase", "db", "query", ...target, "--read-only", "-o", "json", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const json = JSON.parse(out.slice(out.indexOf("{"))) as { rows?: Row[] };
  return json.rows ?? [];
}

function explain(sql: string): { plan: string; executionMs: number | null } {
  const rows = query<Record<string, string>>(`explain (analyze, buffers, format text) ${sql}`);
  const plan = rows.map((r) => Object.values(r)[0]).join("\n");
  const m = plan.match(/Execution Time: ([\d.]+) ms/);
  return { plan, executionMs: m ? Number(m[1]) : null };
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  console.log(`\nScan lookup check — ${args.local ? "local database" : "linked project"}\n`);

  const [counts] = query<{ products: number; barcodes: number }>(
    "select (select count(*) from public.products)::int as products, (select count(*) from public.product_barcodes)::int as barcodes"
  );
  console.log(`  ${counts.products} products, ${counts.barcodes} barcode aliases\n`);

  const [fn] = query<{ src: string }>(
    "select p.prosrc as src from pg_proc p where p.oid = to_regprocedure('public.lookup_product(text)')"
  );
  if (!fn) throw new Error("lookup_product(text) is not installed — apply the migrations first.");

  const [sample] = query<{ barcode: string | null; item_code: string | null }>(
    "select (select barcode from public.product_barcodes order by random() limit 1) as barcode, " +
      "(select item_code from public.products where is_active order by random() limit 1) as item_code"
  );

  // lookup_product() pins search_path, so Postgres runs it as an opaque function call; explain
  // its body with the code inlined to see which indexes it uses.
  const body = (code: string) => fn.src.trim().replace(/;\s*$/, "").replace(/\bp_code\b/g, quote(code));

  console.log("1. lookup_product() query plans");
  const cases: { name: string; code: string | null; mustUse: string[] }[] = [
    { name: "barcode alias", code: sample.barcode, mustUse: ["product_barcodes_barcode_key", "products_pkey"] },
    { name: "item code", code: sample.item_code, mustUse: ["products_item_code_key", "products_pkey"] },
    { name: "unknown code", code: "0000000000000", mustUse: ["product_barcodes_barcode_key", "products_item_code_key"] },
  ];
  for (const c of cases) {
    if (!c.code) {
      check(`${c.name}: no sample in the database`, false);
      continue;
    }
    const { plan, executionMs } = explain(body(c.code));
    const missing = c.mustUse.filter((index) => !plan.includes(`using ${index}`));
    const seqScan = /Seq Scan/.test(plan);
    check(
      `${c.name} (${c.code}): index scans only`,
      missing.length === 0 && !seqScan,
      seqScan ? "plan has a Seq Scan" : missing.length ? `index not used: ${missing.join(", ")}` : undefined
    );
    check(
      `${c.name}: executes in under ${MAX_EXECUTION_MS} ms`,
      executionMs !== null && executionMs < MAX_EXECUTION_MS,
      executionMs === null ? "no timing in plan" : `${executionMs.toFixed(2)} ms`
    );
  }

  console.log("\n2. Name search (billing dropdown, 8 rows) — information only");
  {
    const term = "%cream%";
    const { plan, executionMs } = explain(
      "select p.*, count(*) over () as total from public.products p " +
        `where p.name ilike ${quote(term)} or p.item_code ilike ${quote(term)} or p.category ilike ${quote(term)} ` +
        "order by p.name limit 8"
    );
    const scan = plan.match(/(Seq Scan|Bitmap Heap Scan|Index Scan)[^\n]*on products/)?.[0] ?? "(see plan)";
    console.log(`  INFO  ${scan}; ${executionMs?.toFixed(2) ?? "?"} ms`);
  }

  console.log("\n3. lookup_product RPC round trips from this machine");
  for (const file of [".env.local", ".env"]) if (existsSync(file)) loadEnvFile(file);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.log("  SKIP  NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  } else {
    // Plain fetch to PostgREST (what supabase-js does underneath), so this also runs on Node 20.
    const rpc = async (code: string) => {
      const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/lookup_product`, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ p_code: code }),
      });
      if (!res.ok) throw new Error(`lookup_product failed: HTTP ${res.status} ${await res.text()}`);
      await res.json();
    };
    const codes = [sample.barcode, sample.item_code, "0000000000000"].filter((c): c is string => !!c);
    const n = Math.max(1, Number(args.calls) || 20);
    await rpc(codes[0]); // warm up the connection
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const started = performance.now();
      await rpc(codes[i % codes.length]);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    console.log(
      `  INFO  ${n} calls: p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, max ${times[times.length - 1].toFixed(0)} ms`
    );
    console.log("        Network distance from this machine; the end-to-end scan test is in docs/LAUNCH_CHECKLIST.md.");
  }

  console.log(failures ? `\n${failures} check(s) failed.\n` : "\nAll checks passed.\n");
  process.exitCode = failures ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
