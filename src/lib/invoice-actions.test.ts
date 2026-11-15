import { beforeEach, describe, expect, it, vi } from "vitest";

// completeSale() with the session and the database replaced by fakes: checks which counter and
// cashier it sends to create_invoice(), and that it never calls the database without a login.

vi.mock("server-only", () => ({}));

const auth = vi.hoisted(() => {
  class AuthError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403
    ) {
      super(message);
    }
  }
  return { AuthError, getStaffContext: vi.fn() };
});
vi.mock("./auth", () => auth);

const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabase/server", () => ({ createServerClient: () => db }));

import { completeSale } from "./invoice-actions";

const MOB = { id: "6f1d1c1e-0000-4000-8000-00000000000a", code: "MOB", invoicePrefix: "MOB", kind: "mobile", printWidthMm: 80 };
const CL1_ID = "6f1d1c1e-0000-4000-8000-000000000001";
const mobileCashier = { userId: "9b0c7f43-0000-4000-8000-000000000001", displayName: "Phone 1", role: "cashier", counter: MOB };

const input = {
  idempotencyKey: "2d6b9a4e-1c1f-4c55-9a52-3f4f8b1d2e10",
  items: [{ productId: "0c8f0e4c-5a7e-4d3e-9f39-7b0b2b6d9a11", qty: 2 }],
  paymentMethod: "upi" as const,
};

/** A create_invoice() response for `input`: one line, 2 × ₹40.00 (catalog ₹45.00 when edited). */
function invoiceJson({ edited }: { edited: boolean }) {
  return {
    id: "3f6c3b1e-0000-4000-8000-000000000001",
    invoice_no: "MOB/26-27/000001",
    counter_id: MOB.id,
    counter_code: "MOB",
    fy: "26-27",
    seq_number: 1,
    idempotency_key: input.idempotencyKey,
    cashier_user_id: mobileCashier.userId,
    cashier_name: "Phone 1",
    payment_method: "upi",
    item_count: 1,
    total_qty: 2,
    subtotal: 8000,
    taxable_total: 6780,
    cgst_total: 610,
    sgst_total: 610,
    round_off: 0,
    grand_total: 8000,
    has_price_edit: edited,
    created_at: "2026-11-15T10:00:00+00:00",
    store: { legal_name: "S", address: "A", phone: null, gstin: "06ABLFA8216A1ZT", state_code: "06", state_name: "Haryana", footer: null },
    items: [
      {
        line_no: 1, product_id: input.items[0].productId, item_code: "7021317", name: "Soap", hsn_code: "3401", uom: "PCS",
        unit_price: 4000, catalog_price: edited ? 4500 : 4000, price_edited: edited, mrp: 5000, gst_rate: 18, qty: 2,
        line_total: 8000, taxable_value: 6780, cgst: 610, sgst: 610,
      },
    ],
    tax_summary: [{ hsn_code: "3401", gst_rate: 18, taxable_value: 6780, cgst: 610, sgst: 610, total: 8000 }],
  };
}

/** create_invoice() answers with `result` (or throws `result` when it is an Error). */
function rpcReturns(result: unknown) {
  db.rpc.mockReturnValue({
    abortSignal: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
  });
}

beforeEach(() => {
  auth.getStaffContext.mockReset();
  db.rpc.mockReset();
});

describe("completeSale", () => {
  it("bills on the counter from the staff profile, ignoring a counter sent by the browser", async () => {
    auth.getStaffContext.mockResolvedValue(mobileCashier);
    rpcReturns({ data: null, error: { code: "22023", message: "The cart is empty.", details: "", hint: "" } });

    await completeSale({ ...input, counterId: CL1_ID, counterCode: "CL1", prices: [1] } as typeof input);

    expect(db.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = db.rpc.mock.calls[0];
    expect(fn).toBe("create_invoice");
    expect(args).toEqual({
      p_idempotency_key: input.idempotencyKey,
      p_counter_id: MOB.id,
      p_cashier_user_id: mobileCashier.userId,
      p_items: [{ product_id: input.items[0].productId, qty: 2 }],
      p_payment_method: "upi",
    });
  });

  it("passes an edited price through as unit_price, only for edited lines", async () => {
    auth.getStaffContext.mockResolvedValue(mobileCashier);
    rpcReturns({ data: null, error: { code: "22023", message: "Price not allowed", details: "", hint: "" } });
    const other = "0c8f0e4c-5a7e-4d3e-9f39-7b0b2b6d9a12";

    const res = await completeSale({
      ...input,
      items: [
        { productId: input.items[0].productId, qty: 2, unitPrice: 4000 },
        { productId: other, qty: 1 },
      ],
    });

    expect(db.rpc.mock.calls[0][1].p_items).toEqual([
      { product_id: input.items[0].productId, qty: 2, unit_price: 4000 },
      { product_id: other, qty: 1 },
    ]);
    // The database's refusal (e.g. above MRP) reaches the cashier as a definite failure.
    expect(res).toMatchObject({ success: false, statusCode: 400, error: "Price not allowed" });
    expect(res.statusUnknown).toBeFalsy();
  });

  it("rejects a malformed edited price before touching the database", async () => {
    auth.getStaffContext.mockResolvedValue(mobileCashier);
    for (const unitPrice of [0, -5, 40.5, "4000" as unknown as number]) {
      const res = await completeSale({ ...input, items: [{ ...input.items[0], unitPrice }] });
      expect(res).toMatchObject({ success: false, statusCode: 400 });
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("returns the invoice without the price-edit audit fields", async () => {
    auth.getStaffContext.mockResolvedValue(mobileCashier);
    rpcReturns({ data: invoiceJson({ edited: true }), error: null });
    const res = await completeSale({ ...input, items: [{ ...input.items[0], unitPrice: 4000 }] });
    expect(res.success).toBe(true);
    const sent = JSON.parse(JSON.stringify(res.data));
    expect(sent).not.toHaveProperty("hasPriceEdit");
    expect(sent.items[0]).not.toHaveProperty("catalogPrice");
    expect(sent.items[0]).not.toHaveProperty("priceEdited");
    expect(sent.items[0].unitPrice).toBe(4000);
    expect(JSON.stringify(res)).not.toMatch(/4500|edited/i);
  });

  it("refuses a login without a counter before touching the database", async () => {
    auth.getStaffContext.mockResolvedValue({ ...mobileCashier, role: "admin", counter: null });
    const res = await completeSale(input);
    expect(res).toMatchObject({ success: false, statusCode: 403 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("refuses a request without a session", async () => {
    auth.getStaffContext.mockRejectedValue(new auth.AuthError("Not signed in.", 401));
    const res = await completeSale(input);
    expect(res).toMatchObject({ success: false, statusCode: 401 });
    expect(res.statusUnknown).toBeFalsy();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("reports 'status unknown' when the database call fails without an answer", async () => {
    auth.getStaffContext.mockResolvedValue(mobileCashier);
    rpcReturns(new TypeError("fetch failed"));
    const res = await completeSale(input);
    expect(res).toMatchObject({ success: false, statusUnknown: true });
  });

  it("reports a definite failure (sale not saved) for a database validation error", async () => {
    auth.getStaffContext.mockResolvedValue(mobileCashier);
    rpcReturns({ data: null, error: { code: "42501", message: "This login does not bill on this counter.", details: "", hint: "" } });
    const res = await completeSale(input);
    expect(res).toMatchObject({ success: false, statusCode: 403, error: "This login does not bill on this counter." });
    expect(res.statusUnknown).toBeFalsy();
  });
});
