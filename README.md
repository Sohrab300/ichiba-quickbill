# Ichiba POS 🏪

A simple, fast, barcode-scanning billing web application built for the **Ichiba** retail store. Designed for supermarket and retail workers operating on mobile phones, tablets, or laptops with physical barcode scanners or built-in device cameras.

---

## ⚡ Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack, TypeScript)
- **Styling**: Tailwind CSS
- **Database & Backend**: [Supabase](https://supabase.com) (Hosted PostgreSQL with Row Level Security and Atomic RPC Transactions)
- **Data Access**: `@supabase/supabase-js` + `@supabase/ssr` (strictly server-side, no ORM)
- **Validation**: Zod
- **Barcode & QR Scanning**: `html5-qrcode` (device camera) + Keyboard wedge listener (USB & Bluetooth handheld scanners)
- **Audio Feedback**: Web Audio API (synthesized crisp supermarket scan beeps and error buzzers)

---

## 🚀 Key Features

1. **High-Speed Billing Screen (`/`)**:
   - **Always-Focused Scan Input**: Automatically captures scans from USB/Bluetooth handheld barcode scanners (which send digits followed by `Enter`). Auto-refocuses after every scan and user interaction.
   - **Camera Barcode Scanner**: Toggle camera scanning powered by `html5-qrcode` with environment lens selection. Includes a toggle for **Continuous Scanning** (scan multiple items without closing) or **Single Scan**.
   - **Catalog Lookup & Live Cart**: Instant lookup by barcode. Existing items automatically increment in quantity.
   - **Quick Add Modal**: If a scanned barcode does not exist in the database, a prefilled modal appears instantly to save the product and add it to the active bill without disrupting workflow.
   - **Live Sticky Subtotal**: Live calculation formatted in Indian Rupees (**₹ INR**, `en-IN`), with quantity direct edits, increment/decrement buttons, and line item removal.
   - **Atomic Transaction Sale Completion**: The `Complete Sale` action calls the Postgres function `complete_sale(items)`, snapshotting actual current product names and DB prices to compute the exact subtotal server-side.
   - **Audio & Visual Feedback**: Distinct synthesized success beep and error tone/visual flashes on scan events.

2. **Product Catalog (`/products`)**:
   - Manage your store's inventory: list, search (by name, barcode, or category), create, edit, and delete products.
   - Prices stored as integer **paise** to eliminate floating-point currency errors.

3. **Invoice History (`/invoices`)**:
   - Server-paginated list by IST date, counter and invoice number, with day totals (taxable, CGST, SGST, grand total, per payment method). Cashiers see today's invoices of their own counter.
   - Detail view with every line and the HSN/GST summary, plus Reprint (fetched from Supabase, marked REPRINT).
   - Admin CSV exports (UTF-8 with BOM for Excel): `/api/exports/daily-summary?date=YYYY-MM-DD[&counter=CL1]` (one row per invoice) and `/api/exports/daily-lines?…` (one row per line). Opening them in Excel without losing leading zeros: [docs/EXPORTS.md](docs/EXPORTS.md).

4. **Settings (`/settings`, admin)**: store header, FY label, counter invoice prefixes and print widths. Issued invoices never change.

---

## 🔐 Supabase Architecture & Security

- **Login required everywhere**: Supabase Auth (email + password). `src/proxy.ts` refreshes the session cookie and sends signed-out visitors to `/login`. Every Server Action calls `getStaffContext()` (`src/lib/auth.ts`) first, which derives the user, role and **counter** from the session + `staff_profiles` — a counter id from the browser is never accepted. Product create/edit/delete and barcode linking need role `admin`.
- **Two Supabase clients**: a cookie-based client with the publishable key (`src/lib/supabase/session.ts`) only reads/refreshes the session; all data access uses the server-only secret-key client (`src/lib/supabase/server.ts`).
- **Row Level Security (RLS)**: Enabled across `products`, `sales`, and `sale_items`. No public access policies are granted, meaning the public `anon` key cannot read or alter store data.
- **Server-Only Service Role Client**: Database access is performed exclusively on the server in `src/lib/supabase/server.ts` guarded by `import "server-only"`. The `SUPABASE_SERVICE_ROLE_KEY` is never sent or exposed to client browsers.
- **Atomic `complete_sale` RPC**: Executes inside a single PostgreSQL transaction. Product prices and names are retrieved directly from the database (not trusted from client payloads). Execution is revoked from `anon`/`authenticated` and granted strictly to `service_role`.

---

## 🛠️ Supabase Setup Guide

Follow these steps to set up your hosted Supabase Postgres database:

### 1. Create a Supabase Project
1. Log into your account at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Click **New Project**, select your organization, choose a project name (e.g., `ichiba-pos`), set a secure database password, and select a region close to your store.

### 2. Retrieve API Credentials
In your Supabase project dashboard:
1. Navigate to **Project Settings** (gear icon) -> **API**.
2. Copy the **Project URL** (e.g. `https://xyzcompany.supabase.co`).
3. Under **API Keys**, copy the **publishable** key (`sb_publishable_...`) and the `service_role` / secret key (click "Reveal").
   > ⚠️ **IMPORTANT**: `service_role` has admin privileges and bypasses RLS. Keep it secret. Never commit it to git or prefix it with `NEXT_PUBLIC_`.
4. Under **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up". Staff logins are created with `npm run staff:create` only.

### 3. Configure Local Environment
Create your local environment file:
```bash
cp .env.example .env.local
```
Fill in the values in `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```
Add the same three variables in Vercel → Settings → Environment Variables.

### 4. Link Project & Push Migrations
Authenticate the Supabase CLI and link your hosted project:
```bash
# Login to Supabase CLI (opens browser authentication)
npx supabase login

# Link your local repository to your remote project (find your Project Reference ID in Project Settings -> General)
npx supabase link --project-ref <your-project-ref>

# Apply the database migration (creates tables, indexes, RLS, and complete_sale RPC)
npx supabase db push
```

### 5. Seed Initial Products
You can seed ~10 realistic retail products with valid EAN-13 barcodes into your database:

**Option A (Supabase CLI)**:
```bash
npx supabase db push --include-seed
```

**Option B (Supabase Dashboard SQL Editor)**:
1. Open **SQL Editor** in the Supabase Dashboard.
2. Open `supabase/seed.sql` in this repo, copy its contents, and paste into the query editor.
3. Click **Run**.

### 6. Create Staff Logins
Counters `CL1`, `CL2`, `CL3` (desk) and `MOB` (mobile) are created by the migration. Create one login per counter PC, mobile cashier logins on `MOB`, and an admin:
```bash
npm run staff:create -- --email cl1@ichiba.local --password '<password>' --name "Counter 1" --role cashier --counter CL1
npm run staff:create -- --email admin@ichiba.local --password '<password>' --name "Store Admin" --role admin
```
`--counter` is required for cashiers and optional for admins. To lock a login out, set `staff_profiles.is_active = false`.

### 7. (Optional) Regenerating TypeScript Database Types
Whenever you update your database schema in Supabase, you can regenerate `database.types.ts`:
```bash
npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
```

---

## 💻 Running the Application

Ensure Node.js (>= 20) is installed, then run:

```bash
# Install dependencies
npm install

# Start local development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📷 Scanner Usage Guide

### Hardware Barcode Scanners (USB / Bluetooth)
- Any standard barcode scanner operates in **keyboard wedge** mode.
- When an item is scanned, the scanner types the barcode digits and emits an `Enter` keystroke.
- The Billing page keeps the barcode input permanently focused. Simply point and shoot!

### Camera Barcode Scanning
- Click the **"Scan with Camera"** button on the billing bar.
- Allow camera permissions when prompted.
- Position the product barcode within the viewfinder box.
- Check the **"Continuous scanning"** box to scan multiple items in sequence without the camera closing.
- > 🔒 **Note on Camera Permissions**: Modern web browsers restrict camera access (`getUserMedia`) to secure contexts (**HTTPS** or **`http://localhost`**). If running on a local network for testing on a phone, use localhost or an HTTPS tunnel (such as ngrok or Cloudflare Tunnel).

---

## 🔮 Future Ideas & Roadmap

- **GST / Tax Breakdown**: Configure GST rates (5%, 12%, 18%) per product category with CGST/SGST line receipts.
- **ESC/POS Thermal Receipt Printing**: Direct Bluetooth or WebUSB thermal receipt printer integration.
- **Inventory & Low Stock Alerts**: Decrement stock quantities on sale completion with low stock warnings.
- **Offline PWA / Sync**: Local caching with background synchronization when internet connectivity drops.
