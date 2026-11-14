# Launch checklist — day one

A test the store runs before opening on the first day: **three counters (CL1, CL2, CL3) and one
phone (MOB) billing at the same time**, plus printing, double-presses, going offline, history and
exports. About **45 minutes** with four people.

> **Every bill in this test is a real tax invoice.** Invoices cannot be edited or deleted and
> each one uses up a number. Bill real items and take real payment (a staff purchase), so every
> test invoice is a genuine sale. Write every invoice number down in the tables below.


## Go-live — wipe test invoices (once, after the test day, before the first real bill)

Test bills from the build and the in-store test day use real invoice numbers. Before the first
real customer bill, an admin opens **Supabase → SQL Editor**, pastes
`supabase/manual/launch-reset.sql`, and follows the instructions at the top of the file
(preview → set the confirmation text and go-live time → run → verify). Afterwards every counter
starts at `000001`. Never run it once real billing has started.

## People and devices

| Who | Device | Login |
| --- | --- | --- |
| A | Counter PC 1 + receipt printer + barcode scanner | `cl1@…` (CL1) |
| B | Counter PC 2 + receipt printer + barcode scanner | `cl2@…` (CL2) |
| C | Counter PC 3 + receipt printer + barcode scanner | `cl3@…` (CL3) |
| D | Phone with QuickBill installed | a `MOB` login |
| Manager | Laptop or tablet | `admin@…` (sign in on the laptop; can be A–D at the end) |

Each person needs 6–8 cheap items: some with a manufacturer barcode, at least one GST 5% and one
GST 18% item, and one item that two counters both bill.

## 0. Before the day (manager)

- [ ] Migrations applied (`npx supabase db push`) and `npm run db:audit` prints **no rows**.
- [ ] Supabase → Authentication → Sign In / Providers: **"Allow new users to sign up" is off**.
- [ ] Vercel: the three environment variables are set for Production; the latest deployment is
      live; `vercel.json` region matches the Supabase region.
- [ ] Settings page (admin): store name, address, GSTIN, FY `26-27`, footer, counter prefixes and
      print widths are right.
- [ ] Products imported; `data/import-report.csv` reviewed.
- [ ] Logins exist for CL1, CL2, CL3, every phone (MOB) and the admin; passwords handed over.
- [ ] Each counter printed the test page (Printer → Print test page; see `PRINTER_SETUP.md`).
- [ ] The phone has the app installed (Android: Chrome ⋮ → Add to Home screen; iPhone: Safari
      Share → Add to Home Screen) and is on the store Wi-Fi.
- [ ] Invoice history (admin, all counters) checked: note the **last invoice number of each
      counter** here, so you know where today's numbers start. Numbers continue from the last
      one issued; they never restart or go back.

| Counter | Last number before launch | First number today should be |
| --- | --- | --- |
| CL1 | | |
| CL2 | | |
| CL3 | | |
| MOB | | |

## 1. Sign in (5 min)

- [ ] A, B, C sign in on their PCs; the top bar shows **Counter CL1 / CL2 / CL3** and their name.
- [ ] D opens the installed app on the phone and signs in; the top bar shows **Counter MOB**.
- [ ] A cashier opening `/settings` sees "Only an admin can change settings".

## 2. Scanning (5 min)

- [ ] Each counter scans 10 items quickly with the barcode scanner. Every scan beeps and the item
      appears in well under a second; scanning the same item again increases its quantity.
