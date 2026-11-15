import { describe, expect, it } from "vitest";
import {
  addBlockedReason,
  canDecrement,
  canIncrement,
  cartReducer,
  isWeighedRescan,
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
import { computeLineGst } from "./gst";
import { MAX_PIECES_MILLI, MAX_WEIGHT_MILLI } from "./qty";

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
  soldByWeight: false,
};
const oil: CartProduct = { ...soap, productId: "aaaaaaaa-0000-4000-8000-000000000002", itemCode: "1000002", name: "Oil" };
const noMrp: CartProduct = { ...soap, productId: "aaaaaaaa-0000-4000-8000-000000000003", itemCode: "1000003", name: "Loose", mrp: null };
/** ₹70.00 per kg, sold by weight. */
const tomato: CartProduct = {
  ...soap,
  productId: "aaaaaaaa-0000-4000-8000-000000000004",
  itemCode: "7011708",
  name: "TOMATO P/KG",
  unitPrice: 7000,
  gstRate: 0,
  mrp: null,
  hsnCode: "0702",
  soldByWeight: true,
};

function cartWith(...products: CartProduct[]): Cart {
  return products.reduce((c, product) => cartReducer(c, { type: "add", product }), newCart(KEY));
}

describe("cartReducer", () => {
  it("adds new lines at the end and merges repeats", () => {
    const cart = cartWith(soap, oil, soap);
    expect(cart.items.map((i) => [i.name, i.qtyMilli])).toEqual([
      ["Soap", 2000],
      ["Oil", 1000],
    ]);
    expect(cart.idempotencyKey).toBe(KEY);
  });

  it("refreshes the price when a product is scanned again", () => {
    const cart = cartReducer(cartWith(soap), { type: "add", product: { ...soap, unitPrice: 4700 } });
    expect(cart.items[0]).toMatchObject({ unitPrice: 4700, qtyMilli: 2000 });
  });

  it("keeps quantities within 0.001..9,999, ignores invalid ones and never removes on decrement", () => {
    let cart = cartWith(soap);
    cart = cartReducer(cart, { type: "decrement", productId: soap.productId });
    expect(cart.items[0].qtyMilli).toBe(1000);
    for (const qtyMilli of [0, -1000, -500, MAX_PIECES_MILLI + 1, 1e12, Number.NaN, 2.5]) {
      expect(cartReducer(cart, { type: "setQty", productId: soap.productId, qtyMilli })).toBe(cart);
    }
    cart = cartReducer(cart, { type: "setQty", productId: soap.productId, qtyMilli: MAX_PIECES_MILLI });
    expect(cart.items[0].qtyMilli).toBe(MAX_PIECES_MILLI);
    expect(cartReducer(cart, { type: "increment", productId: soap.productId })).toBe(cart);
    expect(addBlockedReason(cart, soap)).toMatch(/cannot go above 9999/);
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
      { type: "setQty", productId: soap.productId, qtyMilli: 5000 },
      { type: "remove", productId: soap.productId },
      { type: "clear", nextKey: NEXT },
    ] as const) {
      expect(cartReducer(sent, action)).toBe(sent);
    }
    expect(addBlockedReason(sent, oil)).toMatch(/locked/);
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

  it("sends only product ids and quantities (as text, never floats)", () => {
    expect(toSaleItems(cartWith(soap, soap, oil))).toEqual([
      { productId: soap.productId, qty: "2" },
      { productId: oil.productId, qty: "1" },
    ]);
  });
});

