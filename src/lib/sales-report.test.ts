import { describe, expect, it } from "vitest";
import { csvRow } from "./csv";
import { groupSales, parseSalesCsv } from "./sales-report";

const header = ["Invoice No", "HSN", "GST Rate %", "Taxable Value", "CGST", "SGST", "Line Total", "Qty", "Unit", "Item Name"];
describe("sales reports", () => {
  it("reads BOM, quoted commas, escaped quotes and multiline product names", () => {
    const text = '\uFEFF' + csvRow(header) + csvRow(["A", "0401", "5", "10.00", "0.25", "0.25", "10.50", "1.5", "kg", 'Milk, "fresh"\npack']);
    const rows = parseSalesCsv(text);
    expect(rows[0].HSN).toBe("0401");
    expect(rows[0]["Item Name"]).toBe('Milk, "fresh"\npack');
    expect(groupSales(rows, "hsn")[0].total).toBe(1050);
  });
  it("separates HSN tax rates and units, deduplicates invoices and sums paise", () => {
    const rows = parseSalesCsv(csvRow(header) + [
      ["A", "0401", "5", "0.10", "0.01", "0.01", "0.12", "1", "kg", "Milk"],
      ["A", "0401", "5", "0.20", "0.01", "0.01", "0.22", "2", "PCS", "Milk"],
      ["B", "0401", "12", "1.00", "0.06", "0.06", "1.12", "1", "PCS", "Milk"],
      ["C", "", "5", "1.00", "0.02", "0.02", "1.04", "1", "PCS", "Other"],
    ].map(csvRow).join(""));
    const groups = groupSales(rows, "hsn");
    expect(groups).toHaveLength(3);
    expect(groups[0].taxable).toBe(30);
    expect(groups[0].invoices.size).toBe(1);
    expect(groups[0].quantities).toEqual({ kg: 1, PCS: 2 });
    expect(groupSales(rows, "gst")).toHaveLength(2);
  });
  it("rejects incomplete downloads and unexpected response formats", () => {
    expect(() => parseSalesCsv(csvRow(header) + '"unfinished')).toThrow();
    expect(() => parseSalesCsv("<html>Login</html>")).toThrow();
    expect(() => parseSalesCsv(csvRow(header) + "A,0401\n")).toThrow();
  });
});
