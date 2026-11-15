import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("./auth", () => ({ getStaffContext: mocks.auth, AuthError: class extends Error {} }));
vi.mock("./supabase/server", () => ({ createServerClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { voidInvoice } from "./invoice-void-actions";
const invoiceId = "2d6b9a4e-1c1f-4c55-9a52-3f4f8b1d2e10";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "admin-from-session" });
  mocks.rpc.mockResolvedValue({ error: null });
});
it("requires admin authorization before touching the database", async () => {
  mocks.auth.mockRejectedValue(new Error("Forbidden"));
  expect((await voidInvoice({ invoiceId, reason: "Duplicate" })).success).toBe(false);
  expect(mocks.auth).toHaveBeenCalledWith("admin");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([{ invoiceId: "bad", reason: "Duplicate" }, { invoiceId, reason: "   " }, { invoiceId, reason: "x".repeat(501) }])("rejects invalid input %j", async (input) => {
  expect((await voidInvoice(input)).statusCode).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("uses the session admin and refreshes invoice totals and detail", async () => {
  expect((await voidInvoice({ invoiceId, reason: " Duplicate " })).success).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith("void_invoice", { p_invoice_id: invoiceId, p_admin_user_id: "admin-from-session", p_reason: "Duplicate" });
  expect(mocks.revalidate).toHaveBeenCalledWith("/invoices");
  expect(mocks.revalidate).toHaveBeenCalledWith(`/invoices/${invoiceId}`);
});
it("does not claim success when the database fails", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "PGRST202" } });
  expect((await voidInvoice({ invoiceId, reason: "Duplicate" })).success).toBe(false);
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
