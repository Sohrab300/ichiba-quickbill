/**
 * Integration test for create_invoice() (REQUIREMENTS.md sections 3, 5, 6).
 *
 * Fires N parallel create_invoice calls spread over CL1/CL2/CL3, plus M calls that all reuse ONE
 * idempotency key (interleaved, so they race each other), then checks:
 *   - every call succeeded; the repeated key produced exactly one invoice;
 *   - no duplicate invoice_no; each counter's numbers for the FY are contiguous 1..n
 *     (failed validation calls in between must not burn numbers);
 *   - lines were priced from the DB, duplicates merged, totals equal src/lib/gst.ts;
 *   - replay returns the invoice unchanged; get_invoice returns the same JSON;
 *   - the service role cannot INSERT/UPDATE/DELETE invoices directly.
 *
 * !! It creates REAL invoices, and invoices are immutable: the API cannot delete them. Run it on
 * !! a throwaway database — local `npx supabase start`, or a Supabase branch — not on the store's
 * !! live project once billing has started (it would consume real invoice numbers).
 *
 *   npm run test:concurrency                               # NEXT_PUBLIC_SUPABASE_URL is localhost
 *   npm run test:concurrency -- --project-ref <ref>        # hosted project: must name its ref
 *
 * Options:
 *   --calls <n>        parallel calls with distinct keys (default 50)
 *   --repeat <n>       extra calls sharing one key (default 5)
 *   --project-ref <r>  required when the URL is not localhost; must match <r>.supabase.co
 *
 * Uses existing active staff logins on CL1/CL2/CL3 as cashiers; for a counter without one it
 * creates a temporary login and deletes it at the end. Writes the ids/keys of every invoice it
 * created to data/test-concurrency-<timestamp>.json.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local / .env), products
 * imported, and the invoices migration applied.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { createClient, type PostgrestError } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { computeInvoiceTotals } from "../src/lib/gst";
import { PAYMENT_METHODS } from "../src/lib/constants";
import { invoiceJsonSchema, type Invoice } from "../src/lib/invoice";

const COUNTER_CODES = ["CL1", "CL2", "CL3"] as const;
type CounterCode = (typeof COUNTER_CODES)[number];

class FatalError extends Error {}

/** Throws (rather than exiting) so the finally block still deletes temporary logins. */
function die(message: string): never {
  throw new FatalError(message);
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): boolean {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log("        ", typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return ok;
}

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) loadEnvFile(file);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
  if (missing.length) die(`Missing ${missing.join(" and ")} (set them in .env.local).`);
  return { url: url!, key: key! };
}

/** Deterministic PRNG so a failing run can be reproduced. */
function prng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) % n;
  };
}

interface ItemReq {
  product_id: string;
  qty: number;
}
interface CallReq {
  key: string;
  counter: CounterCode;
  items: ItemReq[];
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  repeat: boolean;
}

