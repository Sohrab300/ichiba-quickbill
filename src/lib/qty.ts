import { z } from "zod";
import { MAX_LINE_QTY } from "./constants";

/**
 * Quantities on a bill (REQUIREMENTS.md sections 13 and 17). Safe to import from client components.
 *
 * Every quantity is held as an integer number of thousandths ("qtyMilli"): 1000 = 1 piece or
 * 1 kg, 250 = 0.250 kg. Floats are never used for quantity maths; a JSON number is produced only
 * at the very edge, for create_invoice() (see qtyMilliToJson).
 *
 * - Products sold by weight (loose fruit & vegetables): kg with up to 3 decimals, 0.001–999.999.
 * - Everything else: whole numbers 1–9,999.
 * create_invoice() enforces the same rules in the database.
 */

export const QTY_SCALE = 1000;
/** 999.999 kg. */
export const MAX_WEIGHT_MILLI = 999_999;
/** 9,999 pieces. */
export const MAX_PIECES_MILLI = MAX_LINE_QTY * QTY_SCALE;
/** The largest quantity of any kind (the shape check, before the product is known). */
export const MAX_QTY_MILLI = MAX_PIECES_MILLI;

export type QtyResult = { ok: true; qtyMilli: number } | { ok: false; error: string };

const QTY_TEXT = /^(\d*)(?:\.(\d*))?$/;

/**
 * Reads typed text such as "2", "0.250", ".250", "2.5" or "2." into thousandths. Only the shape
 * is checked here (digits, at most 3 decimals, more than 0, at most MAX_QTY_MILLI); whether
 * decimals are allowed depends on the product (qtyProblem).
 */
export function parseQtyMilli(text: string): QtyResult {
  const s = text.trim();
  if (s === "" || s === ".") return { ok: false, error: "Enter a quantity." };
  const m = QTY_TEXT.exec(s);
  if (!m) return { ok: false, error: "Numbers only, e.g. 2 or 0.250." };
  const whole = m[1];
  const frac = m[2] ?? "";
  if (frac.length > 3) return { ok: false, error: "At most 3 decimals (0.001 kg = 1 g)." };
  // Leading zeros are fine ("0007"); more than 4 significant digits is over every limit anyway.
  const wholeDigits = whole.replace(/^0+/, "");
  if (wholeDigits.length > 4) return { ok: false, error: `Quantity cannot exceed ${MAX_LINE_QTY.toLocaleString("en-IN")}.` };
  const qtyMilli = Number(wholeDigits || "0") * QTY_SCALE + Number(frac.padEnd(3, "0"));
  if (qtyMilli === 0) return { ok: false, error: "Quantity must be more than 0." };
  if (qtyMilli > MAX_QTY_MILLI) return { ok: false, error: `Quantity cannot exceed ${MAX_LINE_QTY.toLocaleString("en-IN")}.` };
  return { ok: true, qtyMilli };
}

/** Why `qtyMilli` is not allowed for this kind of product, or null if it is. */
export function qtyProblem(qtyMilli: number, soldByWeight: boolean): string | null {
  if (!Number.isSafeInteger(qtyMilli)) return "Enter a quantity.";
  if (soldByWeight) {
    return qtyMilli >= 1 && qtyMilli <= MAX_WEIGHT_MILLI ? null : "Weight must be 0.001–999.999 kg.";
  }
  if (qtyMilli % QTY_SCALE !== 0) return "Whole numbers only — this item isn't sold by weight.";
  return qtyMilli >= QTY_SCALE && qtyMilli <= MAX_PIECES_MILLI
    ? null
    : `Quantity must be 1–${MAX_LINE_QTY.toLocaleString("en-IN")}.`;
}

