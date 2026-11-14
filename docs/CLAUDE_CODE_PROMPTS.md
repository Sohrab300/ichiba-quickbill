# Ichiba QuickBill — Claude Code prompts

Run these **in order**, one Claude Code session each (or `/clear` between them). After each one:
test what it lists under "Check", then commit. Don't start the next prompt until the current one
works. Each prompt is self-contained: copy everything inside the code block.

---

## Before you start (do this yourself, ~10 min)

1. Put `REQUIREMENTS.md` at `docs/REQUIREMENTS.md` in the repo.
2. Put the stock CSV at `data/stock.csv` (this folder will be git-ignored — it contains purchase prices).
3. Commit what agy left uncommitted, so you have a clean starting point:
   `git add -A && git commit -m "Prototype from agy" && git push`
4. **Vercel does not read `.env.local`.** In Vercel → Project → Settings → Environment Variables, add
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (your `sb_secret_…` value) and, after
   prompt 2, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`). Redeploy after adding.
5. Link the Supabase CLI once: `npx supabase login` then `npx supabase link --project-ref <ref>`.

---

## Prompt 1 — Audit, clean up, product schema and CSV import

```text
Read AGENTS.md first (this is Next.js 16; check node_modules/next/dist/docs/ before using any Next API),
then read docs/REQUIREMENTS.md fully. It is the source of truth for this project ("Ichiba QuickBill").
The current code is a prototype written by another AI agent; treat it as unreviewed.

