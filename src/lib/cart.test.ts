import { describe, expect, it } from "vitest";
import {
  addBlockedReason,
  cartReducer,
  newCart,
  newIdempotencyKey,
  parseStoredCart,
  shouldPersist,
  toSaleItems,
  type Cart,
  type CartProduct,
} from "./cart";
import { MAX_LINE_QTY } from "./constants";

const KEY = "11111111-1111-4111-8111-111111111111";
const NEXT = "22222222-2222-4222-8222-222222222222";

const soap: CartProduct = {
  productId: "aaaaaaaa-0000-4000-8000-000000000001",
  itemCode: "1000001",
  name: "Soap",
  unitPrice: 4500,
  gstRate: 18,
  mrp: 5000,
  hsnCode: "3401",
};
const oil: CartProduct = { ...soap, productId: "aaaaaaaa-0000-4000-8000-000000000002", itemCode: "1000002", name: "Oil" };

function cartWith(...products: CartProduct[]): Cart {
  return products.reduce((c, product) => cartReducer(c, { type: "add", product }), newCart(KEY));
}

describe("cartReducer", () => {
  it("adds new lines at the end and merges repeats", () => {
    const cart = cartWith(soap, oil, soap);
    expect(cart.items.map((i) => [i.name, i.qty])).toEqual([
      ["Soap", 2],
      ["Oil", 1],
    ]);
    expect(cart.idempotencyKey).toBe(KEY);
  });

  it("refreshes the price when a product is scanned again", () => {
    const cart = cartReducer(cartWith(soap), { type: "add", product: { ...soap, unitPrice: 4700 } });
    expect(cart.items[0]).toMatchObject({ unitPrice: 4700, qty: 2 });
  });

  it("clamps quantities to 1..MAX_LINE_QTY and never removes on decrement", () => {
    let cart = cartWith(soap);
    cart = cartReducer(cart, { type: "decrement", productId: soap.productId });
    expect(cart.items[0].qty).toBe(1);
    cart = cartReducer(cart, { type: "setQty", productId: soap.productId, qty: 0 });
    expect(cart.items[0].qty).toBe(1);
    cart = cartReducer(cart, { type: "setQty", productId: soap.productId, qty: 1e9 });
    expect(cart.items[0].qty).toBe(MAX_LINE_QTY);
    expect(cartReducer(cart, { type: "increment", productId: soap.productId })).toBe(cart);
    expect(addBlockedReason(cart, soap.productId)).toMatch(/cannot exceed/);
  });

  it("gives a cleared cart a new key", () => {
    const cart = cartReducer(cartWith(soap), { type: "clear", nextKey: NEXT });
    expect(cart).toEqual(newCart(NEXT));
  });

  it("locks the cart while a sale is pending", () => {
    const sent = cartReducer(cartWith(soap), { type: "saleSent", paymentMethod: "upi" });
    expect(sent).toMatchObject({ pendingSale: true, paymentMethod: "upi", idempotencyKey: KEY });
    for (const action of [
      { type: "add", product: oil },
      { type: "increment", productId: soap.productId },
      { type: "setQty", productId: soap.productId, qty: 5 },
      { type: "remove", productId: soap.productId },
      { type: "clear", nextKey: NEXT },
    ] as const) {
      expect(cartReducer(sent, action)).toBe(sent);
    }
    expect(addBlockedReason(sent, oil.productId)).toMatch(/locked/);
  });

  it("keeps items and key after a definite failure", () => {
    const sent = cartReducer(cartWith(soap), { type: "saleSent", paymentMethod: "cash" });
    const rejected = cartReducer(sent, { type: "saleRejected" });
    expect(rejected).toMatchObject({ pendingSale: false, idempotencyKey: KEY, paymentMethod: "cash" });
    expect(rejected.items).toEqual(sent.items);
  });

  it("starts a new cart only when the completed invoice matches the key", () => {
    const sent = cartReducer(cartWith(soap), { type: "saleSent", paymentMethod: "card" });
    expect(cartReducer(sent, { type: "saleCompleted", idempotencyKey: NEXT, nextKey: NEXT })).toBe(sent);
    expect(cartReducer(sent, { type: "saleCompleted", idempotencyKey: KEY, nextKey: NEXT })).toEqual(newCart(NEXT));
  });

  it("can discard a pending cart", () => {
    const sent = cartReducer(cartWith(soap), { type: "saleSent", paymentMethod: "card" });
    expect(cartReducer(sent, { type: "discard", nextKey: NEXT })).toEqual(newCart(NEXT));
  });

  it("adopts a cart from another tab even while locked", () => {
    const sent = cartReducer(cartWith(soap), { type: "saleSent", paymentMethod: "card" });
    const other = cartWith(oil);
    expect(cartReducer(sent, { type: "replace", cart: other })).toBe(other);
  });

  it("does not send an empty cart", () => {
    const empty = newCart(KEY);
    expect(cartReducer(empty, { type: "saleSent", paymentMethod: "cash" })).toBe(empty);
  });

  it("sends only product ids and quantities", () => {
    expect(toSaleItems(cartWith(soap, soap, oil))).toEqual([
      { productId: soap.productId, qty: 2 },
      { productId: oil.productId, qty: 1 },
    ]);
  });
});

describe("persistence", () => {
  it("round-trips a cart through JSON", () => {
    const cart = cartReducer(cartWith(soap, oil), { type: "saleSent", paymentMethod: "upi" });
    expect(parseStoredCart(JSON.stringify(cart))).toEqual(cart);
  });

  it("rejects junk", () => {
    expect(parseStoredCart(null)).toBeNull();
    expect(parseStoredCart("{")).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cartWith(soap), idempotencyKey: "nope" }))).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cartWith(soap), items: [{ ...soap, qty: 0 }] }))).toBeNull();
    expect(parseStoredCart(JSON.stringify(newCart(KEY)))).toBeNull();
  });

  it("only keeps carts that hold something", () => {
    expect(shouldPersist(newCart(KEY))).toBe(false);
    expect(shouldPersist(cartWith(soap))).toBe(true);
  });

  it("generates v4 UUIDs", () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
