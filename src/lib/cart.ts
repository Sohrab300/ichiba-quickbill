import { z } from "zod";
import { MAX_INVOICE_LINES, PAYMENT_METHODS, type PaymentMethod } from "./constants";
import { computeInvoiceTotals, type GstLineAmounts, type GstTotals } from "./gst";
import { formatQty, maxQtyMilli, qtyProblem, QTY_SCALE } from "./qty";

/**
 * The billing cart (REQUIREMENTS.md sections 6 and 8). Pure state + persistence helpers; the
 * React side lives in src/components/billing/useCart.ts. Safe to import from client components.
 *
 * Idempotency rules this module enforces:
 * - A cart gets its idempotency key when it is created; the key only changes when the cart is
 *   replaced by a new one (clear, completed sale, discard).
 * - Once a sale request has been sent (`pendingSale`), the cart cannot be edited until the
 *   outcome is known: re-sending the key returns whatever invoice the first request created, so
 *   an edited cart would silently get the old invoice back.
 */

export interface CartItem {
  productId: string;
  itemCode: string;
  name: string;
  /** Catalog (GST-inclusive) selling price per unit when it was last scanned, paise (preview only). */
  unitPrice: number;
  /**
   * Price for this bill only (REQUIREMENTS.md section 16), paise, GST-inclusive. Absent = the
   * catalog price. Always differs from unitPrice and is within 1..maxEditPrice(item); the
   * database re-checks it against the real catalog price and MRP.
   */
  editedPrice?: number;
  gstRate: number;
  /**
   * Integer thousandths (src/lib/qty.ts): 1000 = 1 piece or 1 kg. Always valid for the line:
   * 1..999999 when soldByWeight, else a multiple of 1000 up to 9,999 pieces.
   */
  qtyMilli: number;
  /** Loose fruit/vegetables priced per kg (products.sold_by_weight at scan time). */
  soldByWeight: boolean;
  /** Display only. */
  mrp: number | null;
  hsnCode: string | null;
}

export interface Cart {
  items: CartItem[];
  idempotencyKey: string;
  /** The method of the last sale attempt; re-used by "Check status" / retry. */
  paymentMethod: PaymentMethod | null;
  /**
   * A sale request with this key was sent and its outcome is not known yet (in flight, or the
   * answer was lost). The cart is locked while this is true.
   */
  pendingSale: boolean;
}

/** What a scan adds. Never carries an edited price, so a re-scan keeps the line's edit. */
export type CartProduct = Omit<CartItem, "qtyMilli" | "editedPrice">;

export type CartAction =
  | { type: "add"; product: CartProduct }
  /** Ignored unless qtyMilli is valid for the line (qtyProblem). */
  | { type: "setQty"; productId: string; qtyMilli: number }
  | { type: "increment"; productId: string }
  | { type: "decrement"; productId: string }
  | { type: "remove"; productId: string }
  /** Charge this price for the line on this bill; null = back to the catalog price. */
  | { type: "setPrice"; productId: string; price: number | null }
  /** Empty the cart and start a new one. Ignored while a sale is pending. */
  | { type: "clear"; nextKey: string }
  /** A completeSale request is about to be sent with this cart's key. */
  | { type: "saleSent"; paymentMethod: PaymentMethod }
  /** The server definitely did not create the invoice: unlock, keep items and key. */
  | { type: "saleRejected" }
  /** The invoice for `idempotencyKey` exists: start a new cart. */
  | { type: "saleCompleted"; idempotencyKey: string; nextKey: string }
  /** Throw away a pending cart (the sale may already exist) and start over. */
  | { type: "discard"; nextKey: string }
  /** Another tab of the same login changed the saved cart: adopt it as is. */
  | { type: "replace"; cart: Cart };

export function newCart(idempotencyKey: string): Cart {
  return { items: [], idempotencyKey, paymentMethod: null, pendingSale: false };
}

/**
 * Whether adding `product` again only points at its existing line instead of adding 1: true for
 * an item sold by weight that is already in the cart (REQUIREMENTS.md section 17 — the cashier
 * types the new weight; a second bag is not "1 kg more").
 */
export function isWeighedRescan(cart: Cart, product: Pick<CartProduct, "productId" | "soldByWeight">): boolean {
  return product.soldByWeight && cart.items.some((i) => i.productId === product.productId);
}

/** Why an "add" would be refused, or null if it is allowed. */
export function addBlockedReason(cart: Cart, product: Pick<CartProduct, "productId" | "soldByWeight">): string | null {
  if (cart.pendingSale) return "The cart is locked until the sale status is known.";
  const existing = cart.items.find((i) => i.productId === product.productId);
  if (existing) {
    // A re-scan of a normal item adds one more piece, like +; a weighed one changes no qty.
    if (isWeighedRescan(cart, product)) return null;
    return canIncrement(existing) ? null : `${existing.name}: quantity cannot go above ${maxQtyText(existing)}.`;
  }
  return cart.items.length >= MAX_INVOICE_LINES ? `A bill can have at most ${MAX_INVOICE_LINES} lines.` : null;
}

