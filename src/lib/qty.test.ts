import { describe, expect, it } from "vitest";
import {
  exportQtyCells,
  formatLinesAndPieces,
  formatQty,
  formatQtyWithUnit,
  MAX_QTY_MILLI,
  parseQty,
  parseQtyMilli,
  qtyMilliFromNumber,
  qtyMilliToJson,
  qtyProblem,
  saleQtySchema,
} from "./qty";

describe("parseQtyMilli (shape only)", () => {
  it.each([
    ["0.250", 250],
    [".250", 250],
    [".25", 250],
    ["1", 1000],
    ["2.5", 2500],
    ["2.", 2000],
    ["0.001", 1],
    ["1.005", 1005],
    ["999.999", 999_999],
    ["  3 ", 3000],
    ["0007", 7000],
    ["9999", 9_999_000],
  ])("%j → %i thousandths", (text, milli) => {
    expect(parseQtyMilli(text)).toEqual({ ok: true, qtyMilli: milli });
  });

  it.each([
    ["", "Enter a quantity."],
    [".", "Enter a quantity."],
    ["0", "more than 0"],
    ["0.000", "more than 0"],
    ["1.2345", "At most 3 decimals"],
    ["0.0005", "At most 3 decimals"],
    ["-1", "Numbers only"],
    ["1,5", "Numbers only"],
    ["1e3", "Numbers only"],
    ["NaN", "Numbers only"],
    ["½", "Numbers only"],
    ["10000", "cannot exceed 9,999"],
    ["99999999999999999999", "cannot exceed 9,999"],
  ])("refuses %j", (text, message) => {
    const r = parseQtyMilli(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });
});

describe("parseQty (the product's rule)", () => {
  it("weighed: up to 3 decimals, 0.001–999.999 kg", () => {
    expect(parseQty(".250", true)).toEqual({ ok: true, qtyMilli: 250 });
    expect(parseQty("0.001", true)).toEqual({ ok: true, qtyMilli: 1 });
    expect(parseQty("1.005", true)).toEqual({ ok: true, qtyMilli: 1005 });
    expect(parseQty("999.999", true)).toEqual({ ok: true, qtyMilli: 999_999 });
    expect(parseQty("1", true)).toEqual({ ok: true, qtyMilli: 1000 });
    expect(parseQty("1000", true)).toMatchObject({ ok: false, error: "Weight must be 0.001–999.999 kg." });
    expect(parseQty("1.2345", true)).toMatchObject({ ok: false, error: expect.stringContaining("At most 3 decimals") });
    expect(parseQty("0.0005", true)).toMatchObject({ ok: false, error: expect.stringContaining("At most 3 decimals") });
  });

  it("normal items: whole numbers 1–9,999, decimals refused", () => {
    expect(parseQty("3", false)).toEqual({ ok: true, qtyMilli: 3000 });
    expect(parseQty("2.000", false)).toEqual({ ok: true, qtyMilli: 2000 });
    expect(parseQty("9999", false)).toEqual({ ok: true, qtyMilli: 9_999_000 });
    for (const text of [".5", "0.5", "2.5", "1.005", "1.2345"]) {
      expect(parseQty(text, false), text).toMatchObject({ ok: false, error: expect.stringContaining("Whole numbers only") });
    }
    expect(parseQty("10000", false).ok).toBe(false);
    expect(parseQty("0", false).ok).toBe(false);
  });

  it("qtyProblem matches the database checks", () => {
    expect(qtyProblem(1, true)).toBeNull();
    expect(qtyProblem(999_999, true)).toBeNull();
    expect(qtyProblem(1_000_000, true)).not.toBeNull();
    expect(qtyProblem(0, true)).not.toBeNull();
    expect(qtyProblem(1000, false)).toBeNull();
    expect(qtyProblem(1500, false)).not.toBeNull();
    expect(qtyProblem(9_999_000, false)).toBeNull();
    expect(qtyProblem(10_000_000, false)).not.toBeNull();
    expect(qtyProblem(Number.NaN, false)).not.toBeNull();
    expect(qtyProblem(2.5, true)).not.toBeNull(); // thousandths are integers
  });
});

describe("formatting", () => {
  it("weighed lines always show 3 decimals and kg", () => {
    expect(formatQty(250, true)).toBe("0.250");
    expect(formatQty(1000, true)).toBe("1.000");
    expect(formatQty(999_999, true)).toBe("999.999");
    expect(formatQtyWithUnit(250, true)).toBe("0.250 kg");
    expect(formatQtyWithUnit(3000, false)).toBe("3");
  });

  it("round-trips through the parser", () => {
    for (const milli of [1, 9, 10, 99, 100, 250, 1000, 1005, 123_456, 999_999]) {
      expect(parseQty(formatQty(milli, true), true)).toEqual({ ok: true, qtyMilli: milli });
    }
  });

  it("summarises lines and pieces", () => {
    expect(formatLinesAndPieces(3, 5)).toBe("3 lines · 5 pcs");
    expect(formatLinesAndPieces(1, 1)).toBe("1 line · 1 pc");
    expect(formatLinesAndPieces(2, 0)).toBe("2 lines · 0 pcs");
  });
});

describe("lines CSV cells", () => {
  it("keeps Qty numeric and puts the unit in its own column", () => {
    expect(exportQtyCells(0.25, true)).toEqual({ qty: "0.250", unit: "kg" });
    expect(exportQtyCells(999.999, true)).toEqual({ qty: "999.999", unit: "kg" });
    expect(exportQtyCells(2, true)).toEqual({ qty: "2.000", unit: "kg" });
    expect(exportQtyCells(2, false)).toEqual({ qty: "2", unit: "pcs" });
    expect(() => exportQtyCells(0.0005, true)).toThrow();
  });
});

describe("JSON transport (server action -> create_invoice)", () => {
  it("every thousandth up to 9,999 becomes a JSON number with exactly that decimal", () => {
    for (let milli = 1; milli <= MAX_QTY_MILLI; milli++) {
      const json = JSON.stringify(qtyMilliToJson(milli));
      const whole = Math.trunc(milli / 1000);
      const frac = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
      const expected = frac ? `${whole}.${frac}` : String(whole);
      if (json !== expected) throw new Error(`${milli}: ${json} ≠ ${expected}`);
      // ...and reads back from the database's numeric(10,3) JSON ("0.250") to the same integer.
      if (qtyMilliFromNumber(JSON.parse(formatQty(milli, true))) !== milli) throw new Error(`read back ${milli}`);
    }
  });

  it("refuses database numbers that are not whole thousandths", () => {
    expect(qtyMilliFromNumber(0.0005)).toBeNull();
    expect(qtyMilliFromNumber(Number.NaN)).toBeNull();
    expect(qtyMilliFromNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("saleQtySchema (Server Action input)", () => {
  it("accepts text and whole numbers", () => {
    expect(saleQtySchema.parse("0.250")).toBe(250);
    expect(saleQtySchema.parse(".250")).toBe(250);
    expect(saleQtySchema.parse("1")).toBe(1000);
    expect(saleQtySchema.parse("2.5")).toBe(2500);
    expect(saleQtySchema.parse(3)).toBe(3000);
  });

  it.each([["1.2345"], ["0.0005"], ["0"], ["-1"], ["abc"], [""], ["10000"]])("refuses %j", (text) => {
    expect(saleQtySchema.safeParse(text).success).toBe(false);
  });

  it("refuses floats, NaN and other types (decimals must be text)", () => {
    for (const value of [0.25, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, true, {}]) {
      expect(saleQtySchema.safeParse(value).success, String(value)).toBe(false);
    }
  });
});
