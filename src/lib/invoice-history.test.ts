import { beforeEach, describe, expect, it, vi } from "vitest";

// Price-edit visibility (REQUIREMENTS.md section 16) is decided on the server: cashiers never get
// the flag, the filter, the count or the catalog prices, whatever the URL says.

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("./supabase/server", () => ({ createServerClient: () => db }));

import type { StaffContext } from "./auth";
import { getDayTotals, getInvoiceForHistory, listInvoices, resolveInvoiceFilters } from "./invoice-history";

const CL1 = { id: "6f1d1c1e-0000-4000-8000-000000000001", code: "CL1", invoicePrefix: "CL1", kind: "desk", printWidthMm: 80 } as const;
const cashier: StaffContext = { userId: "9b0c7f43-0000-4000-8000-000000000001", displayName: "CL1", role: "cashier", counter: CL1 };
const admin: StaffContext = { ...cashier, role: "admin", displayName: "Admin" };

/** A query builder that records its calls and resolves to `result`. */
function queryReturning(result: unknown) {
  const calls: [string, unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "order", "range", "gte", "lt", "eq", "ilike"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  return { builder, calls };
}

const row = {
  id: "3f6c3b1e-0000-4000-8000-000000000001",
  invoice_no: "CL1/26-27/000001",
  created_at: new Date().toISOString(),
  counter_code: "CL1",
  cashier_name: "CL1",
  payment_method: "cash",
  item_count: 1,
  grand_total: 4000,
  has_price_edit: true,
};

beforeEach(() => {
  db.rpc.mockReset();
  db.from.mockReset();
});

describe("price-edit visibility", () => {
  it("ignores ?edited=1 for cashiers and honours it for admins", () => {
    expect(resolveInvoiceFilters(cashier, { edited: "1" }, [])).toMatchObject({ showPriceEdits: false, editedOnly: false });
    expect(resolveInvoiceFilters(admin, { edited: "1" }, [])).toMatchObject({ showPriceEdits: true, editedOnly: true });
    expect(resolveInvoiceFilters(admin, {}, [])).toMatchObject({ showPriceEdits: true, editedOnly: false });
  });

  it("never selects has_price_edit for cashiers", async () => {
    const q = queryReturning({ data: [{ ...row, has_price_edit: undefined }], error: null, count: 1 });
    db.from.mockReturnValue(q.builder);
    const page = await listInvoices(resolveInvoiceFilters(cashier, { edited: "1" }, []));
    const select = q.calls.find(([m]) => m === "select")![1][0] as string;
    expect(select).not.toMatch(/has_price_edit/);
    expect(q.calls.some(([m, args]) => m === "eq" && args[0] === "has_price_edit")).toBe(false);
    expect(page.rows[0]).not.toHaveProperty("hasPriceEdit");
  });

  it("selects and filters on has_price_edit for admins", async () => {
    const q = queryReturning({ data: [row], error: null, count: 1 });
    db.from.mockReturnValue(q.builder);
    const page = await listInvoices(resolveInvoiceFilters(admin, { edited: "1" }, []));
    expect(q.calls.find(([m]) => m === "select")![1][0]).toMatch(/has_price_edit/);
    expect(q.calls).toContainEqual(["eq", ["has_price_edit", true]]);
    expect(page.rows[0].hasPriceEdit).toBe(true);
  });

  it("gives cashiers no edited-bills count", async () => {
    db.rpc.mockResolvedValue({
      data: [{ payment_method: "cash", invoice_count: 3, edited_count: 2, taxable_total: 1, cgst_total: 0, sgst_total: 0, round_off: 0, grand_total: 1 }],
      error: null,
    });
    expect((await getDayTotals(resolveInvoiceFilters(cashier, {}, []))).editedCount).toBeNull();
    expect((await getDayTotals(resolveInvoiceFilters(admin, {}, []))).editedCount).toBe(2);
  });

  it("strips catalog prices and edit flags from a cashier's invoice detail", async () => {
    db.rpc.mockResolvedValue({
      data: {
        id: row.id, invoice_no: row.invoice_no, counter_id: CL1.id, counter_code: "CL1", fy: "26-27", seq_number: 1,
        idempotency_key: "2d6b9a4e-1c1f-4c55-9a52-3f4f8b1d2e10", cashier_user_id: cashier.userId, cashier_name: "CL1",
        payment_method: "cash", item_count: 1, total_qty: 1, subtotal: 4000, taxable_total: 3390, cgst_total: 305,
        sgst_total: 305, round_off: 0, grand_total: 4000, has_price_edit: true, created_at: row.created_at,
        store: { legal_name: "S", address: "A", phone: null, gstin: "06ABLFA8216A1ZT", state_code: "06", state_name: "Haryana", footer: null },
        items: [{
          line_no: 1, product_id: "0c8f0e4c-5a7e-4d3e-9f39-7b0b2b6d9a11", item_code: "7021317", name: "Soap", hsn_code: "3401",
          uom: "PCS", unit_price: 4000, catalog_price: 4500, price_edited: true, mrp: 5000, gst_rate: 18, qty: 1,
          line_total: 4000, taxable_value: 3390, cgst: 305, sgst: 305,
        }],
        tax_summary: [],
      },
      error: null,
    });
    const forCashier = await getInvoiceForHistory(cashier, row.id);
    expect(forCashier?.audited).toBe(false);
    const json = JSON.stringify(forCashier?.invoice);
    expect(json).not.toMatch(/catalogPrice|priceEdited|hasPriceEdit|4500/);

    const forAdmin = await getInvoiceForHistory(admin, row.id);
    expect(forAdmin).toMatchObject({ audited: true, invoice: { hasPriceEdit: true, items: [{ catalogPrice: 4500, priceEdited: true }] } });
  });
});
