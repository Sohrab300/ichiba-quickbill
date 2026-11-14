# Daily CSV exports

Admins can download two CSV files per day from **Invoices** (buttons **Summary CSV** and
**Lines CSV**, top right). Both use the date and counter currently selected on the page. The
files are built on the server from Supabase. Each export covers one full day in India time
(00:00–24:00 IST).

| Export      | URL                                                       | One row per    |
| ----------- | --------------------------------------------------------- | -------------- |
| Summary CSV | `/api/exports/daily-summary?date=YYYY-MM-DD[&counter=CL1]` | invoice        |
| Lines CSV   | `/api/exports/daily-lines?date=YYYY-MM-DD[&counter=CL1]`   | invoice line   |

Without `date`, the export is for today. Without `counter`, it covers all counters.

## What is in the files

- **Summary:** Invoice No, Date, Time (IST), Counter, Cashier, Payment Method, Items, Qty,
  Taxable Value, CGST, SGST, Round Off, Total.
- **Lines:** Invoice No, Date, Time (IST), Counter, Cashier, Payment Method, Line, Item Code,
  Item Name, HSN, UOM, Qty, Rate, MRP, GST Rate %, Taxable Value, CGST, SGST, Line Total.

The formats are:

- Amounts are in rupees with exactly 2 decimals and no thousands separators (`1190.00`, `-0.40`).
- Dates are `YYYY-MM-DD` and times are 24-hour IST (`18:32:05`).
- The file is UTF-8 with a byte order mark, so ₹ and non-English names show correctly in Excel.
- **Item Code** and **HSN** are always written in quotes (`"0401"`), because they are codes
  and must keep their leading zeros. The summary file has neither column.
- If a product or cashier name starts with `=`, `+`, `-` or `@`, it is written with a leading
  `'` so that a spreadsheet never runs it as a formula. The files contain no formulas at all.

The Summary CSV adds up to the day totals at the top of **Invoices** for the same date and
counter. Totals: Taxable Value + CGST + SGST + Round Off = Total.

## Opening a file in Excel without losing leading zeros

**Double-clicking the file is fine for checking amounts. It is not fine for codes.** Excel
treats every value that looks like a number as a number, even when it is quoted. An HSN like
`0401` becomes `401`, and an item code like `0012345` becomes `12345`. Excel only keeps the
codes exactly if you import the file and set those columns to **Text**.

### Excel for Microsoft 365 / Excel 2019 or later (Power Query)

1. Open a blank workbook. Go to **Data → From Text/CSV** and pick the downloaded file.
2. In the preview, check that **File Origin** is **65001: Unicode (UTF-8)** and **Delimiter** is
   **Comma**. Click **Transform Data** (not Load).
3. In the Power Query editor, click the **Item Code** column header, then Ctrl+click **HSN**.
4. Right-click one of the selected headers and choose **Change Type → Text**.
5. Excel asks *Change Column Type*. Choose **Replace current**. This matters: **Add new step**
   would convert the numbers Excel already guessed, and the zeros would stay lost.
6. Click **Home → Close & Load**.

Both columns are now left-aligned text with their leading zeros, e.g. `0401`.

### Older Excel, or the classic Text Import Wizard

1. If you don't see the wizard, turn it on first: **File → Options → Data**, tick
   **From Text (Legacy)** under *Show legacy data import wizards*, then click OK.
2. Go to **Data → Get Data → Legacy Wizards → From Text (Legacy)** and pick the file.
3. Step 1: choose **Delimited**. Set **File origin** to **65001: Unicode (UTF-8)** and tick
   **My data has headers**.
4. Step 2: tick **Comma** only.
5. Step 3: click the **Item Code** column in the preview and choose **Text** under *Column data
   format*. Do the same for **HSN**.
6. Click **Finish**, then **OK**.

### Google Sheets

Go to **File → Import → Upload**, choose the file, and **untick "Convert text to numbers, dates
and formulas"** before importing.

## Troubleshooting

- **401 / 403:** you are signed out, or the login is not an admin. Only admins can export.
- **400 "date must be a real date":** use `YYYY-MM-DD`, e.g. `2026-11-15`.
- **400 "Unknown counter":** use a counter code like `CL1`, `CL2`, `CL3` or `MOB`.
- **500 "…is missing — apply the invoice history migration":** run `npx supabase db push`.
- **The download stops part-way:** the database connection dropped during the export. Download
  it again. The browser marks such a download as failed. Don't use a file from a failed
  download.