describe("sold by weight", () => {
  it("adds a weighed item with qty 1 (kg) like any item; the weight is then typed", () => {
    let cart = cartWith(tomato);
    expect(cart.items[0]).toMatchObject({ qtyMilli: 1000, soldByWeight: true });
    cart = cartReducer(cart, { type: "setQty", productId: tomato.productId, qtyMilli: 250 });
    expect(cart.items[0].qtyMilli).toBe(250);
    const { lines, totals } = previewCart(cart.items);
    expect(lines[0].lineTotal).toBe(1750); // 0.250 kg × ₹70.00
    expect(totals).toMatchObject({ itemCount: 1, totalQtyMilli: 0, subtotal: 1750, grandTotal: 1800 });
    expect(toSaleItems(cart)).toEqual([{ productId: tomato.productId, qty: "0.250" }]);
  });

  it("refuses weights out of range (a normal item may go above 999.999)", () => {
    const cart = cartWith(soap, tomato);
    expect(cartReducer(cart, { type: "setQty", productId: soap.productId, qtyMilli: 1_000_000 }).items[0].qtyMilli).toBe(
      1_000_000
    );
    expect(cartReducer(cart, { type: "setQty", productId: tomato.productId, qtyMilli: 0 })).toBe(cart);
    expect(cartReducer(cart, { type: "setQty", productId: tomato.productId, qtyMilli: MAX_WEIGHT_MILLI + 1 })).toBe(cart);
    expect(cartReducer(cart, { type: "setQty", productId: tomato.productId, qtyMilli: MAX_WEIGHT_MILLI }).items[1].qtyMilli).toBe(
      MAX_WEIGHT_MILLI
    );
  });

  it("+/− step 1 kg; − never goes to 0 or below", () => {
    let cart = cartReducer(cartWith(tomato), { type: "setQty", productId: tomato.productId, qtyMilli: 1250 });
    cart = cartReducer(cart, { type: "increment", productId: tomato.productId });
    expect(cart.items[0].qtyMilli).toBe(2250);
    cart = cartReducer(cart, { type: "decrement", productId: tomato.productId });
    cart = cartReducer(cart, { type: "decrement", productId: tomato.productId });
    expect(cart.items[0].qtyMilli).toBe(250);
    expect(cartReducer(cart, { type: "decrement", productId: tomato.productId })).toBe(cart);
    const full = cartReducer(cart, { type: "setQty", productId: tomato.productId, qtyMilli: 999_500 });
    expect(cartReducer(full, { type: "increment", productId: tomato.productId })).toBe(full);
    // A re-scan never adds weight, so it is never blocked by the maximum.
    expect(addBlockedReason(full, tomato)).toBeNull();
  });

  it("a re-scan of a weighed item keeps its weight (no +1 kg) and refreshes the price", () => {
    let cart = cartReducer(cartWith(soap, tomato), { type: "setQty", productId: tomato.productId, qtyMilli: 250 });
    expect(isWeighedRescan(cart, tomato)).toBe(true);
    expect(isWeighedRescan(cart, soap)).toBe(false);
    cart = cartReducer(cart, { type: "add", product: { ...tomato, unitPrice: 7200 } });
    expect(cart.items[1]).toMatchObject({ qtyMilli: 250, unitPrice: 7200 });
    expect(cart.items).toHaveLength(2);
    // Normal items still add 1.
    cart = cartReducer(cart, { type: "add", product: soap });
    expect(cart.items[0].qtyMilli).toBe(2000);
    // An edited per-kg price survives the re-scan.
    cart = cartReducer(cart, { type: "setPrice", productId: tomato.productId, price: 6000 });
    cart = cartReducer(cart, { type: "add", product: tomato });
    expect(cart.items[1]).toMatchObject({ qtyMilli: 250, editedPrice: 6000 });
  });

  it("a line whose product stopped being weighed restarts at 1; one that became weighed keeps its qty", () => {
    let cart = cartReducer(cartWith(tomato), { type: "setQty", productId: tomato.productId, qtyMilli: 1250 });
    cart = cartReducer(cart, { type: "add", product: { ...tomato, soldByWeight: false } });
    expect(cart.items[0]).toMatchObject({ qtyMilli: 1000, soldByWeight: false });
    const pieces = cartWith(soap, soap, soap);
    expect(cartReducer(pieces, { type: "add", product: { ...soap, soldByWeight: true } }).items[0]).toMatchObject({
      qtyMilli: 3000,
      soldByWeight: true,
    });
    // ...unless that is over the kg maximum.
    const many = cartReducer(cartWith(soap), { type: "setQty", productId: soap.productId, qtyMilli: 1_500_000 });
    expect(cartReducer(many, { type: "add", product: { ...soap, soldByWeight: true } }).items[0].qtyMilli).toBe(1000);
  });

  it("counts weighed lines as lines, not pieces; price edit is per kg", () => {
    let cart = cartWith(soap, soap, tomato);
    cart = cartReducer(cart, { type: "setQty", productId: tomato.productId, qtyMilli: 1500 });
    cart = cartReducer(cart, { type: "setPrice", productId: tomato.productId, price: 6000 });
    const { lines, totals } = previewCart(cart.items);
    expect(lines[1]).toMatchObject({ unitPrice: 7000, editedPrice: 6000, lineTotal: 9000 });
    expect(totals).toMatchObject({ itemCount: 2, totalQtyMilli: 2000, subtotal: 18000 });
    expect(toSaleItems(cart)).toEqual([
      { productId: soap.productId, qty: "2" },
      { productId: tomato.productId, qty: "1.500", unitPrice: 6000 },
    ]);
  });

  it("saves qty as thousandths and restores it", () => {
    const cart = cartReducer(cartWith(soap, tomato), { type: "setQty", productId: tomato.productId, qtyMilli: 250 });
    const json = JSON.parse(JSON.stringify(cart)) as { items: Record<string, unknown>[] };
    expect(json.items[1]).toMatchObject({ qtyMilli: 250, soldByWeight: true });
    expect(json.items[1]).not.toHaveProperty("qty");
    expect(parseStoredCart(JSON.stringify(cart))).toEqual(cart);
  });

  it("refuses a saved cart with a qty its line can't have", () => {
    const cart = cartWith(soap, tomato);
    const bad = (item: Record<string, unknown>) => JSON.stringify({ ...cart, items: [item] });
    expect(parseStoredCart(bad({ ...cart.items[0], qtyMilli: 0 }))).toBeNull();
    expect(parseStoredCart(bad({ ...cart.items[0], qtyMilli: MAX_PIECES_MILLI + 1 }))).toBeNull();
    expect(parseStoredCart(bad({ ...cart.items[1], qtyMilli: 0.25 }))).toBeNull(); // a float
    expect(parseStoredCart(bad({ ...cart.items[1], qtyMilli: 1_000_000 }))).toBeNull();
  });
});

