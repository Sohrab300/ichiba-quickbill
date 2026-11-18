import { describe, expect, it } from "vitest";
import { addIstDays, istDaysInclusive } from "./ist-date";
import {
  parseSalesReportInput,
  quantityLabel,
  quickRanges,
  salesReportCsv,
  salesReportCsvQuery,
  salesReportFilename,
  type SalesReport,
} from "./sales-report";

const valid = { from: "2026-11-01", to: "2026-11-19", group: "hsn" };

describe("sales report input", () => {
  it("accepts a valid range; counter optional, trimmed and upper-cased", () => {
    expect(parseSalesReportInput(valid)).toEqual({ ok: true, query: { ...valid, counter: null } });
    expect(parseSalesReportInput({ ...valid, counter: "" })).toMatchObject({ ok: true, query: { counter: null } });
    expect(parseSalesReportInput({ ...valid, counter: null })).toMatchObject({ ok: true, query: { counter: null } });
    expect(parseSalesReportInput({ ...valid, counter: " cl1 " })).toMatchObject({ ok: true, query: { counter: "CL1" } });
    expect(parseSalesReportInput({ ...valid, group: "gst" })).toMatchObject({ ok: true, query: { group: "gst" } });
  });

  it("accepts a single day and exactly 92 days (a full quarter)", () => {
    expect(parseSalesReportInput({ ...valid, from: "2026-11-19", to: "2026-11-19" }).ok).toBe(true);
    expect(parseSalesReportInput({ ...valid, from: "2026-07-01", to: "2026-09-30" }).ok).toBe(true);
  });

  it.each([
    ["93 days", { from: "2026-07-01", to: "2026-10-01" }, "at most 92 days (this range has 93)"],
    ["from after to", { from: "2026-11-20", to: "2026-11-19" }, "From must be on or before To"],
    ["not a real date", { from: "2026-02-30" }, "From date must be a real date"],
    ["wrong format", { to: "19/11/2026" }, "To date must be a real date"],
    ["datetime, not a date", { from: "2026-11-01T00:00:00Z" }, "From date must be a real date"],
    ["missing from", { from: undefined }, "From date is required"],
    ["unknown group", { group: "item" }, "Group by must be HSN or GST rate"],
    ["missing group", { group: undefined }, "Group by must be HSN or GST rate"],
    ["counter with symbols", { counter: "CL1'--" }, "Unknown counter"],
    ["counter too long", { counter: "ABCDEFGHI" }, "Unknown counter"],
  ])("refuses %s", (_name, change, message) => {
    const result = parseSalesReportInput({ ...valid, ...change });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it("refuses input that is not an object", () => {
    expect(parseSalesReportInput(null).ok).toBe(false);
    expect(parseSalesReportInput("2026-11-01").ok).toBe(false);
  });
});

describe("IST day arithmetic", () => {
  it("counts both ends and crosses months, years and leap days", () => {
    expect(istDaysInclusive("2026-11-19", "2026-11-19")).toBe(1);
    expect(istDaysInclusive("2026-11-20", "2026-11-19")).toBe(0);
    expect(istDaysInclusive("2028-02-01", "2028-03-01")).toBe(30);
    expect(addIstDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addIstDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addIstDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("quick ranges", () => {
  it("today, yesterday, this month so far, the whole last month", () => {
    expect(quickRanges("2026-11-19")).toEqual([
      { label: "Today", from: "2026-11-19", to: "2026-11-19" },
      { label: "Yesterday", from: "2026-11-18", to: "2026-11-18" },
      { label: "This month", from: "2026-11-01", to: "2026-11-19" },
      { label: "Last month", from: "2026-10-01", to: "2026-10-31" },
    ]);
  });
  it("on the 1st of January", () => {
    expect(quickRanges("2027-01-01")).toEqual([
      { label: "Today", from: "2027-01-01", to: "2027-01-01" },
      { label: "Yesterday", from: "2026-12-31", to: "2026-12-31" },
      { label: "This month", from: "2027-01-01", to: "2027-01-01" },
      { label: "Last month", from: "2026-12-01", to: "2026-12-31" },
    ]);
  });
  it("every quick range is a valid report range", () => {
    for (const today of ["2026-11-19", "2027-01-01", "2028-03-31"]) {
      for (const r of quickRanges(today)) expect(parseSalesReportInput({ from: r.from, to: r.to, group: "gst" }).ok).toBe(true);
    }
  });
});

const sums = { invoiceCount: 3, lineCount: 6, qtyKgMilli: 375, qtyPcsMilli: 7000, taxable: 25405, cgst: 1633, sgst: 1635, lineTotal: 28673 };
const report: SalesReport = {
  from: "2026-11-01",
  to: "2026-11-19",
  counter: null,
  group: "hsn",
  rows: [
    { hsn: "0703", gstRate: 0, invoiceCount: 1, lineCount: 1, qtyKgMilli: 375, qtyPcsMilli: 0, taxable: 3000, cgst: 0, sgst: 0, lineTotal: 3000 },
    { hsn: "3401", gstRate: 18, invoiceCount: 3, lineCount: 3, qtyKgMilli: 0, qtyPcsMilli: 4500, taxable: 16526, cgst: 1486, sgst: 1488, lineTotal: 19500 },
    { hsn: null, gstRate: 0, invoiceCount: 1, lineCount: 1, qtyKgMilli: 0, qtyPcsMilli: 2000, taxable: 0, cgst: 0, sgst: 0, lineTotal: 0 },
  ],
  total: sums,
};

describe("report CSV", () => {
  it("BOM, header, the rows in screen order, then Total; HSN quoted; rupees with 2 decimals", () => {
    const lines = salesReportCsv(report).split("\r\n");
    expect(lines[0]).toBe("﻿HSN,GST Rate %,Invoices,Lines,Qty (kg),Qty (pcs),Taxable Value,CGST,SGST,Total GST,Sales before round-off");
    expect(lines.slice(1)).toEqual([
      '"0703",0,1,1,0.375,0,30.00,0.00,0.00,0.00,30.00',
      '"3401",18,3,3,0.000,4.5,165.26,14.86,14.88,29.74,195.00',
      '"Unspecified",0,1,1,0.000,2,0.00,0.00,0.00,0.00,0.00',
      "Total,,3,6,0.375,7,254.05,16.33,16.35,32.68,286.73",
      "",
    ]);
  });

  it("by GST rate: no HSN column", () => {
    const gst = { ...report, group: "gst" as const, rows: [{ ...report.rows[0], hsn: null }] };
    const lines = salesReportCsv(gst).split("\r\n");
    expect(lines[0]).toBe("﻿GST Rate %,Invoices,Lines,Qty (kg),Qty (pcs),Taxable Value,CGST,SGST,Total GST,Sales before round-off");
    expect(lines[1]).toBe("0,1,1,0.375,0,30.00,0.00,0.00,0.00,30.00");
    expect(lines[2]).toBe("Total,3,6,0.375,7,254.05,16.33,16.35,32.68,286.73");
  });

  it("empty range: header and a zero Total", () => {
    const empty = { ...report, rows: [], total: { ...sums, invoiceCount: 0, lineCount: 0, qtyKgMilli: 0, qtyPcsMilli: 0, taxable: 0, cgst: 0, sgst: 0, lineTotal: 0 } };
    expect(salesReportCsv(empty).split("\r\n").slice(1)).toEqual(["Total,,0,0,0.000,0,0.00,0.00,0.00,0.00,0.00", ""]);
  });

  it("route query and file name follow the report shown", () => {
    expect(salesReportCsvQuery(report)).toBe("from=2026-11-01&to=2026-11-19&group=hsn");
    expect(salesReportCsvQuery({ ...report, counter: "CL1", group: "gst" })).toBe("from=2026-11-01&to=2026-11-19&group=gst&counter=CL1");
    expect(salesReportFilename(report)).toBe("sales-hsn-2026-11-01_2026-11-19.csv");
    expect(salesReportFilename({ ...report, from: "2026-11-19", to: "2026-11-19", counter: "MOB" })).toBe("sales-hsn-2026-11-19-MOB.csv");
  });

  it("quantity label: kg and pieces, — when none", () => {
    expect(quantityLabel(sums)).toBe("0.375 kg · 7 pcs");
    expect(quantityLabel({ qtyKgMilli: 0, qtyPcsMilli: 2500 })).toBe("2.5 pcs");
    expect(quantityLabel({ qtyKgMilli: 0, qtyPcsMilli: 0 })).toBe("—");
  });
});
