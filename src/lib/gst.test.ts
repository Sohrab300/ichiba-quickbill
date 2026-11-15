import { describe, expect, it } from "vitest";
import { computeInvoiceTotals, computeLineGst, lineTotalPaise, roundToRupee } from "./gst";
import { GST_RATES } from "./constants";

describe("computeLineGst", () => {
  it("splits an exact inclusive price", () => {
    // ₹118.00 at 18% → ₹100.00 taxable + ₹18.00 GST (₹9 + ₹9)
    expect(computeLineGst({ unitPrice: 11800, gstRate: 18, qtyMilli: 1000 })).toEqual({
      lineTotal: 11800,
      taxableValue: 10000,
      cgst: 900,
      sgst: 900,
    });
  });

  it("multiplies by qty before computing tax (tax is per line, not per unit)", () => {
    // 3 × ₹1.00 at 18%: per line 300·100/118 = 254.237… → 254; per unit would give 3 × 85 = 255.
    expect(computeLineGst({ unitPrice: 100, gstRate: 18, qtyMilli: 3000 })).toEqual({
      lineTotal: 300,
      taxableValue: 254,
      cgst: 23,
      sgst: 23,
    });
  });

  it("rounds taxable value to the nearest paisa", () => {
    // 10000/118 = 84.745… → 85 taxable, 15 GST → CGST 7, SGST 8
    expect(computeLineGst({ unitPrice: 100, gstRate: 18, qtyMilli: 1000 })).toEqual({
      lineTotal: 100,
      taxableValue: 85,
      cgst: 7,
      sgst: 8,
    });
    // 199·100/105 = 189.523… → 190
    expect(computeLineGst({ unitPrice: 199, gstRate: 5, qtyMilli: 1000 }).taxableValue).toBe(190);
    // 101·100/105 = 96.190… → 96
    expect(computeLineGst({ unitPrice: 101, gstRate: 5, qtyMilli: 1000 }).taxableValue).toBe(96);
  });

  it("rounds an exact half paisa up", () => {
    // 14·100/112 = 12.5 → 13 (GST 1 → CGST 0, SGST 1)
    expect(computeLineGst({ unitPrice: 14, gstRate: 12, qtyMilli: 1000 })).toEqual({
      lineTotal: 14,
      taxableValue: 13,
      cgst: 0,
      sgst: 1,
    });
    // 16·100/128 = 12.5 → 13
    expect(computeLineGst({ unitPrice: 16, gstRate: 28, qtyMilli: 1000 }).taxableValue).toBe(13);
    // 7·100/140 = 5 exactly (not a half case)
    expect(computeLineGst({ unitPrice: 7, gstRate: 40, qtyMilli: 1000 }).taxableValue).toBe(5);
  });

  it("puts the odd paisa of GST in SGST (CGST = floor)", () => {
    const line = computeLineGst({ unitPrice: 100, gstRate: 18, qtyMilli: 1000 });
    expect(line.sgst - line.cgst).toBe(1);
    expect(line.cgst).toBe(Math.floor((line.lineTotal - line.taxableValue) / 2));
  });

  it("has no GST at 0%", () => {
    expect(computeLineGst({ unitPrice: 4999, gstRate: 0, qtyMilli: 7000 })).toEqual({
      lineTotal: 34993,
      taxableValue: 34993,
      cgst: 0,
      sgst: 0,
    });
  });

  it("handles free items", () => {
    expect(computeLineGst({ unitPrice: 0, gstRate: 18, qtyMilli: 2000 })).toEqual({
      lineTotal: 0,
      taxableValue: 0,
      cgst: 0,
      sgst: 0,
    });
  });

  it("is exact for large amounts (no floating point drift)", () => {
    // ₹99,99,999.99 × 9999 at 28%
    const line = computeLineGst({ unitPrice: 999_999_999, gstRate: 28, qtyMilli: 9999000 });
    const exact = (BigInt(line.lineTotal) * BigInt(200) + BigInt(128)) / BigInt(256);
    expect(BigInt(line.taxableValue)).toBe(exact);
    expect(line.taxableValue + line.cgst + line.sgst).toBe(line.lineTotal);
  });

  it("rejects non-integer or out-of-range input", () => {
    expect(() => computeLineGst({ unitPrice: 10.5, gstRate: 18, qtyMilli: 1000 })).toThrow(RangeError);
    expect(() => computeLineGst({ unitPrice: 100, gstRate: 18, qtyMilli: 0 })).toThrow(RangeError);
    expect(() => computeLineGst({ unitPrice: -1, gstRate: 18, qtyMilli: 1000 })).toThrow(RangeError);
    expect(() => computeLineGst({ unitPrice: 100, gstRate: 18, qtyMilli: 1500 })).toThrow(RangeError);
  });
});