/** Typed text for a line: shape and the product's rule. */
export function parseQty(text: string, soldByWeight: boolean): QtyResult {
  const parsed = parseQtyMilli(text);
  if (!parsed.ok) {
    // A decimal typed on a normal item says why, rather than "at most 3 decimals".
    if (!soldByWeight && /^\d*\.\d*[1-9]/.test(text.trim())) {
      return { ok: false, error: "Whole numbers only — this item isn't sold by weight." };
    }
    return parsed;
  }
  const problem = qtyProblem(parsed.qtyMilli, soldByWeight);
  return problem === null ? parsed : { ok: false, error: problem };
}

/** "3 lines · 5 pcs" — weighed lines count as lines, their kg are not pieces. */
export function formatLinesAndPieces(lines: number, pieces: number): string {
  return `${lines} ${lines === 1 ? "line" : "lines"} · ${pieces} ${pieces === 1 ? "pc" : "pcs"}`;
}

/** Largest quantity a line may have, thousandths. */
export function maxQtyMilli(soldByWeight: boolean): number {
  return soldByWeight ? MAX_WEIGHT_MILLI : MAX_PIECES_MILLI;
}

/** "0.250" for weighed lines (always 3 decimals), "3" for pieces. */
export function formatQty(qtyMilli: number, soldByWeight: boolean): string {
  const whole = Math.trunc(qtyMilli / QTY_SCALE);
  const frac = qtyMilli % QTY_SCALE;
  if (soldByWeight) return `${whole}.${String(frac).padStart(3, "0")}`;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}`;
}

/** "0.250 kg" for weighed lines, "3" for pieces. */
export function formatQtyWithUnit(qtyMilli: number, soldByWeight: boolean): string {
  return soldByWeight ? `${formatQty(qtyMilli, true)} kg` : formatQty(qtyMilli, false);
}

/**
 * A quantity the database returned (a JSON number such as 0.25 or 2) in thousandths, or null if
 * it is not a whole number of thousandths. JSON.parse already turned "0.250" into the nearest
 * double; ×1000 is within far less than 0.5 of the exact integer for every value up to 10^7.
 */
export function qtyMilliFromNumber(qty: number): number | null {
  if (!Number.isFinite(qty)) return null;
  const milli = Math.round(qty * QTY_SCALE);
  return Math.abs(qty * QTY_SCALE - milli) < 1e-6 && Number.isSafeInteger(milli) ? milli : null;
}

/**
 * Qty and Unit cells of the lines CSV for a quantity the database returned: Qty stays a plain
 * number so a spreadsheet can sum it ("0.250" for weighed lines, "2" otherwise), Unit is "kg" or
 * "pcs" (REQUIREMENTS.md section 17, docs/EXPORTS.md).
 */
export function exportQtyCells(qty: number, soldByWeight: boolean): { qty: string; unit: "kg" | "pcs" } {
  const milli = qtyMilliFromNumber(qty);
  if (milli === null) throw new Error(`Unreadable quantity ${qty}`);
  return { qty: formatQty(milli, soldByWeight), unit: soldByWeight ? "kg" : "pcs" };
}

/**
 * The JSON number create_invoice() receives. For any integer n, n / 1000 is the double nearest to
 * the decimal n/1000, and JSON.stringify prints the shortest text that reads back as that double,
 * which is exactly that decimal ("0.25", "2", "999.999"); qty.test.ts checks every value.
 */
export function qtyMilliToJson(qtyMilli: number): number {
  return qtyMilli / QTY_SCALE;
}

/**
 * A quantity sent to the completeSale() Server Action: text as typed ("0.250", ".250", "2") or a
 * whole number. Parsed to thousandths with the shape rules only — create_invoice() decides per
 * product whether decimals are allowed.
 */
export const saleQtySchema = z
  .union([z.string().max(32), z.number().int('A decimal quantity must be sent as text, e.g. "0.250".')], {
    error: "Quantity is required.",
  })
  .transform((value, ctx) => {
    const parsed = parseQtyMilli(String(value));
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.error });
      return z.NEVER;
    }
    return parsed.qtyMilli;
  });