function maxQtyText(item: Pick<CartItem, "soldByWeight">): string {
  return item.soldByWeight ? `${formatQty(maxQtyMilli(true), true)} kg` : formatQty(maxQtyMilli(false), false);
}

/** + (and a re-scan) adds 1 piece / 1 kg. */
export function canIncrement(item: Pick<CartItem, "qtyMilli" | "soldByWeight">): boolean {
  return item.qtyMilli + QTY_SCALE <= maxQtyMilli(item.soldByWeight);
}

/** − takes off 1 piece / 1 kg, never down to 0 (0.250 kg stays; remove the line instead). */
export function canDecrement(item: Pick<CartItem, "qtyMilli">): boolean {
  return item.qtyMilli > QTY_SCALE;
}

/** The price this line is charged at, paise. */
export function chargedPrice(item: Pick<CartItem, "unitPrice" | "editedPrice">): number {
  return item.editedPrice ?? item.unitPrice;
}

/**
 * Highest price a line may be edited to: its MRP, or its catalog price when it has no MRP (then
 * the price can only be lowered). Same rule as create_invoice().
 */
export function maxEditPrice(item: Pick<CartItem, "unitPrice" | "mrp">): number {
  return item.mrp ?? item.unitPrice;
}

/** Why `price` (paise, or null if unreadable) can't be charged for this line, or null if it can. */
export function priceEditProblem(item: Pick<CartItem, "unitPrice" | "mrp">, price: number | null): string | null {
  if (price === null || !Number.isSafeInteger(price)) return "Enter a price in rupees, e.g. 42.50.";
  if (price <= 0) return "The price must be more than ₹0.";
  const max = maxEditPrice(item);
  if (price > max) {
    return item.mrp === null
      ? `No MRP is set, so the price can only be lowered (at most ${rupees(max)}).`
      : `The price can't be above the MRP ${rupees(max)}.`;
  }
  return null;
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/** The item with `price` charged (or the catalog price for null / the catalog price itself). */
function withPrice(item: CartItem, price: number | null): CartItem {
  if (price === null || price === item.unitPrice) {
    if (item.editedPrice === undefined) return item;
    const next = { ...item };
    delete next.editedPrice;
    return next;
  }
  if (priceEditProblem(item, price) !== null || price === item.editedPrice) return item;
  return { ...item, editedPrice: price };
}

/**
 * Lines and totals for the on-screen preview, on the charged prices (src/lib/gst.ts, the same
 * math as create_invoice()).
 */
export function previewCart(items: readonly CartItem[]): {
  lines: (CartItem & GstLineAmounts)[];
  totals: GstTotals;
} {
  const { lines, totals } = computeInvoiceTotals(items.map((item) => ({ ...item, unitPrice: chargedPrice(item) })));
  // Give each line back its catalog unitPrice; the amounts are on the charged price.
  return { lines: lines.map((line, i) => ({ ...line, unitPrice: items[i].unitPrice })), totals };
}

function mapItem(cart: Cart, productId: string, fn: (item: CartItem) => CartItem): Cart {
  let changed = false;
  const items = cart.items.map((item) => {
    if (item.productId !== productId) return item;
    const next = fn(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? { ...cart, items } : cart;
}

export function cartReducer(cart: Cart, action: CartAction): Cart {
  if (action.type === "replace") return action.cart;

  // Everything that edits the items is refused while the outcome of a sale is unknown.
  if (cart.pendingSale) {
    switch (action.type) {
      case "saleRejected":
        return { ...cart, pendingSale: false };
      case "saleCompleted":
        return action.idempotencyKey === cart.idempotencyKey ? newCart(action.nextKey) : cart;
      case "discard":
        return newCart(action.nextKey);
      default:
        return cart;
    }
  }

  switch (action.type) {
    case "add": {
      if (addBlockedReason(cart, action.product)) return cart;
      const { product } = action;
      const exists = cart.items.some((i) => i.productId === product.productId);
      if (exists) {
        // Same line; refresh name/price in case the catalog changed. A normal item gets one more
        // piece; a weighed item keeps its weight (the cashier types the new one). An edited
        // price stays (dropped only if it now equals the catalog price).
        return mapItem(cart, product.productId, (item) => {
          const qtyMilli = product.soldByWeight ? item.qtyMilli : item.qtyMilli + QTY_SCALE;
          const next: CartItem = { ...item, ...product, qtyMilli };
          // The product stopped/started being sold by weight since the line was added: a weight
          // that is not a whole number of pieces cannot stay, so the line starts again at 1.
          if (qtyProblem(next.qtyMilli, next.soldByWeight) !== null) next.qtyMilli = QTY_SCALE;
          return next.editedPrice === next.unitPrice ? withPrice(next, null) : next;
        });
      }
      // New lines go to the end: the invoice keeps first-scanned order.
      // Weighed items too: qty 1 (kg), then the cashier types the weight (REQUIREMENTS.md 17).
      return { ...cart, items: [...cart.items, { ...product, qtyMilli: QTY_SCALE }] };
    }
    case "setQty": {
      const { qtyMilli } = action;
      return mapItem(cart, action.productId, (item) =>
        item.qtyMilli === qtyMilli || qtyProblem(qtyMilli, item.soldByWeight) !== null ? item : { ...item, qtyMilli }
      );
    }
    case "increment":
      return mapItem(cart, action.productId, (item) =>
        canIncrement(item) ? { ...item, qtyMilli: item.qtyMilli + QTY_SCALE } : item
      );
    case "decrement":
      return mapItem(cart, action.productId, (item) =>
        canDecrement(item) ? { ...item, qtyMilli: item.qtyMilli - QTY_SCALE } : item
      );
    case "setPrice":
      return mapItem(cart, action.productId, (item) => withPrice(item, action.price));
    case "remove": {
      const items = cart.items.filter((i) => i.productId !== action.productId);
      return items.length === cart.items.length ? cart : { ...cart, items };
    }
    case "clear":
      return newCart(action.nextKey);
    case "saleSent":
      return cart.items.length === 0 ? cart : { ...cart, pendingSale: true, paymentMethod: action.paymentMethod };
    case "saleRejected":
      return cart;
    case "saleCompleted":
      // Only reachable if the cart was unlocked meanwhile; never drop a cart for another key.
      return action.idempotencyKey === cart.idempotencyKey ? newCart(action.nextKey) : cart;
    case "discard":
      return newCart(action.nextKey);
  }
}

/**
 * The payload completeSale() needs. Catalog prices are never sent (the server reads them itself);
 * unitPrice is sent only for a line whose price was edited on this bill. qty is text ("0.250",
 * "3"), never a float; the server parses it with the shared qty schema.
 */
export function toSaleItems(cart: Cart): { productId: string; qty: string; unitPrice?: number }[] {
  return cart.items.map((i) => {
    const qty = formatQty(i.qtyMilli, i.soldByWeight);
    return i.editedPrice === undefined
      ? { productId: i.productId, qty }
      : { productId: i.productId, qty, unitPrice: i.editedPrice };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Persistence (localStorage, one cart per signed-in user on this device)                      */
/* ------------------------------------------------------------------------------------------ */

const STORAGE_PREFIX = "ichiba-quickbill:cart:v1:";

export function cartStorageKey(userId: string): string {
  return STORAGE_PREFIX + userId;
}

/**
 * A saved line. qty is stored as integer thousandths (qtyMilli), never a float. A cart saved by
 * the app before weighed items existed has a whole-number `qty` and no soldByWeight; it is read
 * as qtyMilli = qty × 1000 of a normal item (a re-scan refreshes the flag), so a sale that was
 * pending across the update can still be checked with its key.
 */
const storedItemSchema = z
  .object({
    productId: z.string().min(1),
    itemCode: z.string(),
    name: z.string(),
    unitPrice: z.number().int().min(0),
    editedPrice: z.number().int().min(1).optional(),
    gstRate: z.number().int().min(0),
    qtyMilli: z.number().int().optional(),
    qty: z.number().int().min(1).optional(),
    soldByWeight: z.boolean().optional(),
    mrp: z.number().int().nullable().catch(null),
    hsnCode: z.string().nullable().catch(null),
  })
  .transform(({ qty, qtyMilli, soldByWeight, ...rest }, ctx): CartItem => {
    const milli = qtyMilli ?? (qty === undefined ? Number.NaN : qty * QTY_SCALE);
    const weighed = soldByWeight ?? false;
    if (qtyProblem(milli, weighed) !== null) {
      ctx.addIssue({ code: "custom", message: "Invalid quantity" });
      return z.NEVER;
    }
    return { ...rest, qtyMilli: milli, soldByWeight: weighed };
  });

const storedCartSchema = z.object({
  idempotencyKey: z.uuid(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  pendingSale: z.boolean(),
  items: z.array(storedItemSchema).max(MAX_INVOICE_LINES),
});

/** Parses a saved cart; null if it is missing or unusable. */
export function parseStoredCart(raw: string | null): Cart | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = storedCartSchema.safeParse(json);
  if (!parsed.success) return null;
  const cart = parsed.data;
  // A locked cart with no items cannot be checked; treat it as gone.
  if (cart.items.length === 0) return null;
  return cart;
}

/** Whether the cart is worth keeping on this device. */
export function shouldPersist(cart: Cart): boolean {
  return cart.items.length > 0 || cart.pendingSale;
}

export function loadCart(userId: string): Cart | null {
  try {
    return parseStoredCart(window.localStorage.getItem(cartStorageKey(userId)));
  } catch {
    return null; // storage disabled (private mode, policy)
  }
}

/** Saves the cart, or removes the saved copy when it is empty. Never throws. */
export function saveCart(userId: string, cart: Cart): void {
  try {
    const key = cartStorageKey(userId);
    if (shouldPersist(cart)) window.localStorage.setItem(key, JSON.stringify(cart));
    else window.localStorage.removeItem(key);
  } catch {
    // Quota or disabled storage: the cart still works, it just won't survive a reload.
  }
}

/** crypto.randomUUID() needs a secure context; phones on plain-http LAN dev servers lack it. */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
