# Ichiba QuickBill

Billing for the Ichiba store: three Windows billing counters (**CL1**, **CL2**, **CL3**) and phones
(**MOB**) billing at the same time against one Supabase database. GST tax invoices with
per-counter numbering (`CL1/26-27/000001`), receipt printing, invoice history and daily CSV exports.

What it must do, and every decision made along the way: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

- **Billing (`/`)** — scan with a USB/Bluetooth scanner or the phone camera, or search by name;
  live GST preview; Cash / UPI / Card completes the sale and prints a customer + store copy.
  Phones get a camera-first layout with payment toggles and one Complete button.
- **Invoices (`/invoices`)** — history by IST day and counter, day totals, detail, reprint.
  Admins: CSV exports ([docs/EXPORTS.md](docs/EXPORTS.md)).
- **Products (`/products`)** and **Settings (`/settings`)** — admin only.
- **Installable app (PWA)** on phones and desktops. No offline mode: a sale needs the server, and
  a red "You're offline — sale can't be completed" banner says so.

## Stack

Next.js 16 (App Router, Server Actions, `proxy.ts`), React 19, Tailwind CSS 4, Supabase
(Postgres + Auth) via `@supabase/supabase-js` and `@supabase/ssr`, Zod, `html5-qrcode`, Vitest.
Node 24 (`.nvmrc`).

## How it is secured

- **Login everywhere.** Supabase Auth, email + password. `src/proxy.ts` refreshes the session and
  sends signed-out visitors to `/login`. Every Server Action and Route Handler calls
  `getStaffContext()` (`src/lib/auth.ts`) first, which derives the user, role and **counter** from
  the session and `staff_profiles` — the browser never chooses the counter. A test
  (`src/lib/server-actions-auth.test.ts`) fails if an action skips the check.
- **The browser never talks to the database.** All data goes through the server with the secret
  key (`src/lib/supabase/server.ts`, guarded by `server-only`). Every table has RLS on with no
  policies, `anon`/`authenticated` have no table privileges, and every RPC is executable only by
  `service_role`. Check with `npm run db:audit`.
