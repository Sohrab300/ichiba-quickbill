import { describe, expect, it } from "vitest";
import {
  addBlockedReason,
  cartReducer,
  chargedPrice,
  maxEditPrice,
  newCart,
  newIdempotencyKey,
  parseStoredCart,
  previewCart,
  priceEditProblem,
  shouldPersist,
  toSaleItems,
  type Cart,
  type CartAction,
  type CartProduct,
} from "./cart";
import { MAX_LINE_QTY } from "./constants";
import { computeLineGst } from "./gst";

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
const noMrp: CartProduct = { ...soap, productId: "aaaaaaaa-0000-4000-8000-000000000003", itemCode: "1000003", name: "Loose", mrp: null };

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

  it("ignores a second Complete press while the first is pending (same key, same method)", () => {
    const first = cartReducer(cartWith(soap), { type: "saleSent", paymentMethod: "cash" });
    expect(cartReducer(first, { type: "saleSent", paymentMethod: "upi" })).toBe(first);
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

describe("price edit (one bill only)", () => {
  const setPrice = (productId: string, price: number | null): CartAction => ({ type: "setPrice", productId, price });

  it("charges the edited price for the whole line and keeps the catalog price", () => {
    const cart = cartReducer(cartWith(soap, soap, oil), setPrice(soap.productId, 4000));
    expect(cart.items[0]).toMatchObject({ unitPrice: 4500, editedPrice: 4000, qty: 2 });
    expect(chargedPrice(cart.items[0])).toBe(4000);
    expect(cart.items[1].editedPrice).toBeUndefined();
    expect(chargedPrice(cart.items[1])).toBe(4500);
  });

  it("refuses prices <= 0, above MRP, or not whole paise (the line is unchanged)", () => {
    const cart = cartWith(soap);
    for (const price of [0, -1, 5001, 4000.5, Number.NaN]) {
      expect(cartReducer(cart, setPrice(soap.productId, price))).toBe(cart);
    }
    expect(cartReducer(cart, setPrice(soap.productId, 5000)).items[0].editedPrice).toBe(5000); // = MRP is fine
    expect(cartReducer(cart, setPrice(soap.productId, 1)).items[0].editedPrice).toBe(1); // no maximum discount
  });

  it("without an MRP, only allows lowering the price", () => {
    const cart = cartWith(noMrp);
    expect(maxEditPrice(cart.items[0])).toBe(4500);
    expect(cartReducer(cart, setPrice(noMrp.productId, 4501))).toBe(cart);
    expect(cartReducer(cart, setPrice(noMrp.productId, 4499)).items[0].editedPrice).toBe(4499);
  });

  it("explains why a price can't be saved", () => {
    const [item] = cartWith(soap).items;
    expect(priceEditProblem(item, null)).toMatch(/Enter a price/);
    expect(priceEditProblem(item, 0)).toMatch(/more than ₹0/);
    expect(priceEditProblem(item, 5001)).toMatch(/above the MRP ₹50\.00/);
    expect(priceEditProblem(cartWith(noMrp).items[0], 4501)).toMatch(/only be lowered/);
    expect(priceEditProblem(item, 4999)).toBeNull();
  });

  it("reset (null) or the catalog price itself clears the edit", () => {
    const edited = cartReducer(cartWith(soap), setPrice(soap.productId, 4000));
    for (const price of [null, 4500]) {
      const reset = cartReducer(edited, setPrice(soap.productId, price));
      expect(reset.items[0]).not.toHaveProperty("editedPrice");
      expect(chargedPrice(reset.items[0])).toBe(4500);
    }
    const plain = cartWith(soap);
    expect(cartReducer(plain, setPrice(soap.productId, null))).toBe(plain);
  });

  it("keeps the edit when the product is scanned again, and drops it with the line", () => {
    let cart = cartReducer(cartWith(soap), setPrice(soap.productId, 4000));
    cart = cartReducer(cart, { type: "add", product: soap });
    expect(cart.items[0]).toMatchObject({ qty: 2, editedPrice: 4000 });
    // Catalog price changed to the edited price: no longer an edit.
    expect(cartReducer(cart, { type: "add", product: { ...soap, unitPrice: 4000 } }).items[0]).not.toHaveProperty("editedPrice");
    cart = cartReducer(cart, { type: "remove", productId: soap.productId });
    cart = cartReducer(cart, { type: "add", product: soap });
    expect(cart.items[0]).not.toHaveProperty("editedPrice");
  });

  it("is blocked while a sale is pending", () => {
    const sent = cartReducer(cartWith(soap), { type: "saleSent", paymentMethod: "cash" });
    expect(cartReducer(sent, setPrice(soap.productId, 4000))).toBe(sent);
  });

  it("sends unitPrice only for edited lines", () => {
    const cart = cartReducer(cartWith(soap, oil, oil), setPrice(oil.productId, 3999));
    expect(toSaleItems(cart)).toEqual([
      { productId: soap.productId, qty: 1 },
      { productId: oil.productId, qty: 2, unitPrice: 3999 },
    ]);
  });

  it("previews amounts and GST on the charged price", () => {
    // 3 × ₹40.00 at 18%: 12000 = 10169 taxable + 915 CGST + 916 SGST (same as the DB test).
    const cart = cartReducer(cartWith(soap, soap, soap, oil), setPrice(soap.productId, 4000));
    const { lines, totals } = previewCart(cart.items);
    expect(lines[0]).toMatchObject({ unitPrice: 4500, editedPrice: 4000, lineTotal: 12000, taxableValue: 10169, cgst: 915, sgst: 916 });
    expect(lines[1]).toMatchObject({ unitPrice: 4500, lineTotal: 4500 });
    expect(lines[1]).toMatchObject(computeLineGst({ unitPrice: 4500, gstRate: 18, qty: 1 }));
    expect(totals).toMatchObject({ itemCount: 2, totalQty: 4, subtotal: 16500, grandTotal: 16500, roundOff: 0 });

    const odd = previewCart(cartReducer(cartWith(soap), setPrice(soap.productId, 4333)).items);
    expect(odd.totals).toMatchObject({ subtotal: 4333, grandTotal: 4300, roundOff: -33 });
  });
});

describe("persistence", () => {
  it("round-trips a cart through JSON", () => {
    const cart = cartReducer(cartWith(soap, oil), { type: "saleSent", paymentMethod: "upi" });
    expect(parseStoredCart(JSON.stringify(cart))).toEqual(cart);
  });

  it("keeps an edited price through a reload, also while the sale is pending", () => {
    let cart = cartReducer(cartWith(soap, oil), { type: "setPrice", productId: oil.productId, price: 4100 });
    cart = cartReducer(cart, { type: "saleSent", paymentMethod: "cash" });
    const restored = parseStoredCart(JSON.stringify(cart));
    expect(restored).toEqual(cart);
    expect(toSaleItems(restored!)).toEqual(toSaleItems(cart));
  });

  it("reads carts saved before price edits existed", () => {
    const old = { ...cartWith(soap) };
    expect(parseStoredCart(JSON.stringify(old))?.items[0]).not.toHaveProperty("editedPrice");
  });

  it("rejects junk", () => {
    expect(parseStoredCart(null)).toBeNull();
    expect(parseStoredCart("{")).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cartWith(soap), idempotencyKey: "nope" }))).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cartWith(soap), items: [{ ...soap, qty: 0 }] }))).toBeNull();
    expect(parseStoredCart(JSON.stringify(newCart(KEY)))).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cartWith(soap), items: [{ ...soap, qty: 1, editedPrice: 0 }] }))).toBeNull();
  });

  it("only keeps carts that hold something", () => {
    expect(shouldPersist(newCart(KEY))).toBe(false);
    expect(shouldPersist(cartWith(soap))).toBe(true);
  });

  it("generates v4 UUIDs", () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
