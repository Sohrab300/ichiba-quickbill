# Ichiba QuickBill — Requirements (MVP)

Single source of truth for the build. Merges the two requirement briefs; where they conflict, the
**second brief wins** (no IndexedDB invoice storage, no offline billing, no print queues).
Items marked **[DEFAULT]** are decisions made to unblock the build — change them here if wrong.

## 0. Goal

Get **three Windows billing counters (CL1, CL2, CL3) plus mobile billing (MOB)** working at the same time,
fast. Supabase PostgreSQL is the **only** authoritative store for products and invoices: **every
completed invoice (header, line items, GST breakdown, payment method, counter, cashier) is saved in
Supabase**, and reprints, history and exports always read from Supabase.

Out of scope for MVP: offline invoice creation, sync, IndexedDB invoice copies, shared/remote print
queues, mobile-to-counter printing, silent printing.

## 1. Store & invoice header (configurable, stored in DB `store_settings`)

- Legal name: ASIANA FOOD AND BEVERAGE LLP
- Address: LG04, South Point Mall, Gurgaon · Phone: 8448852544
- GSTIN: 06ABLFA8216A1ZT (state code 06 = Haryana)
- Current financial year label: `26-27` (Indian FY, 1 Apr – 31 Mar) — configurable
- Invoice prefixes per counter — configurable (defaults below)
- Default print width: 80mm (58mm selectable per counter)

## 2. Products (imported from the stock CSV)

Source: `Current Stock Detail` export (one store, category "Beauty & Personal Care", ~1,901 items,
~7,384 batch rows). The file is a **report**, not a flat table:

- Rows 0–2: store header; row 3: column headers.
- Each item = one **summary row** (Item Name in column 0, aggregated numbers) followed by one or more
  **batch rows** (column 0 empty, column 1 = 7-digit Item Code), then a blank row.
- Last row: `Grand Total` (ignore). Names may contain HTML entities (`&amp;`) — decode them.
- Numbers use thousands separators (`1,190.00`).
- Useful batch-row columns: Item Code, Selling, Pur Price, MRP, Batch No, Expiry Date, Current Stock,
  Sales Tax %, HSN_SAC Code(Transaction), Dept. Name, UOM.

Product fields: `item_code` (unique), `name`, `selling_price` (paise), `mrp` (paise),
`gst_rate` (0/5/12/18/28/40), `hsn_code`, `uom`, `category`, `department`, `stock_qty` (informational),
`is_active`.

**[DEFAULT] Price rule when batches disagree** (531 items do): use the batch with Current Stock > 0;
if several, the one with the latest expiry; if none in stock, the last batch listed. Write every
conflict to an import report so the store can review.

**Barcodes (decided after import audit):** the CSV contains manufacturer EANs for ~1,767 items, so they
are imported into `product_barcodes` (`import:products -- --with-ean`; ~10 junk values skipped). Scanning
looks up `product_barcodes` first, then falls back to the 7-digit `item_code`. Unknown code → admin can
link it to an existing product or add a new product; cashier sees "Not found".

**GST rate source (decided after import audit):** use the item-level *Tax Description* column, which
reflects the current rates after the 22 Sep 2025 GST changes, not the batch-level *Sales Tax %* (rate at
purchase time). Allowed rates: 0, 5, 12, 18, 28, 40. Mismatches are listed in the import report.

**Price conflicts:** batch with stock > 0 wins; among those, batches with an expiry date beat ones
without; on a tie, the last listed batch. UOM defaults to PCS. Re-running the import overwrites
imported fields for matching item codes; products not in the CSV are never touched.

**[DEFAULT] Stock:** imported for reference only. Stock is NOT decremented on sale in the MVP.

## 3. GST on invoices

- **[DEFAULT] Selling price is GST-inclusive** (matches the CSV: Landing Cost = Pur Price × 1.18).
- Per line: `line_total = selling_price × qty`; `taxable = line_total × 100 / (100 + gst_rate)`;
  `gst = line_total − taxable`.
- Intra-state sale (Haryana): split GST equally into **CGST** and **SGST**.
- Do all money math in integer paise inside PostgreSQL. Round per line to the nearest paisa;
  CGST = floor(gst/2), SGST = gst − CGST, so totals always add up.