describe("decimal qty on normal items (REQUIREMENTS.md section 17)", () => {
  it("0.5 pcs bills half the price; it is not a weighed line", () => {
    let cart = cartReducer(cartWith(soap), { type: "setQty", productId: soap.productId, qtyMilli: 500 });
    expect(cart.items[0]).toMatchObject({ qtyMilli: 500, soldByWeight: false });
    const { lines, totals } = previewCart(cart.items);
    expect(lines[0].lineTotal).toBe(2250); // 0.5 × ₹45.00
    expect(totals).toMatchObject({ itemCount: 1, totalQtyMilli: 500, subtotal: 2250 });
    expect(toSaleItems(cart)).toEqual([{ productId: soap.productId, qty: "0.5" }]);
    cart = cartReducer(cart, { type: "setQty", productId: soap.productId, qtyMilli: 2750 });
    expect(toSaleItems(cart)).toEqual([{ productId: soap.productId, qty: "2.75" }]);
    for (const qtyMilli of [1, MAX_PIECES_MILLI]) {
      expect(cartReducer(cart, { type: "setQty", productId: soap.productId, qtyMilli }).items[0].qtyMilli).toBe(qtyMilli);
    }
  });

  it("a re-scan still adds 1 piece (0.5 -> 1.5), never past 9,999", () => {
    let cart = cartReducer(cartWith(soap), { type: "setQty", productId: soap.productId, qtyMilli: 500 });
    expect(isWeighedRescan(cart, soap)).toBe(false);
    cart = cartReducer(cart, { type: "add", product: soap });
    expect(cart.items[0].qtyMilli).toBe(1500);
    const nearFull = cartReducer(cart, { type: "setQty", productId: soap.productId, qtyMilli: MAX_PIECES_MILLI - 500 });
    expect(addBlockedReason(nearFull, soap)).toMatch(/cannot go above 9999/);
    expect(cartReducer(nearFull, { type: "add", product: soap })).toBe(nearFull);
  });

  it("+/− step 1; a whole qty stops at 1, 0.5 can't go lower, 2.5 -> 1.5 -> 0.5", () => {
    let cart = cartWith(soap, soap); // 2
    cart = cartReducer(cart, { type: "decrement", productId: soap.productId });
    expect(cart.items[0].qtyMilli).toBe(1000);
    expect(canDecrement(cart.items[0])).toBe(false);
    cart = cartReducer(cart, { type: "setQty", productId: soap.productId, qtyMilli: 2500 });
    cart = cartReducer(cart, { type: "decrement", productId: soap.productId });
    expect(cart.items[0].qtyMilli).toBe(1500);
    cart = cartReducer(cart, { type: "decrement", productId: soap.productId });
    expect(cart.items[0].qtyMilli).toBe(500);
    expect(canDecrement(cart.items[0])).toBe(false);
    expect(cartReducer(cart, { type: "decrement", productId: soap.productId })).toBe(cart);
    cart = cartReducer(cart, { type: "increment", productId: soap.productId });
    expect(cart.items[0].qtyMilli).toBe(1500);
    expect(canIncrement({ qtyMilli: MAX_PIECES_MILLI - 999, soldByWeight: false })).toBe(false);
    expect(canIncrement({ qtyMilli: MAX_PIECES_MILLI - 1000, soldByWeight: false })).toBe(true);
  });

  it("pieces sum exactly in thousandths, with weighed lines left out", () => {
    let cart = cartWith(soap, oil, tomato);
    cart = cartReducer(cart, { type: "setQty", productId: soap.productId, qtyMilli: 100 });
    cart = cartReducer(cart, { type: "setQty", productId: oil.productId, qtyMilli: 200 });
    cart = cartReducer(cart, { type: "setQty", productId: tomato.productId, qtyMilli: 333 });
    expect(previewCart(cart.items).totals.totalQtyMilli).toBe(300); // not 0.30000000000000004
  });

  it("saves and restores a fractional piece qty", () => {
    const cart = cartReducer(cartWith(soap), { type: "setQty", productId: soap.productId, qtyMilli: 500 });
    expect(parseStoredCart(JSON.stringify(cart))).toEqual(cart);
  });
});

