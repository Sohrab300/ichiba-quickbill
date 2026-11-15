import { z } from "zod";
import { MAX_INVOICE_LINES, MAX_LINE_QTY, PAYMENT_METHODS, type PaymentMethod } from "./constants";
import { computeInvoiceTotals, type GstLineAmounts, type GstTotals } from "./gst";

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
  qty: number;
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
export type CartProduct = Omit<CartItem, "qty" | "editedPrice">;

export type CartAction =
  | { type: "add"; product: CartProduct }
  | { type: "setQty"; productId: string; qty: number }
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

/** Why an "add" would be refused, or null if it is allowed. */
export function addBlockedReason(cart: Cart, productId: string): string | null {
  if (cart.pendingSale) return "The cart is locked until the sale status is known.";
  const existing = cart.items.find((i) => i.productId === productId);
  if (existing) {
    return existing.qty >= MAX_LINE_QTY ? `Quantity cannot exceed ${MAX_LINE_QTY}.` : null;
  }
  return cart.items.length >= MAX_INVOICE_LINES ? `A bill can have at most ${MAX_INVOICE_LINES} lines.` : null;
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

function clampQty(qty: number): number {
  if (!Number.isFinite(qty)) return 1;
  return Math.min(MAX_LINE_QTY, Math.max(1, Math.trunc(qty)));
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
      if (addBlockedReason(cart, action.product.productId)) return cart;
      const { product } = action;
      const exists = cart.items.some((i) => i.productId === product.productId);
      if (exists) {
        // Same line, one more unit; refresh name/price in case the catalog changed. An edited
        // price stays (dropped only if it now equals the catalog price).
        return mapItem(cart, product.productId, (item) => {
          const next: CartItem = { ...item, ...product, qty: item.qty + 1 };
          return next.editedPrice === next.unitPrice ? withPrice(next, null) : next;
        });
      }
      // New lines go to the end: the invoice keeps first-scanned order.
      return { ...cart, items: [...cart.items, { ...product, qty: 1 }] };
    }
    case "setQty": {
      const qty = clampQty(action.qty);
      return mapItem(cart, action.productId, (item) => (item.qty === qty ? item : { ...item, qty }));
    }
    case "increment":
      return mapItem(cart, action.productId, (item) =>
        item.qty >= MAX_LINE_QTY ? item : { ...item, qty: item.qty + 1 }
      );
    case "decrement":
      return mapItem(cart, action.productId, (item) => (item.qty <= 1 ? item : { ...item, qty: item.qty - 1 }));
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
 * unitPrice is sent only for a line whose price was edited on this bill.
 */
export function toSaleItems(cart: Cart): { productId: string; qty: number; unitPrice?: number }[] {
  return cart.items.map((i) =>
    i.editedPrice === undefined
      ? { productId: i.productId, qty: i.qty }
      : { productId: i.productId, qty: i.qty, unitPrice: i.editedPrice }
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Persistence (localStorage, one cart per signed-in user on this device)                      */
/* ------------------------------------------------------------------------------------------ */

const STORAGE_PREFIX = "ichiba-quickbill:cart:v1:";

export function cartStorageKey(userId: string): string {
  return STORAGE_PREFIX + userId;
}

const storedCartSchema = z.object({
  idempotencyKey: z.uuid(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  pendingSale: z.boolean(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        itemCode: z.string(),
        name: z.string(),
        unitPrice: z.number().int().min(0),
        editedPrice: z.number().int().min(1).optional(),
        gstRate: z.number().int().min(0),
        qty: z.number().int().min(1).max(MAX_LINE_QTY),
        mrp: z.number().int().nullable().catch(null),
        hsnCode: z.string().nullable().catch(null),
      })
    )
    .max(MAX_INVOICE_LINES),
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