- **Invoices are created in one database transaction** (`create_invoice`), priced from the
  database, numbered per counter without gaps, idempotent on a key the cart carries (a double
  click or a retry can't create a second invoice), and immutable once issued.

## Environment variables

| Variable | Where | What |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | server + proxy | Project URL, `https://<ref>.supabase.co` (Project Settings → API). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | server + proxy | Publishable key `sb_publishable_…`. Only used for sign-in and session refresh. |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Secret key `sb_secret_…` (or the legacy `service_role` JWT). Bypasses RLS. Never prefix it with `NEXT_PUBLIC_`, never commit it. |

Locally: `cp .env.example .env.local` and fill it in. The scripts in `scripts/` read `.env.local` too.

## Setup

### 1. Supabase project

Create a project at [supabase.com/dashboard](https://supabase.com/dashboard). Pick the region
closest to the store (the current project is in **Singapore, `ap-southeast-1`**) — the Vercel
functions must run in the same region (see Deployment).

Then in the dashboard:

- **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up".
  Logins are created only with `npm run staff:create`.
- **Authentication → Attack Protection** (older dashboards: Providers → Email): turn on
  **Prevent use of leaked passwords** if your plan includes it (Pro and up). `staff:create` then
  rejects passwords known from breaches.
- **Authentication → URL Configuration → Site URL**: your production URL (e.g.
  `https://quickbill.vercel.app`).

### 2. Database migrations

```bash
npm install
npx supabase login
npx supabase link --project-ref <project-ref>   # Project Settings → General
npx supabase db push                            # applies supabase/migrations/*
npm run db:audit                                # read-only check; no rows = pass
```

| Migration | What it adds |
| --- | --- |
| `20261114000000_init_ichiba_pos` | First prototype (kept for migration history; removed by the next one). |
| `20261114120000_products_catalog` | `products`, `product_barcodes`, `store_settings`, `lookup_product()`. |
| `20261114200000_counters_staff` | `counters` (CL1, CL2, CL3, MOB) and `staff_profiles`. |
| `20261114230000_invoices` | `invoices`, `invoice_items`, `invoice_sequences`, `create_invoice()`, `get_invoice()`. |
| `20261115100000_invoice_history` | Day totals and CSV export functions, counter prefix guard. |
| `20261115200000_harden_privileges` | Revokes leftover API-role privileges, stops default grants to `anon`/`authenticated`, and asserts the security rules (fails if any are broken). |
| `20261115300000_price_edit` | Per-bill price edit: `invoice_items.catalog_price` / `price_edited`, `invoices.has_price_edit`; `create_invoice()` accepts an optional `unit_price` (0 < price ≤ MRP); edit columns in exports and day totals. |

After a schema change, regenerate the types:
`npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts`.

### 3. Import products

Export **Current Stock Detail** as CSV and save it as `data/stock.csv` (`data/` is git-ignored: the
file contains purchase prices).

```bash
npm run import:products -- --dry-run --with-ean   # compare only; writes data/import-report.csv
npm run import:products -- --with-ean             # upsert on item_code + link manufacturer EANs
```

Review `data/import-report.csv` (price conflicts between batches, GST mismatches, skipped
barcodes). Re-running is safe: it updates imported fields of matching item codes and never touches
products that are not in the CSV — but it does overwrite price/GST/name edits made in the app.

### 4. Staff logins

One login per counter PC, one or more for phones (all on `MOB`), and an admin. Emails don't need
to be real mailboxes; no email is ever sent.

```bash
npm run staff:create -- --email cl1@ichiba.local --password '<password>' --name "Counter 1" --role cashier --counter CL1
npm run staff:create -- --email cl2@ichiba.local --password '<password>' --name "Counter 2" --role cashier --counter CL2
npm run staff:create -- --email cl3@ichiba.local --password '<password>' --name "Counter 3" --role cashier --counter CL3
npm run staff:create -- --email mob1@ichiba.local --password '<password>' --name "Phone 1" --role cashier --counter MOB
npm run staff:create -- --email admin@ichiba.local --password '<password>' --name "Store Admin" --role admin
```

- The counter (and so the invoice series) comes from the login, not the device: a phone signed in
  as `cl1@…` bills on CL1. Give phones `MOB` logins.
- An admin without `--counter` can manage products and settings but cannot bill.
- **Lock a login out at once:** Table Editor → `staff_profiles` → set `is_active` to `false`.
- **New password:** delete the user in Authentication → Users and create it again with
  `staff:create`. Old invoices keep the cashier's name; nothing else references the login.

### 5. Run locally

```bash
npm run dev     # http://localhost:3000
```

Phone cameras only work on HTTPS (or `localhost`), so test phones against a Vercel preview
deployment rather than the laptop's LAN address.

## Deployment (Vercel)

1. Import the repository in Vercel (framework: Next.js).
2. **Settings → Build and Deployment → Node.js Version: 24.x.**
3. **Settings → Environment Variables:** add the three variables above for Production (and
   Preview, if previews should work). Redeploy after changing them.
4. **Region:** `vercel.json` pins the functions to `sin1` (Singapore), next to the database. Each
   scan is one server action making 2–3 database calls, so a function on another continent adds
   hundreds of milliseconds per scan. If the Supabase project is in another region, change
   `regions` to the matching Vercel region.
5. Apply the database migrations (step 2 of Setup) **before** deploying code that needs them.
6. Check: sign in, `npm run db:audit` (no rows), then run [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md).

Install the app:

- **Counter PCs (Chrome/Edge):** the install icon at the right end of the address bar.
  Printer setup: [docs/PRINTER_SETUP.md](docs/PRINTER_SETUP.md).
- **Android (Chrome):** ⋮ → Add to Home screen → Install.
- **iPhone (Safari):** Share → Add to Home Screen.

## Scripts

| Command | What |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js. |
| `npm run lint` | ESLint. |
| `npm test` | Unit tests (GST maths, cart, CSV, connectivity, server-action auth, sale completion). |
| `npm run db:audit` | Read-only: RLS on every table, no API-role privileges, RPCs `service_role` only. No rows = pass. |
| `npm run db:explain` | Read-only: EXPLAIN of the scan lookup (must use indexes), name search, and round-trip timing. Add `-- --local` for a local stack. |
| `npm run import:products` | Product import (see above). |
| `npm run staff:create` | Create a staff login (see above). |
| `npm run test:db` | Database tests (price edit: limits, idempotency, GST on the edited price, catalog untouched, backfill) on a **throwaway local Postgres** it creates and deletes (Postgres.app or Homebrew `postgresql@15+`; no Docker, never remote). |
| `npm run test:concurrency` | Parallel sales on CL1–CL3 + same-key retries. **Creates real, undeletable invoices: never run it on the live project** — use `npx supabase start` or a Supabase branch. |

## Project layout

```
src/app/               routes: / (billing), /invoices, /products, /settings, /login,
                       /api/exports/*, manifest.ts, icons
src/components/        UI; billing/ is the billing screen, print/ the receipt
src/lib/               server actions (*-actions.ts), auth, GST, cart, CSV, Supabase clients
src/proxy.ts           session refresh + login redirect
supabase/migrations/   database schema, functions and privileges
scripts/               product import, staff logins, DB checks, concurrency test
docs/                  requirements, printer setup, exports, launch checklist
```
