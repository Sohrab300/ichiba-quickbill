import { describe, expect, it } from "vitest";
import { gofrugalSheets, GOFRUGAL_SHEET_LIMIT } from "./gofrugal-export";

const line = (payment: string, amount: string, quantity = "1.5") => ({
  "Invoice No": "B001", "Item Code": "00123", "Payment Method": payment, "Line Total": amount, Qty: quantity,
});

describe("Gofrugal export sheets", () => {
  it("separates interleaved payment modes and restarts sheet numbering", () => {
    const sheets = gofrugalSheets([line("Card", "30000"), line("Cash", "10"), line("Card", "20000"), line("card", "0.01"), line("UPI", "1")]);
    expect(sheets.map(sheet => sheet.name)).toEqual(["Card 1", "Card 2", "Cash 1", "UPI 1"]);
    expect(sheets[0].rows.reduce((sum, row) => sum + row.amountPaise, 0)).toBe(GOFRUGAL_SHEET_LIMIT);
    expect(sheets.every(sheet => sheet.rows.reduce((sum, row) => sum + row.amountPaise, 0) <= GOFRUGAL_SHEET_LIMIT)).toBe(true);
    expect(sheets[0].rows[0]).toEqual({ barcode: "00123", quantityMilli: 1500, amountPaise: 3000000 });
  });
  it("rejects oversized lines and invalid data without silently omitting sales", () => {
    expect(() => gofrugalSheets([line("Card", "50000.01")])).toThrow("exceeds");
    expect(() => gofrugalSheets([line("", "10")])).toThrow("payment method");
    expect(() => gofrugalSheets([line("Cash", "NaN")])).toThrow();
    expect(() => gofrugalSheets([line("Cash", "1", "0")])).toThrow();
    expect(gofrugalSheets([])).toEqual([]);
  });
});
