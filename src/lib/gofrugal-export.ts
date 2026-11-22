import type { SaleLine } from "./daily-sales-report";

export const GOFRUGAL_SHEET_LIMIT = 5_000_000; // ₹50,000 in paise
export interface GofrugalRow { barcode: string; quantityMilli: number; amountPaise: number }

export interface GofrugalSheet { name: string; rows: GofrugalRow[] }

/** Pack whole sale lines; never invent quantities or alter original invoice values. */
function packLines(lines: SaleLine[]): GofrugalRow[][] {
  const sheets: GofrugalRow[][] = [];
  let rows: GofrugalRow[] = [], total = 0;
  for (const line of lines) {
    const barcode = line["Item Code"]?.trim();
    const quantity = Number(line.Qty), amount = Number(line["Line Total"]);
    if (!barcode || !line.Qty?.trim() || !line["Line Total"]?.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(amount) || amount < 0) {
      throw new Error("Cannot export: a sale line has a missing item code or invalid quantity/amount.");
    }
    const amountPaise = Math.round(amount * 100), quantityMilli = Math.round(quantity * 1000);
    if (!Number.isSafeInteger(amountPaise) || !Number.isSafeInteger(quantityMilli)) throw new Error("Sale values exceed the supported export range.");
    if (amountPaise > GOFRUGAL_SHEET_LIMIT) throw new Error(`Item ${barcode} on bill ${line["Invoice No"]} exceeds ₹50,000 on a single line. It cannot be exported without splitting that line; no file was generated.`);
    if (total + amountPaise > GOFRUGAL_SHEET_LIMIT) { sheets.push(rows); rows = []; total = 0; }
    rows.push({ barcode, quantityMilli, amountPaise }); total += amountPaise;
  }
  if (rows.length) sheets.push(rows);
  return sheets;
}

/** Payment modes never share a sheet; numbering restarts for each mode. */
export function gofrugalSheets(lines: SaleLine[]): GofrugalSheet[] {
  const payments = new Map<string, SaleLine[]>();
  for (const line of lines) {
    const raw = line["Payment Method"]?.trim().toLowerCase();
    const mode = raw === "cash" ? "Cash" : raw === "card" ? "Card" : raw === "upi" ? "UPI" : null;
    if (!mode) throw new Error(`Cannot export bill ${line["Invoice No"]}: missing or unsupported payment method.`);
    const entries = payments.get(mode) ?? [];
    entries.push(line); payments.set(mode, entries);
  }
  return ["Card", "Cash", "UPI"].flatMap(mode => packLines(payments.get(mode) ?? []).map((rows, index) => ({ name: `${mode} ${index + 1}`, rows })));
}

export async function downloadGofrugal(lines: SaleLine[], filename: string) {
  const sheets = gofrugalSheets(lines);
  if (!sheets.length) throw new Error("No sales to export.");
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  sheets.forEach(({ name, rows }) => {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = [{ header: "Barcode", key: "barcode", width: 24 }, { header: "Quantity", key: "quantity", width: 16 }, { header: "Amount", key: "amount", width: 18 }];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getColumn(1).numFmt = "@";
    sheet.getColumn(2).numFmt = "0.###";
    sheet.getColumn(3).numFmt = "0.00";
    rows.forEach(row => sheet.addRow({ barcode: row.barcode, quantity: row.quantityMilli / 1000, amount: row.amountPaise / 100 }));
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return sheets.length;
}