- Invoice shows an HSN/rate-wise tax summary (taxable value, CGST, SGST per rate) plus grand total.
- Round-off: **[DEFAULT]** grand total rounded to the nearest rupee, with a "Round off" line.

## 4. Counters, devices and users

- Counters: `CL1`, `CL2`, `CL3`, `MOB`. Table `counters(id, code, invoice_prefix, kind ['desk'|'mobile'],
  print_width_mm, is_active)`.
- Authentication: **Supabase Auth** (email + password). **[DEFAULT]** one login per counter PC
  (e.g. `cl1@ichiba.local`), plus cashier logins for mobile, plus an admin login.
- `staff_profiles(user_id → auth.users, display_name, role ['admin'|'cashier'], counter_id)`.
- The counter used for an invoice is **always derived on the server from the logged-in user's
  profile**. Any counter ID sent by the browser is ignored. Mobile cashiers map to `MOB`.
- All pages and API routes require login. Product create/edit/delete and settings require `admin`.
- **[DEFAULT]** Cashiers must have a counter; an admin's counter is optional (an admin without one
  can manage the catalog but not bill). `staff_profiles.is_active = false` locks a login out at once.
- Session refresh via Next.js `proxy.ts` (Next 16's name for middleware) with `@supabase/ssr`.

## 5. Invoice numbering

- Format: `{PREFIX}/{FY}/{6-digit zero-padded}` → `CL1/26-27/000001`, `MOB/26-27/000001`.
- Table `invoice_sequences(counter_id, fy, last_number)`, primary key (counter_id, fy).
- Next number assigned **inside the same transaction** that inserts the invoice
  (`INSERT … ON CONFLICT DO UPDATE SET last_number = last_number + 1 RETURNING`), which row-locks so
  counters never collide and a rolled-back sale never burns a number.
- `invoices.invoice_no` is UNIQUE globally. Numbers are never reused or edited.
- Sequences per counter are independent; changing FY starts each counter at 000001.

## 6. Completing a sale (Complete & Print)

1. When a cart is first created, the browser generates an **idempotency key** (UUID) and stores it
   with the cart.
2. Cashier clicks one of the payment buttons **Cash / UPI / Card** (see section 12). Each button means
   "Complete & Print with this payment method" — there is no separate Complete button.
3. Server action verifies the session, finds the user's counter, calls RPC
   `create_invoice(p_idempotency_key, p_items[{product_id, qty}], p_payment_method)`.
4. RPC (SECURITY DEFINER, executable only by service_role), in one transaction:
   - If an invoice with this idempotency key already exists → return that invoice unchanged.
   - Read current name/price/GST/HSN from `products` (never trust browser prices).
   - Assign the next number for the counter + current FY.
   - Insert `invoices` + `invoice_items` (snapshots of name, item_code, HSN, unit price, GST rate,
     qty, taxable, CGST, SGST, line total) and return the full invoice.
5. Browser receives the completed invoice → **clears the cart** (and its saved copy) → keeps the
   invoice on screen → opens the print dialog.
6. **Ambiguous failure** (timeout / network error, no response): do NOT clear the cart, do NOT
   generate a new key, do NOT auto-retry with a new key. Show "Sale status unknown — Check status".
   "Check status" re-sends the **same** key (safe, returns the existing invoice if it was created).
7. **Clear failure** (Supabase down, validation error): keep the cart, show the error, sale not final.
8. Only after the cart is cleared does a new cart get a new idempotency key.

## 7. Printing

- Browser print (`window.print()`) to the counter's local Windows printer. No silent printing assumed.
- One print document containing **two copies** of the same invoice: `CUSTOMER COPY` then `STORE COPY`,
  separated by a page break (many thermal drivers cut on page break; this is driver-dependent and
  must not be assumed).
- Layouts: **58mm** and **80mm** (`@page { size: 58mm auto / 80mm auto; margin: 0 }`), chosen per
  counter, overridable on the device (localStorage).
- Printing failure never affects the invoice. **Reprint** button on the completed-invoice panel and
  in history — reprint re-fetches from Supabase by invoice ID and never creates a new invoice.
  Reprints are marked "REPRINT" in small text.
- Invoice content: store header + GSTIN, "TAX INVOICE", invoice no, date/time (IST), counter, cashier,
  lines (name, qty, rate, amount), HSN/GST summary, round off, grand total, payment method, footer.

## 8. Cart recovery

- The unfinished cart (items, qty, idempotency key) is saved in `localStorage` per device and restored
  on reload. This is the only local storage. Nothing about completed invoices is stored locally.

## 9. History & exports

- `/invoices`: list with filters (date, counter, invoice no search), detail view, Reprint.
  Cashiers see their counter's invoices for today; admins see all.
- Daily sales CSV export (admin): one row per invoice line for a chosen date (IST) and optional
  counter, plus a summary export (per invoice: number, time, counter, cashier, payment method,
  taxable, CGST, SGST, round off, total). Generated on the server.

## 10. Mobile (PWA)

- Responsive billing screen; camera scanning via existing `html5-qrcode`.
- Installable PWA (manifest + icons). No offline caching of data or invoices.
- Mobile users use the MOB sequence; printing uses whatever the phone offers (system print/share PDF).
- No service worker. A red "You're offline — sale can't be completed" banner shows while
  `navigator.onLine` is false or after a request to the server failed (cleared by the next
  successful request or a 5 s probe). See section 14.

## 11. Non-functional

- Three counters billing at the same time without number collisions or slowdowns.
- Scan-to-cart under ~300ms on store Wi-Fi (index `item_code` and barcode alias).
- Secret key server-only. RLS on every table; no browser-side table access.
- Times shown and exported in Asia/Kolkata.
- Old `sales` / `sale_items` / `complete_sale` from the first prototype are removed (test data only).

## 12. Billing screen layout (reference: `docs/ui-reference.jpg`)

Follow the reference photo's layout, not its branding, colours or logo. Desktop (≥ 1024px wide)
is a two-pane screen that fits 1366×768 without page scrolling:

**Top bar:** app name, counter code (e.g. `CL1`), cashier name, current date/time, sign-out.

**Left pane (~65% width) — items**
- Scan/search box at the top, always focused: accepts scanner input (barcode or item code + Enter)
  and typed text (shows a dropdown of matching products by name/item code; Enter or click adds).
- Item table, newest scanned item highlighted: `#`, `Name` (with item code, HSN and GST % in small
  text underneath), `MRP`, `Price`, `Qty` (− / editable number / +), `Amount`, remove (×).
  Scanning an item already in the cart increments its qty. The table scrolls; headers stay fixed.
- Bottom action bar (left pane): **Clear Cart** (with confirm) and **Print Previous Invoice**.
  - Print Previous Invoice opens a small dialog: defaults to this counter's last completed invoice
    with a **Reprint** button, plus a search box to find another invoice by number (cashiers: own
    counter, today; admins: any). Reprint fetches from Supabase and never creates a new invoice.
  - Room is left for future buttons (Hold Bill, Discount) — do not build them now.

**Right pane (~35% width) — totals and payment**
- Bill summary card: number of items, total qty, sub total, taxable value, CGST, SGST, round off.
  Values are a live preview; the printed invoice uses the server's numbers.
- **Total** in very large type, always visible.
- Payment buttons at the bottom of the right pane: **Cash**, **UPI**, **Card**, large and equal width,
  each with a keyboard shortcut shown on the button (**[DEFAULT]** F7 Cash, F8 UPI, F9 Card).
  Clicking one completes the sale with that method and prints (section 6). All three are disabled
  while the cart is empty or a sale is being submitted.
- After a successful sale, the right pane shows a "Completed" panel (invoice no, total, payment
  method) with **Reprint** and **New Bill** until the next item is scanned.
- Sale-status-unknown and error states from section 6 appear in the right pane, above the payment
  buttons.

**Mobile (< 1024px):** single column — camera button first, then the scan box; item list as
cards; then a sticky bottom bar with the total, the payment method as three large toggles (Cash /
UPI / Card) and one **Complete** button (see section 14). Print Previous Invoice and Clear Cart move
into a menu.

**General:** Sekai Ichiba brand theme (section 15), light only, high contrast, big touch targets (≥ 44px), rupee amounts right-aligned with
`en-IN` formatting, success/error beeps on scan, focus returns to the scan box after every action.

## 13. Decisions made during the build (prompt 3)

- Rounding: an exact half paisa of taxable value rounds up; bill total rounds half-up to the rupee
  (round-off between −₹0.49 and +₹0.50).
- Limits: qty is a whole number 1–9,999 per product; max 500 lines per bill; repeated products merge
  into one line in first-scanned order.
- The database itself checks that the cashier bills only on the counter in their profile.
- Re-sending an idempotency key returns the original invoice unchanged (checked before items); the same
  key on a different counter is an error. Because of this, the cart is locked while status is unknown.
- A sale waiting > 10 s on a lock fails cleanly ("try again"); the server action gives up after 20 s
  and reports "status unknown".
- Invoices also snapshot store phone, state, footer, counter code, cashier name, unit and MRP.
- Sold products cannot be deleted (mark inactive instead). Invoices store the cashier's ID and name,
  not a foreign key, so deleting a login never touches old invoices.
- Sequences can never go backwards or be deleted; an admin may move one forward (e.g. to continue an
  old paper series). Beyond 999,999 a sale fails cleanly.
- Reprint of another counter's invoice shows "not found" for cashiers; admins without a counter can't bill.
- Tooling: Node 24 (see `.nvmrc`). The concurrency test must never run against production once real
  billing starts — use a Supabase branch or local stack.

## 14. Decisions made before launch (prompt 7)

- **Phones: toggle + Complete.** Below 1024px the payment method is a toggle and a separate
  Complete button finishes the sale (two taps), so the method is a deliberate choice on a touch
  screen. No method is preselected, and the choice resets after every sale. Desktop keeps the
  one-press Cash/UPI/Card buttons with F7/F8/F9.
- **Phones: print on tap.** On a MOB login or any touch-only device the print dialog does not open
  by itself after a sale; the Completed panel shows **Print / PDF**, which calls
  `window.print()` straight from the tap (phone browsers may ignore a print not started by a tap).
  The document is the same as on desktop (customer + store copy); later taps are reprints.
- **Offline.** While the device is offline the payment buttons are disabled and a sale is never
  sent; a sale that could not be sent is a plain error, never "status unknown". A request that
  fails without an answer still means "status unknown" (section 6).
- **Hosting region.** Vercel functions run in the Supabase project's region (`vercel.json`,
  `sin1` for `ap-southeast-1`): every scan is a server action with 2–3 database calls.
