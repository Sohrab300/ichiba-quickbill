import { beforeEach, describe, expect, it, vi } from "vitest";

// getSalesReport() with the session and the database replaced by fakes: the admin check comes
// first, bad input never reaches the database, and the validated query is what gets fetched.

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

const data = vi.hoisted(() => {
  class SalesReportInputError extends Error {
    readonly status = 400;
  }
  return { SalesReportInputError, fetchSalesReport: vi.fn() };
});
vi.mock("./sales-report-data", () => data);

import { getSalesReport } from "./report-actions";

const admin = { userId: "u1", displayName: "Admin", role: "admin", counter: null };
const input = { from: "2026-11-01", to: "2026-11-19", counter: "cl1", group: "hsn" as const };
const zero = { invoiceCount: 0, lineCount: 0, qtyKgMilli: 0, qtyPcsMilli: 0, taxable: 0, cgst: 0, sgst: 0, lineTotal: 0 };

beforeEach(() => {
  auth.getStaffContext.mockReset().mockResolvedValue(admin);
  data.fetchSalesReport.mockReset().mockImplementation(async (q) => ({ ...q, rows: [], total: zero }));
});

describe("getSalesReport", () => {
  it("requires an admin before anything else", async () => {
    auth.getStaffContext.mockRejectedValue(new auth.AuthError("Only an admin can do this.", 403));
    expect(await getSalesReport(input)).toEqual({ success: false, error: "Only an admin can do this.", statusCode: 403 });
    expect(auth.getStaffContext).toHaveBeenCalledWith("admin");
    expect(data.fetchSalesReport).not.toHaveBeenCalled();
  });

  it("not signed in: 401, no database call", async () => {
    auth.getStaffContext.mockRejectedValue(new auth.AuthError("Not signed in. Please sign in again.", 401));
    expect((await getSalesReport(input)).statusCode).toBe(401);
    expect(data.fetchSalesReport).not.toHaveBeenCalled();
  });

  it("fetches the validated query (counter upper-cased)", async () => {
    const result = await getSalesReport(input);
    expect(result).toMatchObject({ success: true, statusCode: 200, data: { from: "2026-11-01", to: "2026-11-19", counter: "CL1", group: "hsn" } });
    expect(data.fetchSalesReport).toHaveBeenCalledExactlyOnceWith({ from: "2026-11-01", to: "2026-11-19", counter: "CL1", group: "hsn" });
  });

  it.each([
    ["more than 92 days", { from: "2026-07-01", to: "2026-10-01" }],
    ["from after to", { from: "2026-11-19", to: "2026-11-18" }],
    ["impossible date", { to: "2026-11-31" }],
    ["unknown group", { group: "item" }],
    ["bad counter code", { counter: "CL 1" }],
  ])("%s: 400 without a database call", async (_name, change) => {
    const result = await getSalesReport({ ...input, ...change } as typeof input);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toBeTruthy();
    expect(data.fetchSalesReport).not.toHaveBeenCalled();
  });

  it("garbage input (not an object): 400", async () => {
    expect((await getSalesReport(null as never)).statusCode).toBe(400);
    expect(data.fetchSalesReport).not.toHaveBeenCalled();
  });

  it("unknown counter: 400 with the message", async () => {
    data.fetchSalesReport.mockRejectedValue(new data.SalesReportInputError("Unknown counter CL9."));
    expect(await getSalesReport({ ...input, counter: "CL9" })).toEqual({ success: false, error: "Unknown counter CL9.", statusCode: 400 });
  });

  it("database failure: 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    data.fetchSalesReport.mockRejectedValue(new Error("Could not load the sales report: timeout"));
    expect(await getSalesReport(input)).toEqual({ success: false, error: "Could not load the sales report: timeout", statusCode: 500 });
  });
});
