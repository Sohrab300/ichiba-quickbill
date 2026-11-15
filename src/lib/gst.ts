/**
 * GST math for the on-screen cart preview (REQUIREMENTS.md section 3).
 *
 * The database is authoritative: create_invoice() (latest version in
 * supabase/migrations/20261115400000_sold_by_weight.sql) computes the real numbers, on the charged
 * price, and the printed invoice uses those. This is a line-for-line port so the preview matches;
 * keep the two in sync (scripts/db-tests/check-preview.ts and scripts/test-concurrency.ts check
 * invoices the database created against this function).
 *
 * All amounts are integer paise; quantities are integer thousandths (qtyMilli, 1000 = 1 piece or
 * 1 kg — src/lib/qty.ts). No floats anywhere. Selling prices are GST-inclusive.
 *   line_total = round(unit_price × qty), half up to the paisa  (= (2·price·qtyMilli + 1000) div 2000)
 *   taxable    = line_total × 100 / (100 + rate), rounded half-up to the paisa
 *   gst        = line_total − taxable;  CGST = floor(gst / 2);  SGST = gst − CGST
 *   grand      = subtotal rounded to the nearest rupee (50 paise rounds up); round_off = grand − subtotal
 */

export interface GstLineInput {
  /** GST-inclusive price per unit, paise. */
  unitPrice: number;
  /** Percent, e.g. 18. */
  gstRate: number;
  /** Thousandths: 1000 = 1 piece / 1 kg, 250 = 0.250 kg. */
  qtyMilli: number;
  /** Weighed lines count as lines, not pieces (REQUIREMENTS.md section 17). */
  soldByWeight?: boolean;
}

export interface GstLineAmounts {
  lineTotal: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
}

export interface GstTotals {
  /** Number of lines. */
  itemCount: number;
  /** Pieces: summed qty of the lines not sold by weight (invoices.total_qty). */
  totalQty: number;
  subtotal: number;
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  roundOff: number;
  grandTotal: number;
}

function assertInt(name: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer ≥ ${min} (got ${value})`);
  }
}

/** a / b rounded half-up, for non-negative integers, with exact integer arithmetic. */
function divRoundHalfUp(a: number, b: number): number {
  // Same formula as the SQL: (2a + b) div 2b.
  const num = 2 * a + b;
  const den = 2 * b;
  if (!Number.isSafeInteger(num)) throw new RangeError("Amount too large");
  return (num - (num % den)) / den;
}

/**
 * round(unitPrice × qtyMilli / 1000), half up, in exact integers: the whole kg/pieces part is an
 * exact product, and only the fraction (< 1000) is divided. Both stay far below 2^53 for any
 * price the database allows (integer paise) and qty up to 9,999.
 */
export function lineTotalPaise(unitPrice: number, qtyMilli: number): number {
  assertInt("unitPrice", unitPrice, 0);
  assertInt("qtyMilli", qtyMilli, 1);
  const whole = (qtyMilli - (qtyMilli % 1000)) / 1000;
  const frac = qtyMilli % 1000;
  const total = unitPrice * whole + divRoundHalfUp(unitPrice * frac, 1000);
  if (!Number.isSafeInteger(total)) throw new RangeError("Amount too large");
  return total;
}

export function computeLineGst({ unitPrice, gstRate, qtyMilli, soldByWeight = false }: GstLineInput): GstLineAmounts {
  assertInt("unitPrice", unitPrice, 0);
  assertInt("gstRate", gstRate, 0);
  assertInt("qtyMilli", qtyMilli, 1);
  if (!soldByWeight && qtyMilli % 1000 !== 0) {
    throw new RangeError(`qty must be a whole number for an item not sold by weight (got ${qtyMilli / 1000})`);
  }

  const lineTotal = lineTotalPaise(unitPrice, qtyMilli);
  if (!Number.isSafeInteger(lineTotal * 200)) throw new RangeError("Amount too large");
  const taxableValue = divRoundHalfUp(lineTotal * 100, 100 + gstRate);
  const gst = lineTotal - taxableValue;
  const cgst = Math.floor(gst / 2);
  return { lineTotal, taxableValue, cgst, sgst: gst - cgst };
}

/** Nearest rupee, 50 paise rounding up. */
export function roundToRupee(paise: number): { grandTotal: number; roundOff: number } {
  assertInt("paise", paise, 0);
  const grandTotal = Math.floor((paise + 50) / 100) * 100;
  return { grandTotal, roundOff: grandTotal - paise };
}

/**
 * Lines and totals for a cart. Lines are taken as given: the cart already merges repeated
 * products (the database merges duplicate product ids too, so per-line rounding matches).
 */
export function computeInvoiceTotals<T extends GstLineInput>(
  lines: readonly T[]
): { lines: (T & GstLineAmounts)[]; totals: GstTotals } {
  const computed = lines.map((line) => ({ ...line, ...computeLineGst(line) }));
  let totalQty = 0;
  let subtotal = 0;
  let taxableTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  for (const l of computed) {
    if (!l.soldByWeight) totalQty += l.qtyMilli / 1000; // whole, checked by computeLineGst
    subtotal += l.lineTotal;
    taxableTotal += l.taxableValue;
    cgstTotal += l.cgst;
    sgstTotal += l.sgst;
  }
  const { grandTotal, roundOff } = roundToRupee(subtotal);
  return {
    lines: computed,
    totals: {
      itemCount: computed.length,
      totalQty,
      subtotal,
      taxableTotal,
      cgstTotal,
      sgstTotal,
      roundOff,
      grandTotal,
    },
  };
}