- [ ] Each counter types a 7-digit item code + Enter, and searches one item by name.
- [ ] An unknown barcode (e.g. a book's ISBN) shows **Not found** and an error beep.
- [ ] Phone: the green **Scan** (camera) button is the first thing on the screen. Scan 5 items with
      the camera; the camera view shows "Added: …" and the running total after each one.
- [ ] Optional speed check (one counter): Chrome DevTools → Network, scan an item, the `POST` for
      the scan takes **under 300 ms**. If it is much slower everywhere, check the Vercel region.

Clear all carts (Clear cart / phone menu ⋮ → Clear cart) before the next step.

## 3. Four sales at the same time (10 min)

Everyone scans 2–3 items. The manager counts **"3 – 2 – 1 – pay"** and on "pay":

- A presses **F7** (Cash), B presses **F8** (UPI), C presses **F9** (Card).
- D taps **UPI** and then **Complete**.

Expected on every device: a green **Completed** panel with the invoice number, no error.
Counters: the print dialog opens with **CUSTOMER COPY** and **STORE COPY**; print it. Phone: no
dialog yet (see step 5).

Do it **three rounds** (new items each time; rotate payment methods). Fill in:

| Counter | Round 1 invoice no | Round 2 | Round 3 | Total ₹ (round 1/2/3) |
| --- | --- | --- | --- | --- |
| CL1 | | | | |
| CL2 | | | | |
| CL3 | | | | |
| MOB | | | | |

- [ ] Each counter's numbers follow on from its previous one, with no gaps and no repeats
      (e.g. `CL2/26-27/000002`, `000003`, `000004`).
- [ ] The phone's invoices are numbered **`MOB/26-27/…`** — never CL1/CL2/CL3.
- [ ] The printed totals equal the screen totals; the receipt shows CGST and SGST.

## 4. Double click / double Enter (5 min)

Each person scans one item, then tries to complete it twice:

- [ ] A: double-click **Cash** very fast.
- [ ] B: press **F8** twice quickly, then also hold it down.
- [ ] C: press Tab until **Card** is highlighted, then press **Enter** twice quickly.
- [ ] D: tap **Complete** twice quickly.
- [ ] Manager, in Invoices (today, each counter): **exactly one** new invoice per person.

## 5. Printing (5 min)

- [ ] Counter: on the Completed panel press **Reprint** — the receipt says **REPRINT**.
- [ ] Counter: **Print Previous Invoice** → the last invoice is listed → Reprint works.
- [ ] Counter: complete a sale and **Cancel** the print dialog — the sale stays completed;
      Reprint prints it.
- [ ] Phone: after a sale tap **Print / PDF** → the phone's print screen opens → choose
      **Save as PDF** (Android) or Share → Save to Files (iPhone). The PDF shows the invoice.
      If nothing happens in the installed app on an iPhone, try the same in Safari and tell the
      manager (some iOS versions don't print from home-screen apps).

## 6. Offline (10 min)

- [ ] **Phone:** scan 2 items, then turn on **airplane mode**. Within a second a red banner says
      **"You're offline — sale can't be completed"** and the button reads **Offline — can't
      complete**. The items stay in the cart.
- [ ] Turn airplane mode off: the banner disappears; complete the sale normally.
- [ ] **CL3:** scan 2 items, unplug the network cable / turn off Wi-Fi: the banner appears and
      F9 does nothing. Reconnect: the banner goes away (within ~5 s); press F9; the sale completes.
- [ ] **Cart survives a reload:** CL1 scans 3 items and presses **F5** — the same items are back.
- [ ] **Connection lost during a sale** (CL2; may take a few tries): scan an item, press **F8**
      and immediately pull the network cable. If the panel says **Sale status unknown**, the cart
      is locked. Reconnect and press **Check status**: it shows the invoice (if it had been saved)
      or completes it — **never two invoices**. Confirm in Invoices.
- [ ] Optional: unplug the router's **internet** cable (Wi-Fi stays up). Scanning fails and the
      banner says the server isn't answering. Plug it back in; the banner clears by itself.

## 7. History and exports (manager, 5 min)

- [ ] Invoices → today → **All counters**: every invoice from the tables above is there.
- [ ] Day totals per payment method match what was paid (cash in drawer, UPI/card slips).
- [ ] Open one invoice: lines, HSN/GST summary and total are right; **Reprint** works.
- [ ] Signed in as a cashier, Invoices shows only **that counter, today**.
- [ ] Export **daily summary** and **daily lines** CSV for today; open them in Excel
      (`EXPORTS.md`). The summary's total equals the day total on screen.

## 8. Security spot checks (manager, 3 min)

- [ ] Sign out on one PC: opening the app goes to the login page.
- [ ] In a private window (not signed in), open `/api/exports/daily-summary` → `Not signed in` (401).
- [ ] As a cashier, open `/api/exports/daily-summary` → "Only an admin can do this." (403).
- [ ] `npm run db:audit` → no rows.

## Sign-off

| Check | OK? | Notes |
| --- | --- | --- |
| 1 Sign in | | |
| 2 Scanning | | |
| 3 Four at once, numbering | | |
| 4 Double press | | |
| 5 Printing | | |
| 6 Offline | | |
| 7 History and exports | | |
| 8 Security | | |

Signed off by: ____________________  Date / time: ____________

## If something goes wrong

| What you see | What to do |
| --- | --- |
| **Sale status unknown** | Don't bill the items again. Fix the connection, press **Check status**. Only use *Discard* after checking Invoices for that sale. |
| **Sale not saved** (red) | Nothing was saved. Press **Try again** (same items, same payment). |
| Red **offline** banner | Check Wi-Fi / cable / mobile data. The cart is kept; complete when it clears. |
| Print dialog didn't open / paper jam | The sale is saved. Press **Reprint**. |
| A login says "not assigned to a counter" or "disabled" | Admin: check `staff_profiles` for that login (counter, `is_active`). |
| Scans slow on every device | Check the store internet; check the Vercel function region equals the Supabase region (`npm run db:explain`). |
| Two invoices for one customer | Write down both numbers and tell the manager; invoices can't be deleted — your accountant decides how to record it. |
