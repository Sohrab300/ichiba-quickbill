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