async function main() {
  const { values } = parseArgs({
    options: {
      calls: { type: "string", default: "50" },
      repeat: { type: "string", default: "5" },
      "project-ref": { type: "string" },
    },
    strict: true,
  });
  const calls = Number(values.calls);
  const repeats = Number(values.repeat);
  if (!Number.isInteger(calls) || calls < 3 || calls > 1000) die("--calls must be 3..1000");
  if (!Number.isInteger(repeats) || repeats < 2 || repeats > 50) die("--repeat must be 2..50");

  const { url, key } = loadEnv();
  const host = new URL(url).hostname;
  const isLocal = ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(host);
  if (!isLocal) {
    const ref = host.endsWith(".supabase.co") ? host.split(".")[0] : host;
    if (values["project-ref"] !== ref) {
      die(
        `NEXT_PUBLIC_SUPABASE_URL points at hosted project "${ref}". This test writes real, immutable invoices.\n` +
          `Use a local stack or a Supabase branch. To run it against "${ref}" anyway, pass --project-ref ${ref}.`
      );
    }
  }

  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const rand = prng(Number(runId.replace(/\D/g, "").slice(-9)));
  console.log(`Target: ${url}  run ${runId}  (${calls} calls + ${repeats} × one key)`);

  // ---- Setup -------------------------------------------------------------------------------
  const { data: settings, error: settingsError } = await db.from("store_settings").select("fy_label").single();
  if (settingsError) die(`store_settings: ${settingsError.message}`);
  const fy = settings.fy_label;

  const { data: counterRows, error: counterError } = await db
    .from("counters")
    .select("id, code, invoice_prefix, is_active")
    .in("code", [...COUNTER_CODES]);
  if (counterError) die(`counters: ${counterError.message}`);
  const counters = {} as Record<CounterCode, { id: string; prefix: string }>;
  for (const code of COUNTER_CODES) {
    const c = counterRows.find((r) => r.code === code);
    if (!c || !c.is_active) die(`Counter ${code} is missing or inactive.`);
    counters[code] = { id: c.id, prefix: c.invoice_prefix };
  }

  const tempUsers: string[] = [];
  const cashiers = {} as Record<CounterCode, string>;
  try {
    const { data: profiles, error: profileError } = await db
      .from("staff_profiles")
      .select("user_id, counter_id")
      .eq("is_active", true)
      .in("counter_id", COUNTER_CODES.map((c) => counters[c].id));
    if (profileError) die(`staff_profiles: ${profileError.message}`);
    for (const code of COUNTER_CODES) {
      const existing = profiles.find((p) => p.counter_id === counters[code].id);
      if (existing) {
        cashiers[code] = existing.user_id;
        continue;
      }
      const { data: created, error } = await db.auth.admin.createUser({
        email: `concurrency-test-${runId.toLowerCase()}-${code.toLowerCase()}@example.invalid`,
        password: randomBytes(24).toString("base64url"),
        email_confirm: true,
      });
      if (error || !created.user) die(`Could not create a temporary cashier for ${code}: ${error?.message}`);
      tempUsers.push(created.user.id);
      const { error: insertError } = await db.from("staff_profiles").insert({
        user_id: created.user.id,
        display_name: `Concurrency test ${code}`,
        role: "cashier",
        counter_id: counters[code].id,
      });
      if (insertError) die(`Could not create a temporary staff profile: ${insertError.message}`);
      cashiers[code] = created.user.id;
      console.log(`  (created temporary cashier for ${code})`);
    }

    // A spread of active products over every GST rate.
    const { data: productRows, error: productError } = await db
      .from("products")
      .select("id, item_code, selling_price, gst_rate, is_active")
      .eq("is_active", true)
      .order("item_code")
      .limit(1000);
    if (productError) die(`products: ${productError.message}`);
    const byRate = new Map<number, typeof productRows>();
    for (const p of productRows) byRate.set(p.gst_rate, [...(byRate.get(p.gst_rate) ?? []), p]);
    const products = [...byRate.values()].flatMap((list) => list.slice(0, 6));
    if (products.length < 2) die("Need at least 2 active products (run npm run import:products).");
    const priceOf = new Map(products.map((p) => [p.id, p.selling_price]));
    const { data: inactiveRows } = await db.from("products").select("id").eq("is_active", false).limit(1);

    // Baseline: what each counter already has for this FY.
    const baseline = {} as Record<CounterCode, { count: number; max: number }>;
    for (const code of COUNTER_CODES) {
      const { count, error } = await db
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("counter_id", counters[code].id)
        .eq("fy", fy);
      if (error) die(`invoices (is the invoices migration applied?): ${error.message}`);
      const { data: top } = await db
        .from("invoices")
        .select("seq_number")
        .eq("counter_id", counters[code].id)
        .eq("fy", fy)
        .order("seq_number", { ascending: false })
        .limit(1);
      baseline[code] = { count: count ?? 0, max: top?.[0]?.seq_number ?? 0 };
    }
    console.log(`  FY ${fy}; existing invoices: ${COUNTER_CODES.map((c) => `${c}=${baseline[c].count}`).join(" ")}`);

    // ---- Requests ----------------------------------------------------------------------------
    const pickItems = (): ItemReq[] => {
      const lines = Array.from({ length: 1 + rand(5) }, () => ({
        product_id: products[rand(products.length)].id,
        qty: 1 + rand(4),
      }));
      if (rand(4) === 0) lines.push({ product_id: lines[0].product_id, qty: 1 + rand(3) }); // merged by the RPC
      return lines;
    };
    const reqs: CallReq[] = Array.from({ length: calls }, (_, i) => ({
      key: randomUUID(),
      counter: COUNTER_CODES[i % 3],
      items: pickItems(),
      paymentMethod: PAYMENT_METHODS[rand(3)],
      repeat: false,
    }));
    const repeatKey = randomUUID();
    const repeatItems = pickItems();
    for (let i = 0; i < repeats; i++) {
      const at = Math.floor(((i + 1) * reqs.length) / (repeats + 1));
      reqs.splice(at, 0, { key: repeatKey, counter: "CL2", items: repeatItems, paymentMethod: "upi", repeat: true });
    }

    const rpc = (r: { key: string; counter: CounterCode; items: unknown; paymentMethod: string; cashier?: string }) =>
      db.rpc("create_invoice", {
        p_idempotency_key: r.key,
        p_counter_id: counters[r.counter].id,
        p_cashier_user_id: r.cashier ?? cashiers[r.counter],
        p_items: r.items as Database["public"]["Functions"]["create_invoice"]["Args"]["p_items"],
        p_payment_method: r.paymentMethod,
      });

    // ---- 1. The storm ------------------------------------------------------------------------
    console.log(`\n1. ${reqs.length} parallel create_invoice calls`);
    const t0 = performance.now();
    const responses = await Promise.all(reqs.map((r) => rpc(r)));
    console.log(`  (${Math.round(performance.now() - t0)} ms)`);
    // Keys are recorded before any assertion so a later cleanup knows everything this run sent.
    writeRunFile(runId, url, reqs.map((r) => r.key), []);

    // A database error (SQLSTATE / PGRST code) means the sale was rejected and rolled back. No
    // code means the HTTP request failed with no answer: the invoice may or may not exist.
    const isDbError = (e: PostgrestError) => /^[0-9A-Z]{5}$/.test(e.code ?? "") || (e.code ?? "").startsWith("PGRST");
    const dbErrors = responses.flatMap((r, i) => (r.error && isDbError(r.error) ? [`${reqs[i].counter}: ${r.error.code} ${r.error.message}`] : []));
    check("no call was rejected by the database", dbErrors.length === 0, dbErrors.slice(0, 5));
    const lost = responses.flatMap((r, i) => (r.error && !isDbError(r.error) ? [i] : []));
    check(`${reqs.length - lost.length}/${reqs.length} calls answered`, true);
    if (lost.length > 0) {
      const e = responses[lost[0]].error!;
      const cause = e.details?.match(/Caused by: (.*)/)?.[1] ?? e.details?.split("\n")[0] ?? "";
      console.log(`  NOTE  ${lost.length} call(s) got no answer (${e.message}${cause ? ` — ${cause}` : ""}).`);
      console.log(`        Re-sending the same keys, as "Check status" does; each must resolve to exactly one invoice.`);
      for (const i of lost) responses[i] = await rpc(reqs[i]);
      const stillFailing = lost.filter((i) => responses[i].error);
      check(
        `every unanswered call resolved by re-sending its key`,
        stillFailing.length === 0,
        stillFailing.map((i) => `${responses[i].error?.code} ${responses[i].error?.message}`)
      );
    }
    const invoices: (Invoice | null)[] = responses.map((r) => {
      if (r.error) return null;
      const parsed = invoiceJsonSchema.safeParse(r.data);
      if (!parsed.success) check("response matches the invoice JSON shape", false, parsed.error.issues.slice(0, 3));
      return parsed.success ? parsed.data : null;
    });

    const created = new Map<string, Invoice>();
    for (const inv of invoices) if (inv) created.set(inv.id, inv);
    const createdList = [...created.values()];

    writeRunFile(runId, url, reqs.map((r) => r.key), createdList);
    // Every distinct key must now map to exactly one invoice row.
    const distinctKeys = [...new Set(reqs.map((r) => r.key))];
    const { count: rowsForKeys } = await db
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .in("idempotency_key", distinctKeys);
    check(`${distinctKeys.length} keys sent → ${distinctKeys.length} invoice rows`, rowsForKeys === distinctKeys.length, rowsForKeys);

    // ---- 2. Idempotency ----------------------------------------------------------------------
    console.log("\n2. Same idempotency key");
    const repeatIds = new Set(reqs.flatMap((r, i) => (r.repeat ? [invoices[i]?.id ?? "error"] : [])));
    check(`${repeats} calls with one key returned one invoice`, repeatIds.size === 1 && !repeatIds.has("error"), [...repeatIds]);
    const { count: repeatCount } = await db
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("idempotency_key", repeatKey);
    check("exactly one row in invoices for that key", repeatCount === 1, repeatCount);
    check(`${calls + 1} distinct invoices created`, created.size === calls + 1, created.size);

    // ---- 3. Content and GST ------------------------------------------------------------------
    console.log("\n3. Content and GST");
    let contentProblems: string[] = [];
    let gstProblems: string[] = [];
    reqs.forEach((r, i) => {
      const inv = invoices[i];
      if (!inv) return;
      const merged = new Map<string, number>();
      for (const it of r.items) merged.set(it.product_id, (merged.get(it.product_id) ?? 0) + it.qty);
      const expected = JSON.stringify([...merged.entries()]);
      const got = JSON.stringify(inv.items.map((it) => [it.productId, it.qtyMilli / 1000])); // whole pieces here
      if (expected !== got) contentProblems.push(`${inv.invoiceNo}: lines ${got} ≠ ${expected}`);
      if (inv.counterId !== counters[r.counter].id) contentProblems.push(`${inv.invoiceNo}: wrong counter`);
      if (inv.cashierUserId !== cashiers[r.counter]) contentProblems.push(`${inv.invoiceNo}: wrong cashier`);
      const expectedNo = `${counters[r.counter].prefix}/${fy}/${String(inv.seqNumber).padStart(6, "0")}`;
      if (inv.invoiceNo !== expectedNo) contentProblems.push(`${inv.invoiceNo} ≠ ${expectedNo}`);
      for (const it of inv.items) {
        if (priceOf.get(it.productId) !== it.unitPrice) contentProblems.push(`${inv.invoiceNo}: ${it.itemCode} price not from products`);
      }

      const { lines, totals } = computeInvoiceTotals(
        inv.items.map((it) => ({ unitPrice: it.unitPrice, gstRate: it.gstRate, qtyMilli: it.qtyMilli, soldByWeight: it.soldByWeight }))
      );
      const dbTotals = {
        itemCount: inv.itemCount,
        totalQtyMilli: inv.totalQtyMilli,
        subtotal: inv.subtotal,
        taxableTotal: inv.taxableTotal,
        cgstTotal: inv.cgstTotal,
        sgstTotal: inv.sgstTotal,
        roundOff: inv.roundOff,
        grandTotal: inv.grandTotal,
      };
      if (JSON.stringify(totals) !== JSON.stringify(dbTotals)) {
        gstProblems.push(`${inv.invoiceNo}: db ${JSON.stringify(dbTotals)} ts ${JSON.stringify(totals)}`);
      }
      lines.forEach((l, j) => {
        const d = inv.items[j];
        if (l.lineTotal !== d.lineTotal || l.taxableValue !== d.taxableValue || l.cgst !== d.cgst || l.sgst !== d.sgst) {
          gstProblems.push(`${inv.invoiceNo} line ${d.lineNo}`);
        }
      });
      const summaryTaxable = inv.taxSummary.reduce((a, s) => a + s.taxableValue, 0);
      const summaryGst = inv.taxSummary.reduce((a, s) => a + s.cgst + s.sgst, 0);
      if (summaryTaxable !== inv.taxableTotal || summaryGst !== inv.cgstTotal + inv.sgstTotal) {
        gstProblems.push(`${inv.invoiceNo}: tax summary does not add up`);
      }
    });
    contentProblems = [...new Set(contentProblems)];
    gstProblems = [...new Set(gstProblems)];
    check("lines priced from products, duplicates merged, counter/cashier/number format right", contentProblems.length === 0, contentProblems.slice(0, 5));
    check("database GST and totals equal src/lib/gst.ts on every invoice", gstProblems.length === 0, gstProblems.slice(0, 5));

    // ---- 4. Rejections must not burn numbers -------------------------------------------------
    console.log("\n4. Invalid sales are rejected (and must not consume numbers)");
    const anyProduct = products[0].id;
    const expectCode = async (name: string, res: PromiseLike<{ error: PostgrestError | null }>, code: string) => {
      const { error } = await res;
      check(`${name} → ${code}`, error?.code === code, error ? `${error.code} ${error.message}` : "no error (an invoice was created!)");
    };
    await expectCode("empty cart", rpc({ key: randomUUID(), counter: "CL1", items: [], paymentMethod: "cash" }), "22023");
    await expectCode("qty 0", rpc({ key: randomUUID(), counter: "CL1", items: [{ product_id: anyProduct, qty: 0 }], paymentMethod: "cash" }), "22023");
    await expectCode("unknown product", rpc({ key: randomUUID(), counter: "CL2", items: [{ product_id: randomUUID(), qty: 1 }], paymentMethod: "cash" }), "22023");
    if (inactiveRows?.[0]) {
      await expectCode("inactive product", rpc({ key: randomUUID(), counter: "CL3", items: [{ product_id: inactiveRows[0].id, qty: 1 }], paymentMethod: "cash" }), "22023");
    }
    await expectCode("bad payment method", rpc({ key: randomUUID(), counter: "CL1", items: [{ product_id: anyProduct, qty: 1 }], paymentMethod: "cheque" }), "22023");
    await expectCode(
      "cashier billing on another counter",
      rpc({ key: randomUUID(), counter: "CL2", cashier: cashiers.CL1, items: [{ product_id: anyProduct, qty: 1 }], paymentMethod: "cash" }),
      "42501"
    );

    // ---- 5. Replay and reprint ---------------------------------------------------------------
    console.log("\n5. Replay and reprint");
    const sample = createdList.find((i) => i.counterCode === "CL1");
    if (sample) {
      const replay = await rpc({ key: sample.idempotencyKey, counter: "CL1", items: [{ product_id: anyProduct, qty: 7 }], paymentMethod: "card" });
      check("replay with a different cart returns the original invoice unchanged", JSON.stringify(invoiceJsonSchema.safeParse(replay.data).data) === JSON.stringify(sample), replay.error?.message);
      const reprint = await db.rpc("get_invoice", { p_invoice_id: sample.id });
      check("get_invoice returns the same invoice", JSON.stringify(invoiceJsonSchema.safeParse(reprint.data).data) === JSON.stringify(sample), reprint.error?.message);
    }
    const none = await db.rpc("get_invoice", { p_invoice_id: randomUUID() });
    check("get_invoice of an unknown id returns null", none.error === null && none.data === null, none.error?.message);

    // ---- 6. Immutability ---------------------------------------------------------------------
    console.log("\n6. Service role cannot change invoices");
    if (sample) {
      const upd = await db.from("invoices").update({ grand_total: 0 }).eq("id", sample.id);
      check("UPDATE invoices refused", upd.error?.code === "42501", upd.error ?? "update was allowed!");
      const del = await db.from("invoices").delete().eq("id", sample.id);
      check("DELETE invoices refused", del.error?.code === "42501", del.error ?? "delete was allowed!");
      const delItems = await db.from("invoice_items").delete().eq("invoice_id", sample.id);
      check("DELETE invoice_items refused", delItems.error?.code === "42501", delItems.error ?? "delete was allowed!");
    }

    // ---- 7. Numbering ------------------------------------------------------------------------
    console.log("\n7. Numbering");
    const nos = createdList.map((i) => i.invoiceNo);
    check("no duplicate invoice_no among created invoices", new Set(nos).size === nos.length);
    for (const code of COUNTER_CODES) {
      const mine = createdList.filter((i) => i.counterId === counters[code].id).map((i) => i.seqNumber).sort((a, b) => a - b);
      const base = baseline[code].max;
      const expected = mine.map((_, j) => base + 1 + j);
      check(
        `${code}: this run got ${base + 1}..${base + mine.length} with no gaps`,
        JSON.stringify(mine) === JSON.stringify(expected),
        "(if someone else billed on this counter during the run, this is expected to fail)"
      );
      const all = await allSeqNumbers(db, counters[code].id, fy);
      const contiguous = all.every((n, j) => n === j + 1);
      check(`${code}: all ${all.length} invoices for FY ${fy} are numbered 1..${all.length}`, contiguous, all.slice(0, 20));
    }
  } finally {
    for (const id of tempUsers) {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) console.error(`Could not delete temporary user ${id}: ${error.message}`);
    }
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  console.log("Invoices created by this run cannot be deleted through the API (they are immutable).");
  process.exit(failures === 0 ? 0 : 1);
}

async function allSeqNumbers(db: ReturnType<typeof createClient<Database>>, counterId: string, fy: string) {
  const out: number[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("invoices")
      .select("seq_number")
      .eq("counter_id", counterId)
      .eq("fy", fy)
      .order("seq_number")
      .range(from, from + 999);
    if (error) die(`invoices: ${error.message}`);
    out.push(...data.map((r) => r.seq_number));
    if (data.length < 1000) return out;
  }
}

/** Every key sent and every invoice seen, so the run's invoices can be identified later. */
function writeRunFile(runId: string, url: string, keysSent: string[], invoices: Invoice[]) {
  mkdirSync("data", { recursive: true });
  const file = `data/test-concurrency-${runId}.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        runId,
        url,
        keysSent: [...new Set(keysSent)],
        invoices: invoices.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, idempotencyKey: i.idempotencyKey })),
      },
      null,
      2
    )
  );
  if (invoices.length) console.log(`  (keys and invoices of this run: ${file})`);
}

main().catch((err) => {
  if (err instanceof FatalError) console.error(`\nError: ${err.message}`);
  else console.error(err);
  process.exit(1);
});