Task 1 — audit. Read every file in src/ and supabase/. Give me a short list of what is wrong or
conflicts with REQUIREMENTS.md before changing anything. Specifically fix:
- src/lib/supabase/server.ts silently falls back to a placeholder URL/key. Make it throw a clear error
  when env vars are missing (but don't break `next build`).
- getProducts() interpolates user input into a PostgREST .or() filter; sanitise it.

Task 2 — schema. Create a NEW migration in supabase/migrations/ (do not edit the existing one) that:
- drops the prototype tables/functions: sale_items, sales, complete_sale (test data only),
- replaces `products` with the fields in REQUIREMENTS.md section 2 (item_code unique, selling_price
  and mrp in paise, gst_rate, hsn_code, uom, category, department, stock_qty, is_active, timestamps),
- adds product_barcodes(barcode unique, product_id) for EAN aliases,
- adds store_settings (single row) seeded with the store details in section 1,
- adds indexes for item_code, barcode and a trigram or ILIKE-friendly index on name,
- enables RLS on everything with no public policies.
Remove supabase/seed.sql's fake products (empty the file or delete it and update config.toml).
Regenerate src/lib/supabase/database.types.ts from the schema (use `npx supabase gen types typescript
--linked` if the project is linked, otherwise write it by hand to match exactly).

Task 3 — import script. Write scripts/import-products.ts (run with `npx tsx`) that parses
data/stock.csv exactly as described in REQUIREMENTS.md section 2 (summary rows + batch rows, HTML
entities, thousands separators, Grand Total row), applies the price rule for conflicting batches,
and upserts products by item_code using the service key from .env.local. It must:
- be safe to re-run (upsert, never duplicate),
- support --dry-run,
- write data/import-report.csv listing price conflicts and rows it could not parse,
- print totals at the end (items, inserted, updated, skipped, conflicts).
Add data/ to .gitignore. Add an npm script "import:products".

Task 4 — update the existing app code (lookup, products page, add/edit modals, validations, mappers)
to the new product shape. Lookup order: product_barcodes.barcode first, then products.item_code.
Show selling price, MRP and GST % in the products list. Leave the billing screen's checkout broken
for now if needed — prompt 3 replaces it — but it must still build.

Finish by running `npm run lint` and `npm run build` and fixing all errors. Tell me the exact commands
to apply the migration and run the import, and what the expected totals are (≈1,901 items).
Do not commit; I will review first.
```

**Check:** `npx supabase db push`, then `npm run import:products -- --dry-run`, then the real import.
In Supabase Table Editor you should see ~1,901 products. Scan or type `7021317` on the billing screen
and it should find "12 GRABS 10 ELEMENTS VITA SERUM 50 ML". Open `data/import-report.csv` and skim the
price conflicts.

---

## Prompt 2 — Login, counters and roles

```text
Read AGENTS.md and docs/REQUIREMENTS.md (sections 4 and 11 especially). Check the Next.js 16 docs in
node_modules/next/dist/docs/ for proxy.ts (it replaces middleware.ts) and for cookies() before writing code.

Right now every page, API route and server action is open to anyone with the URL and uses the secret
key. Lock the app down:

1. Migration (new file): counters table seeded with CL1, CL2, CL3 (kind 'desk') and MOB (kind 'mobile'),
   invoice_prefix = code, print_width_mm = 80; staff_profiles(user_id references auth.users,
   display_name, role 'admin'|'cashier', counter_id references counters). RLS on, no public policies.
2. Auth with Supabase Auth email+password using @supabase/ssr:
   - a cookie-based server client (publishable key, env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) used only
     to read the session/user,
   - keep the existing service-role client (secret key) for data access, server-only,
   - proxy.ts that refreshes the session and redirects signed-out users to /login,
   - /login page and a sign-out button in the Navbar showing "Counter CL1 · <cashier name>".
3. A server helper getStaffContext() that returns { userId, displayName, role, counter } from the
   session + staff_profiles, and throws 401/403 when missing or inactive. Every server action and
   API route must call it first. Product create/edit/delete and barcode linking require role 'admin'.
   Never accept a counter id from the browser anywhere.
4. scripts/create-staff.ts (npx tsx) that creates an auth user + staff_profile:
   `npm run staff:create -- --email cl1@ichiba.local --password ... --name "Counter 1" --role cashier --counter CL1`
5. Delete any API route that is no longer needed by the UI; keep the rest behind getStaffContext().
6. Update .env.example and README (short) for the new env var.

Run lint and build, fix everything. Then list the exact commands to create: 3 counter logins (CL1-3),
1 mobile cashier (MOB) and 1 admin. Do not commit.
```

**Check:** in an incognito window, the deployed URL redirects to /login. `cl1@…` can bill but can't
delete products. Admin can. `curl https://<your-app>/api/products` without a cookie returns 401.

---

## Prompt 3 — Invoice numbering, GST and idempotent sale creation (the core)

```text
Read AGENTS.md and docs/REQUIREMENTS.md sections 3, 5 and 6 carefully. This prompt is the heart of
the system — correctness over speed. Think through concurrency and failure cases before writing code.

1. Migration (new file):
   - invoice_sequences(counter_id, fy, last_number, primary key (counter_id, fy)).
   - invoices: id uuid, invoice_no text UNIQUE, counter_id, fy, seq_number, idempotency_key uuid UNIQUE,
     cashier_user_id, payment_method ('cash'|'upi'|'card'), subtotal, taxable_total, cgst_total,
     sgst_total, round_off, grand_total (all integer paise), created_at timestamptz,
     store snapshot (name, address, gstin) so old invoices print unchanged if settings change.
   - invoice_items: snapshots of product_id, item_code, name, hsn_code, unit_price, gst_rate, qty,
     line_total, taxable_value, cgst, sgst.
   - Invoices and items are immutable: revoke UPDATE/DELETE and add a trigger that raises on update/delete.
   - RPC create_invoice(p_idempotency_key uuid, p_counter_id uuid, p_cashier_user_id uuid,
     p_items jsonb, p_payment_method text) returns jsonb (the full invoice with items),
     SECURITY DEFINER, set search_path, EXECUTE granted only to service_role. In ONE transaction:
       a) if an invoice with p_idempotency_key exists, return it unchanged (no new number);
       b) validate items (non-empty, qty > 0, products exist and are active, merge duplicate product ids);
       c) read the current FY and prefix from store_settings/counters;
       d) INSERT … ON CONFLICT (counter_id, fy) DO UPDATE SET last_number = invoice_sequences.last_number + 1
          RETURNING last_number — this is the number;
       e) compute GST exactly as REQUIREMENTS.md section 3 (inclusive pricing, CGST = floor(gst/2),
          SGST = remainder, rupee round-off), insert invoice + items, return jsonb.
     Handle the race where two requests with the same idempotency key arrive at once (unique violation
     → return the existing invoice).
   - RPC get_invoice(p_invoice_id uuid) returning the same jsonb shape, for reprint.
2. Server action completeSale({ idempotencyKey, items: [{productId, qty}], paymentMethod }) that calls
   getStaffContext(), takes the counter from the profile (never from input), validates with zod,
   calls create_invoice and returns the invoice. Server action getInvoiceForReprint(id) that checks the
   caller may see it (admin, or same counter).
3. Tests: add vitest. Write tests for the GST/rounding math (port it to a pure TS function used only for
   the on-screen cart preview; the DB stays authoritative) and an integration script
   scripts/test-concurrency.ts that fires 50 parallel create_invoice calls across CL1/CL2/CL3 plus 5
   repeated calls with the same idempotency key, then asserts: no duplicate invoice_no, each counter's
   numbers are contiguous 1..n, the repeated key produced exactly one invoice.
   Run it against the linked project and clean up test invoices afterwards only if safe — otherwise
   tell me to run it on a Supabase branch or local `supabase start` instead.

Lint, build, run tests. Report results and any decision you made that isn't in REQUIREMENTS.md.
Do not commit.
```

**Check:** the concurrency script passes. In Supabase, `invoice_sequences` shows separate counts for
CL1/CL2/CL3. Try updating an invoice row in the SQL editor; it should be refused.

---

## Prompt 4 — Billing screen: Complete & Print flow and cart recovery

```text
Read AGENTS.md and docs/REQUIREMENTS.md sections 6 and 8. Rework the billing screen (src/app/page.tsx,
currently ~600 lines — split it into components and a cart reducer/hook while you're there).

1. Cart state: items (productId, itemCode, name, unitPrice, gstRate, qty), idempotencyKey (crypto.randomUUID()
   created with the cart), paymentMethod. Persist to localStorage per device (key includes user id),
   restore on load. This is the ONLY thing stored locally.
2. Show a live preview of taxable, CGST, SGST, round-off and grand total using the shared TS GST function.
   Label it as a preview; the printed invoice uses the server's numbers.
3. Payment method selector (Cash / UPI / Card) — required before completing.
4. "Complete & Print" button (also Ctrl+Enter / F9). States: idle → submitting (button disabled, scanning
   paused) → one of:
   - success: clear cart + localStorage copy, create a fresh idempotency key for the next cart, show a
     "Completed invoice" panel with invoice no, total, and buttons Reprint / New bill, then trigger printing
     (printing itself is prompt 5 — for now call a placeholder printInvoice(invoice)).
   - definite failure (server returned an error): keep cart, show the error, allow retry with the SAME key.
   - ambiguous failure (network error/timeout, no response): keep cart, show "Sale status unknown",
     with a "Check status" button that re-sends the same key. Never generate a new key automatically and
     never auto-retry. Block editing the cart while status is unknown (an edited cart with an old key
     would return the old invoice) — offer "Discard and start over" behind a confirm dialog that warns
     the sale may already exist.
5. Scanning keeps working as before (keyboard wedge + camera), auto-focus returns to the scan input
   after every action, beeps stay.
6. Unknown barcode: cashier sees "Not found"; admin gets the option to link it to an existing product
   (search) or create a product.

Use the frontend-design sensibilities of a real supermarket POS: big touch targets, high contrast,
total always visible, works at 1366×768 and on a phone. Lint and build. Do not commit.
```

**Check:** bill 3 items and complete; the cart clears and the invoice number shows. Reload mid-cart
and the cart comes back. With DevTools → Network → Offline, click Complete: you should get "status
unknown" and the cart stays. Go back online, click Check status, and you get one invoice (not two).

---

## Prompt 5 — Printing (two copies, 58mm/80mm, reprint)

```text
Read AGENTS.md and docs/REQUIREMENTS.md section 7.

1. Build a print-only invoice component rendered into a hidden print root, printed with window.print().
   One document, two copies: "CUSTOMER COPY" then "STORE COPY", separated by a page break
   (break-after: page). Content per section 7 of REQUIREMENTS.md, using ONLY data returned by the server
   (create_invoice / get_invoice), including the store snapshot.
2. Two layouts: 58mm and 80mm via @page { size: <w>mm auto; margin: 0 } and matching content width,
   monospace-friendly, black only, no images except an optional text logo, fonts readable on thermal
   paper (≥ 11px for body, larger for total). Long product names wrap; numbers right-aligned.
3. Width comes from the counter config (counters.print_width_mm); allow a per-device override in a small
   Settings dialog (stored in localStorage) with a "Print test page" button.
4. Replace the placeholder printInvoice() from the billing screen. Print after success; if the print
   dialog is cancelled or fails, nothing changes server-side — the Completed panel's Reprint button prints
   again. Reprint always fetches via getInvoiceForReprint(id) from Supabase and adds a small "REPRINT"
   marker.
5. Do not attempt silent printing or ESC/POS. Write docs/PRINTER_SETUP.md for the store: how to set the
   thermal printer as Windows default, set paper size 58/80mm and "cut after each page" in the driver if
   supported, disable headers/footers and margins in Chrome/Edge print settings, and optional Chrome
   kiosk-printing flag (--kiosk-printing) with its trade-offs.

Lint and build. Do not commit.
```

**Check:** print to "Save as PDF" at 80mm and 58mm. You should get two pages, the totals should
match the invoice in Supabase, and Reprint should not create a new row in `invoices`.

---

## Prompt 6 — Invoice history and daily CSV exports

```text
Read AGENTS.md and docs/REQUIREMENTS.md section 9. Replace the old /sales page with /invoices:

1. List (server-side paginated): invoice no, time (IST), counter, cashier, payment method, total.
   Filters: date (default today, IST), counter (admins only; cashiers are fixed to their own counter
   and today), search by invoice no. Day totals at the top (count, taxable, CGST, SGST, grand total,
   split by payment method).
2. Detail view with all lines and the tax summary, plus a Reprint button (reuse prompt 5's printing).
3. Exports (admin only), generated in a route handler on the server, streamed as CSV with a UTF-8 BOM
   so Excel opens it correctly:
   - /api/exports/daily-summary?date=YYYY-MM-DD[&counter=CL1] — one row per invoice,
   - /api/exports/daily-lines?date=…[&counter=…] — one row per invoice line incl. HSN, GST rate,
     taxable, CGST, SGST.
   Dates are interpreted in Asia/Kolkata. Amounts in rupees with 2 decimals.
4. Navbar: Billing · Invoices · Products (admin) · Settings (admin: store details, FY label, counter
   prefixes and print widths — editing the FY or prefix must not change already issued invoices).

Lint and build. Do not commit.
```

**Check:** the export for today opens cleanly in Excel. The summary rows add up to the day totals
on screen.

---

## Prompt 7 — Mobile PWA and launch hardening

```text
Read AGENTS.md and docs/REQUIREMENTS.md sections 10 and 11.

1. Make the app an installable PWA using Next.js 16's built-in app/manifest.ts (check the docs) with
   icons; no service worker data caching, no offline invoices. Add a clear "You're offline — sale can't
   be completed" banner using navigator.onLine + failed requests.
2. Mobile billing screen polish: camera scanner first, sticky total + Complete button, payment method
   as large toggles. Mobile users bill on the MOB sequence (already enforced server-side — verify it).
   On mobile, "Print" uses window.print() (lets the phone print or save PDF).
3. Hardening review — go through the whole codebase and report, then fix:
   - every server action / route calls getStaffContext and role checks are right,
   - no secret key reachable from client bundles (grep .next output for sb_secret_),
   - RLS enabled on every table, EXECUTE on RPCs only for service_role,
   - double-click / double-Enter on Complete can't create two invoices,
   - performance of scan lookup with ~2,000 products (indexes used — run EXPLAIN in a script),
   - remove dead prototype code, unused deps, and outdated README sections; rewrite README for setup,
     env vars, migrations, import, staff creation, and deployment on Vercel.
4. Write docs/LAUNCH_CHECKLIST.md: a step-by-step test the store can run on day one with three counters
   and one phone billing at the same time.

Lint, build, run all tests. Give me a summary of what changed and anything I still need to do by hand
(Vercel env vars, Supabase Auth settings like disabling public sign-ups, creating staff logins).
Do not commit.
```

**Check:** follow `docs/LAUNCH_CHECKLIST.md` with three browsers logged in as CL1, CL2 and CL3 and
one phone as MOB, all billing at the same time.

---

## Tips for running these

- If Claude Code proposes a plan first, read it. If it disagrees with REQUIREMENTS.md, fix the doc
  first, then let it continue.
- After each prompt: test → `git add -A && git commit -m "<prompt name>" && git push`. Vercel redeploys
  from the push.
- Migrations: apply with `npx supabase db push` before testing the deployed site.
- In Supabase → Authentication → Providers/Settings, **turn off public sign-ups** so only accounts you
  create can log in.
