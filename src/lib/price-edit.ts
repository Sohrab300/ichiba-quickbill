import { chargedPrice, priceEditProblem, type CartItem } from "./cart";
import { parseRupeesToPaise } from "./format";

/**
 * Behaviour of the per-bill price edit popover (REQUIREMENTS.md section 16) that does not need
 * the DOM: what a press outside it does, and telling a barcode scanner apart from typing.
 * Safe to import from client components.
 */

type PriceItem = Pick<CartItem, "unitPrice" | "editedPrice" | "mrp">;

export type PriceEditMode = { kind: "edit" } | { kind: "confirm"; price: number };

/**
 * The price typed in the popover if saving it would change the line (valid and different from
 * the price it is charged at now), else null.
 */
export function pendingPriceChange(item: PriceItem, text: string): number | null {
  const price = parseRupeesToPaise(text);
  if (price === null || priceEditProblem(item, price) !== null) return null;
  return price === chargedPrice(item) ? null : price;
}

/**
 * A press outside the open popover. The press itself never reaches the page (the billing screen
 * swallows it), so nothing is paid, cleared or changed by it. Then:
 * - nothing worth saving was typed → close;
 * - a valid new price was typed → ask "Save new price ₹X?" first;
 * - already asking → keep asking until the cashier picks Save or Discard.
 */
export function outsidePress(
  mode: PriceEditMode,
  item: PriceItem,
  text: string
): { next: "close" } | { next: "confirm"; price: number } | { next: "stay" } {
  if (mode.kind === "confirm") return { next: "stay" };
  const price = pendingPriceChange(item, text);
  return price === null ? { next: "close" } : { next: "confirm", price };
}

/** Keyboard-wedge scanners type each character within a few ms; people need far longer. */
export const SCAN_KEY_GAP_MS = 35; // "~30 ms", with a little slack for event-loop jitter
/** Shortest code treated as a scan (product_barcodes allows 4–64 characters). */
export const SCAN_MIN_LENGTH = 4;

/** Keys that don't type a character but may sit inside a burst (Shift for capital letters). */
const NEUTRAL_KEYS = new Set(["Shift", "CapsLock"]);

/**
 * Spots a barcode scanner typing into a field that isn't the scan box: printable characters each
 * arriving within SCAN_KEY_GAP_MS of the previous one, ending with an equally quick Enter.
 * Feed it every keydown; it returns the scanned code on the Enter that ends a burst.
 */
export class ScanBurstDetector {
  private chars = "";
  private last = Number.NEGATIVE_INFINITY;

  key(key: string, timeMs: number, repeat = false): string | null {
    if (NEUTRAL_KEYS.has(key)) return null;
    const fast = timeMs - this.last <= SCAN_KEY_GAP_MS;
    this.last = timeMs;
    if (key === "Enter") {
      const code = fast && this.chars.length >= SCAN_MIN_LENGTH ? this.chars : null;
      this.chars = "";
      return code;
    }
    // A held key (auto-repeat) or any non-character key is a person, not a scanner.
    if (repeat || !/^[!-~]$/.test(key)) {
      this.chars = "";
      return null;
    }
    this.chars = fast && this.chars ? this.chars + key : key;
    return null;
  }
}
