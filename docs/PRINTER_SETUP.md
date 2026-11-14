# Printer setup (billing counters)

Ichiba QuickBill prints bills through the browser's normal print dialog to the counter's
thermal receipt printer. Each bill prints as **two pages**: `CUSTOMER COPY`, then `STORE COPY`.
There is no silent printing and no direct printer commands (ESC/POS), so the setup below is
done once per counter PC in Windows, in the printer driver and in the browser.

Printing never changes a sale. If the print dialog is cancelled, the printer is off or the
paper jams, the invoice is already saved — press **Reprint** on the Completed panel. Reprints
are loaded again from the database and are marked `*** REPRINT ***`.

---

## 1. Install the printer and make it the Windows default

1. Install the driver from the printer maker (Epson, TVS, Xprinter, etc.), not the generic
   Windows "Text Only" driver. Print the driver's own test page once to confirm it works.
2. Open **Settings → Bluetooth & devices → Printers & scanners**.
3. Turn **off** "Let Windows manage my default printer" (otherwise Windows switches the
   default to whatever printed last).
4. Click the thermal printer → **Set as default**.

The browser normally preselects the printer used last, so the default mainly matters the
first time and after browser updates.

## 2. Paper size and cutting in the printer driver

Open **Printers & scanners → (thermal printer) → Printing preferences** (and also
**Printer properties → Advanced → Printing Defaults**, which some drivers use instead).
Names differ between makers; look for:

| Setting | Set to |
|---|---|
| Paper size / Paper | The roll you use: **58 mm** (often "58 x 3276 mm" or "Roll 58") or **80 mm** ("80 x 3276 mm", "Roll 80"). Pick a roll/receipt size, not A4. |
| Cut / Paper cut / Cutter | **Cut after each page** (sometimes "Page cut", "Cut per page", "Partial cut at page end"). Avoid "Cut at end of document" — that puts both copies on one strip. |
| Paper feed / Reduce blank / Paper saving | **On** if offered: stops the printer feeding blank paper after the text. |
| Print density / Darkness | Raise one step if the text is faint. |
| Scaling / Fit to page (if present) | Off / 100 %. |

If the driver has **no** cut-per-page option, the two copies still come out as two pages;
tear them apart at the dashed line at the bottom of the customer copy. Whether a printer
cuts on a page break depends entirely on the driver — test it (section 5).

The paper width the app prints at is set per counter by an admin (`counters.print_width_mm`,
58 or 80). It must match the roll in the printer. To change it on one PC only, see section 4.

## 3. Chrome / Edge print settings

Open any bill's print dialog (or the test page, section 5) and set, once:

- **Destination:** the thermal printer.
- **More settings → Margins: None.**
- **More settings → Headers and footers: off** (otherwise the date, page title and web address
  are printed on every receipt).
- **Scale: Default** (100). Do not use "Fit to page width".
- **Background graphics:** not needed.

Chrome and Edge remember these per printer for the next print. Check them again after a
browser update or if bills suddenly print small, with a web address, or with wide margins.

## 4. Device override and test page (in the app)

Click the **printer icon** in the top bar to open **Printer settings**:

- **Counter setting** (default) — uses the width an admin set for this counter.
- **58 mm / 80 mm on this device** — overrides it for this browser on this PC only (stored in
  the browser; clearing browsing data resets it).

## 5. Test

Press **Print test page** in Printer settings. It prints two pages, like a real bill. Check:

- The box marked `|< … >|` is fully visible — both edges printed, nothing cut off. If the
  right side is cut off, the paper width in the app is larger than the roll (choose 58 mm), or
  the driver's paper size is wrong.
- The text is dark and readable; the big `TOTAL` line is clearly larger.
- The printer cuts (or pauses for tearing) **between** page 1 and page 2, not after both.
- No date, title or web address is printed at the top or bottom (section 3).

Then make one small real sale, check both copies, and try **Reprint**.

## 6. Optional: Chrome kiosk printing (`--kiosk-printing`)

Chrome and Edge can skip the print dialog and send every print straight to the **default
printer**. This makes billing one click faster, but read the trade-offs first.

How to set it up:

1. Do sections 1–3 first (default printer, paper size, no headers/footers — the dialog will no
   longer be there to fix them).
2. Make a desktop shortcut for the counter, e.g. for Chrome:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://<your-billing-url>/
   ```

   For Edge use `msedge.exe` (in `C:\Program Files (x86)\Microsoft\Edge\Application\`) with the
   same flag.
3. Close **all** Chrome/Edge windows (including the tray icon / background apps) and start the
   browser only from this shortcut. The flag only applies when the browser starts with it.

Trade-offs:

- **Every** print from that browser goes to the default printer, silently — including
  `Ctrl+P` on any other website. Use a separate browser profile or browser just for billing.
- No chance to fix a wrong printer, wrong paper or a "printer offline" error per bill. If the
  default printer changes (section 1, step 3) bills go to the wrong place without a warning.
  Margins/headers use whatever was last saved for that printer.
- A failed or jammed print is not reported to the app; staff must watch the printer and use
  **Reprint** if nothing came out.
- Without the flag (the default), everything still works — the cashier just presses
  **Enter/Print** in the dialog for each bill.
- `--kiosk-printing` is not the same as `--kiosk` (full-screen kiosk mode); you don't need
  `--kiosk`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Web address / date printed on the receipt | Chrome/Edge: Headers and footers off (section 3). |
| Text tiny or squashed into a corner | Scale: Default; driver paper size is the roll, not A4. |
| Right side cut off | Width too large for the roll: choose 58 mm (section 4) or fix driver paper size. |
| Both copies on one strip, no cut between | Driver: cut after each page (section 2). If not supported, tear at the dashed line. |
| Long blank paper after the bill | Driver: paper saving / reduce blank on; pick the roll size in section 2. |
| Faint print | Driver density up; replace the paper roll (thermal side must face the head). |
| Nothing printed but the bill shows Completed | The sale is saved. Fix the printer, then **Reprint**. Never bill again. |