describe("price edit (one bill only)", () => {
  const setPrice = (productId: string, price: number | null): CartAction => ({ type: "setPrice", productId, price });

  it("charges the edited price for the whole line and keeps the catalog price", () => {
    const cart = cartReducer(cartWith(soap, soap, oil), setPrice(soap.productId, 4000));
    expect(cart.items[0]).toMatchObject({ unitPrice: 4500, editedPrice: 4000, qtyMilli: 2000 });
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
    expect(cart.items[0]).toMatchObject({ qtyMilli: 2000, editedPrice: 4000 });
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
      { productId: soap.productId, qty: "1" },
      { productId: oil.productId, qty: "2", unitPrice: 3999 },
    ]);
  });

  it("previews amounts and GST on the charged price", () => {
    // 3 × ₹40.00 at 18%: 12000 = 10169 taxable + 915 CGST + 916 SGST (same as the DB test).
    const cart = cartReducer(cartWith(soap, soap, soap, oil), setPrice(soap.productId, 4000));
    const { lines, totals } = previewCart(cart.items);
    expect(lines[0]).toMatchObject({ unitPrice: 4500, editedPrice: 4000, lineTotal: 12000, taxableValue: 10169, cgst: 915, sgst: 916 });
    expect(lines[1]).toMatchObject({ unitPrice: 4500, lineTotal: 4500 });
    expect(lines[1]).toMatchObject(computeLineGst({ unitPrice: 4500, gstRate: 18, qtyMilli: 1000 }));
    expect(totals).toMatchObject({ itemCount: 2, totalQtyMilli: 4000, subtotal: 16500, grandTotal: 16500, roundOff: 0 });

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

  it("reads carts saved before weighed items existed (whole qty, no flag), also while pending", () => {
    const { qtyMilli: _q, soldByWeight: _w, ...rest } = cartWith(soap).items[0];
    void _q;
    void _w;
    const old = { idempotencyKey: KEY, paymentMethod: "cash", pendingSale: true, items: [{ ...rest, qty: 3 }] };
    const restored = parseStoredCart(JSON.stringify(old));
    expect(restored?.items[0]).toMatchObject({ qtyMilli: 3000, soldByWeight: false });
    expect(restored?.pendingSale).toBe(true);
    expect(toSaleItems(restored!)).toEqual([{ productId: soap.productId, qty: "3" }]);
  });

  it("rejects junk", () => {
    expect(parseStoredCart(null)).toBeNull();
    expect(parseStoredCart("{")).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cartWith(soap), idempotencyKey: "nope" }))).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cartWith(soap), items: [{ ...soap, qty: 0 }] }))).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cartWith(soap), items: [{ ...soap, qtyMilli: 0 }] }))).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cartWith(soap), items: [{ ...soap }] }))).toBeNull(); // no qty at all
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