- **Database privileges.** `anon` / `authenticated` get no default privileges on new tables,
  sequences or functions in `public`; the hardening migration asserts RLS on every table and
  `service_role`-only EXECUTE. `npm run db:audit` re-checks it.
- **Mobile sequence.** The counter comes from the login's staff profile, not the device: a phone
  bills on MOB because its login is a MOB login (create phones' logins with `--counter MOB`).

## 15. Brand and visual style (reference: `docs/ichiba-brand.png`, logo `public/ichiba-logo.png`)

- Palette: paper/cream `#F7EDDF` (page background), ink `#1C1A1B` (text, outlines), Ichiba red
  `#BE2C31` (brand, primary actions), bright red `#CA3530` (accents/illustration only), white
  `#FFFFFF` (cards, inputs). No grey-blue SaaS look, no green/emerald brand colour.
- Look: flat, sticker-like — solid fills, thick ink outlines (2–3px), rounded corners, hard offset
  shadows in ink instead of soft blurry shadows. Illustrations are line icons with ink strokes and
  red fills, like the reference.
- Type: a bold rounded display face for headings, totals and buttons; a clean sans for body; all
  money and quantities in tabular figures.
- Light theme only (no dark mode): counters run in bright stores and the brand is cream/red.
- Status colours stay distinguishable from brand red: success = deep green, warning = amber/mustard,
  error = red with an icon and wording (never colour alone).
- Printed receipts stay plain black on white (thermal printers) — the theme is screen-only.