describe("roundToRupee", () => {
  it.each([
    [12300, 12300, 0],
    [12349, 12300, -49],
    [12350, 12400, 50], // half rupee rounds up
    [12351, 12400, 49],
    [12399, 12400, 1],
    [1, 0, -1],
    [50, 100, 50],
    [0, 0, 0],
  ])("%i paise → %i (round off %i)", (paise, grandTotal, roundOff) => {
    expect(roundToRupee(paise)).toEqual({ grandTotal, roundOff });
  });
});

describe("computeInvoiceTotals", () => {
  it("sums per-line values and rounds the bill", () => {
    const { lines, totals } = computeInvoiceTotals([
      { unitPrice: 11800, gstRate: 18, qtyMilli: 2000 }, // 23600 → 20000 + 1800 + 1800
      { unitPrice: 100, gstRate: 18, qtyMilli: 1000 }, //     100 → 85 + 7 + 8
      { unitPrice: 4999, gstRate: 0, qtyMilli: 1000 }, //    4999 → 4999
      { unitPrice: 14, gstRate: 12, qtyMilli: 1000 }, //       14 → 13 + 0 + 1
    ]);
    expect(lines.map((l) => l.taxableValue)).toEqual([20000, 85, 4999, 13]);
    expect(totals).toEqual({
      itemCount: 4,
      totalQty: 5,
      subtotal: 28713,
      taxableTotal: 25097,
      cgstTotal: 1807,
      sgstTotal: 1809,
      roundOff: -13,
      grandTotal: 28700,
    });
  });

  it("keeps extra line fields (for the cart UI)", () => {
    const { lines } = computeInvoiceTotals([{ productId: "p1", unitPrice: 500, gstRate: 5, qtyMilli: 1000 }]);
    expect(lines[0].productId).toBe("p1");
  });

  it("returns zeros for an empty cart", () => {
    expect(computeInvoiceTotals([]).totals).toEqual({
      itemCount: 0,
      totalQty: 0,
      subtotal: 0,
      taxableTotal: 0,
      cgstTotal: 0,
      sgstTotal: 0,
      roundOff: 0,
      grandTotal: 0,
    });
  });

  it("always adds up (randomised)", () => {
    // Deterministic PRNG so failures are reproducible.
    let seed = 20261114;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let run = 0; run < 2000; run++) {
      const lines = Array.from({ length: 1 + rand(12) }, () => ({
        unitPrice: rand(500_000),
        gstRate: GST_RATES[rand(GST_RATES.length)],
        qtyMilli: (1 + rand(20)) * 1000,
      }));
      const { lines: out, totals } = computeInvoiceTotals(lines);
      for (const l of out) {
        expect(l.lineTotal).toBe(l.unitPrice * (l.qtyMilli / 1000));
        expect(l.taxableValue + l.cgst + l.sgst).toBe(l.lineTotal);
        expect(l.sgst - l.cgst === 0 || l.sgst - l.cgst === 1).toBe(true);
        // Taxable is the correctly rounded value: |taxable − exact| ≤ ½ paisa.
        const exact = (l.lineTotal * 100) / (100 + l.gstRate);
        expect(Math.abs(l.taxableValue - exact)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
      expect(totals.taxableTotal + totals.cgstTotal + totals.sgstTotal).toBe(totals.subtotal);
      expect(totals.grandTotal).toBe(totals.subtotal + totals.roundOff);
      expect(totals.grandTotal % 100).toBe(0);
      expect(totals.roundOff).toBeGreaterThanOrEqual(-49);
      expect(totals.roundOff).toBeLessThanOrEqual(50);
    }
  });
});

describe("sold by weight (qty in thousandths, REQUIREMENTS.md section 17)", () => {
  /** round(price × milli / 1000) half up, worked out with BigInt as the reference. */
  const reference = (price: number, milli: number) =>
    Number((BigInt(price) * BigInt(milli) * BigInt(2) + BigInt(1000)) / BigInt(2000));

  it.each([
    // [paise per kg, thousandths, line total]
    [7000, 250, 1750], // 0.250 kg × ₹70.00 = ₹17.50 (the README check)
    [7000, 1, 7], // 0.001 kg
    [12345, 999_999, 12_344_988], // 12344987.655 → up
    [101, 1005, 102], // 101.505 → up (half-up on the third decimal)
    [3, 500, 2], // 1.5 paise → 2 (exact half rounds up)
    [3, 166, 0], // 0.498 → 0
    [3, 167, 1], // 0.501 → 1
    [12345, 750, 9259], // 9258.75 → 9259
    [0, 250, 0],
  ])("%i paise/kg × %i g = %i paise", (price, milli, total) => {
    expect(lineTotalPaise(price, milli)).toBe(total);
    expect(reference(price, milli)).toBe(total);
    expect(computeLineGst({ unitPrice: price, gstRate: 0, qtyMilli: milli, soldByWeight: true }).lineTotal).toBe(total);
  });

  it("computes GST on the rounded line total", () => {
    expect(computeLineGst({ unitPrice: 12345, gstRate: 5, qtyMilli: 999_999, soldByWeight: true })).toEqual({
      lineTotal: 12_344_988,
      taxableValue: 11_757_131,
      cgst: 293_928,
      sgst: 293_929,
    });
  });

  it("is exact for the largest price and weight (no floating point)", () => {
    const price = 2_147_483_647; // integer column max
    expect(lineTotalPaise(price, 999_999)).toBe(reference(price, 999_999));
    expect(lineTotalPaise(price, 9_999_000)).toBe(price * 9999);
  });

  it("matches the BigInt reference (randomised)", () => {
    let seed = 20261115;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let run = 0; run < 20_000; run++) {
      const price = rand(2_000_000);
      const milli = 1 + rand(999_999);
      expect(lineTotalPaise(price, milli)).toBe(reference(price, milli));
    }
  });

  it("counts weighed lines as lines, not pieces", () => {
    const { totals } = computeInvoiceTotals([
      { unitPrice: 4500, gstRate: 18, qtyMilli: 2000 }, // 2 pieces
      { unitPrice: 7000, gstRate: 0, qtyMilli: 1500, soldByWeight: true }, // 1.5 kg
      { unitPrice: 7000, gstRate: 0, qtyMilli: 3000, soldByWeight: true }, // 3 kg, still not pieces
    ]);
    expect(totals).toMatchObject({ itemCount: 3, totalQty: 2, subtotal: 9000 + 10500 + 21000 });
  });

  it("refuses a decimal qty on a line that is not sold by weight", () => {
    expect(() => computeLineGst({ unitPrice: 100, gstRate: 0, qtyMilli: 250 })).toThrow(RangeError);
    expect(() => computeLineGst({ unitPrice: 100, gstRate: 0, qtyMilli: 250, soldByWeight: true })).not.toThrow();
  });
});
