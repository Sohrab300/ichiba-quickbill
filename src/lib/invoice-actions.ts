"use server";

// Sale completion and reprint (REQUIREMENTS.md sections 5–7). Like every action, each one calls
// getStaffContext() first: Server Actions are public POST endpoints.

import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";
import { AuthError, getStaffContext } from "./auth";
import { createServerClient } from "./supabase/server";
import { MAX_INVOICE_LINES, MAX_LINE_QTY, PAYMENT_METHODS } from "./constants";
import { invoiceJsonSchema, type Invoice } from "./invoice";
import type { ActionResult } from "./actions";

export interface CompleteSaleResult extends ActionResult<Invoice> {
  /**
   * true when the request may or may not have created the invoice (network failure or timeout
   * between this server and Supabase, or an unreadable response). The browser must keep the
   * cart and its idempotency key and offer "Check status", which re-sends the same key.
   * When false/absent and success is false, the sale was definitely not saved.
   */
  statusUnknown?: boolean;
}

const completeSaleSchema = z.object({
  idempotencyKey: z.uuid("Invalid sale key"),
  items: z
    .array(
      z.object({
        productId: z.uuid("Invalid product id"),
        qty: z
          .number()
          .int("Quantity must be a whole number")
          .min(1, "Quantity must be at least 1")
          .max(MAX_LINE_QTY, `Quantity cannot exceed ${MAX_LINE_QTY}`),
      })
    )
    .min(1, "The cart is empty")
    .max(MAX_INVOICE_LINES, `Too many lines on one bill (max ${MAX_INVOICE_LINES})`),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: "Choose Cash, UPI or Card" }),
  // Any other field (a counter id, prices, totals…) is stripped and ignored.
});

export type CompleteSaleInput = z.input<typeof completeSaleSchema>;

/** Aborting the HTTP call makes the outcome unknown, so keep this above create_invoice's 10s lock_timeout. */
const RPC_TIMEOUT_MS = 20_000;

const STATUS_UNKNOWN_MESSAGE =
  "Sale status unknown: the connection to the database failed before it answered. " +
  "Do not start a new bill — use Check status.";

function fail(error: string, statusCode: number): CompleteSaleResult {
  return { success: false, error, statusCode };
}

function unknownOutcome(context: Record<string, unknown>, err: unknown): CompleteSaleResult {
  console.error("completeSale: outcome unknown", context, err);
  return { success: false, statusUnknown: true, error: STATUS_UNKNOWN_MESSAGE, statusCode: 503 };
}

function fromException(err: unknown, fallback: string): CompleteSaleResult {
  if (err instanceof AuthError) return fail(err.message, err.status);
  console.error(fallback, err);
  return fail(fallback, 500);
}

/**
 * An error is "definite" (the database transaction did not commit) only if it carries a
 * PostgREST code or a Postgres SQLSTATE from a class that always means rollback. Anything else —
 * transport failures (code ""), gateway error pages (no code), connection loss (class 08),
 * server shutdown (57P0x) or internal errors — might have happened after COMMIT.
 */
function isDefiniteFailure(error: PostgrestError): boolean {
  const code = error.code ?? "";
  if (code.startsWith("PGRST")) return true;
  if (!/^[0-9A-Z]{5}$/.test(code)) return false;
  if (code === "57014") return true; // statement cancelled (timeout) → rolled back
  return ["22", "23", "40", "42", "55", "P0"].includes(code.slice(0, 2));
}

function createInvoiceError(error: PostgrestError, context: Record<string, unknown>): CompleteSaleResult {
  if (!isDefiniteFailure(error)) return unknownOutcome(context, error);

  // Messages raised by create_invoice() itself are written for the cashier.
  if (error.code === "22023") return fail(error.message, 400);
  if (error.code === "42501") return fail(error.message, 403);
  if (error.code === "55P03" || error.code === "57014" || error.code?.startsWith("40")) {
    return fail("The database was busy and the sale was not saved. Try again.", 503);
  }
  if (error.code === "PGRST202") {
    console.error("create_invoice() is missing — apply the invoices migration", error);
    return fail("Billing is not set up on the database yet (invoices migration missing).", 500);
  }
  console.error("create_invoice failed", context, error);
  return fail(`The sale was not saved: ${error.message}`, 500);
}

/**
 * Completes a sale: creates the invoice in Supabase and returns it.
 *
 * The counter and cashier come only from the signed-in staff profile. Prices, names, GST and
 * totals come only from the database. Re-sending the same idempotencyKey returns the invoice
 * created by the first request (no second invoice, no new number), so the browser can retry
 * safely after an ambiguous failure.
 */
export async function completeSale(input: CompleteSaleInput): Promise<CompleteSaleResult> {
  let staff;
  try {
    staff = await getStaffContext();
  } catch (err: unknown) {
    return fromException(err, "Could not check your login. The sale was not saved.");
  }
  if (!staff.counter) return fail("This login has no counter, so it cannot bill.", 403);

  const parsed = completeSaleSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join("; "), 400);
  const { idempotencyKey, items, paymentMethod } = parsed.data;
  const context = { idempotencyKey, counter: staff.counter.code, userId: staff.userId };

  let supabase;
  try {
    supabase = createServerClient();
  } catch (err: unknown) {
    return fromException(err, "The database is not configured. The sale was not saved.");
  }

  let data: unknown;
  try {
    const res = await supabase
      .rpc("create_invoice", {
        p_idempotency_key: idempotencyKey,
        p_counter_id: staff.counter.id,
        p_cashier_user_id: staff.userId,
        p_items: items.map((i) => ({ product_id: i.productId, qty: i.qty })),
        p_payment_method: paymentMethod,
      })
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
    if (res.error) return createInvoiceError(res.error, context);
    data = res.data;
  } catch (err: unknown) {
    // The request was sent; we cannot tell whether it committed.
    return unknownOutcome(context, err);
  }

  const invoice = invoiceJsonSchema.safeParse(data);
  if (!invoice.success) {
    // The RPC succeeded, so the invoice almost certainly exists; Check status will fetch it.
    return unknownOutcome({ ...context, issues: invoice.error.issues }, "Unreadable create_invoice response");
  }
  if (invoice.data.idempotencyKey !== idempotencyKey || invoice.data.counterId !== staff.counter.id) {
    // Should be impossible (create_invoice enforces both); never show another sale's invoice.
    console.error("create_invoice returned a different sale", context, invoice.data.id);
    return fail("The database returned a different sale. Ask an admin.", 500);
  }
  return { success: true, data: invoice.data, statusCode: 201 };
}

/**
 * Re-fetches an issued invoice from Supabase for reprint. Never creates anything.
 * Admins can reprint any invoice; other staff only invoices of their own counter. An invoice the
 * caller may not see is reported as not found.
 */
export async function getInvoiceForReprint(invoiceId: string): Promise<ActionResult<Invoice>> {
  try {
    const staff = await getStaffContext();
    const id = z.uuid().safeParse(invoiceId);
    if (!id.success) return fail("Invalid invoice id", 400);

    const { data, error } = await createServerClient().rpc("get_invoice", { p_invoice_id: id.data });
    if (error) {
      console.error("get_invoice failed", error);
      return fail(`Could not load the invoice: ${error.message}`, 500);
    }
    if (data === null) return fail("Invoice not found", 404);

    const invoice = invoiceJsonSchema.safeParse(data);
    if (!invoice.success) {
      console.error("Unreadable get_invoice response", invoice.error.issues);
      return fail("Could not read the invoice.", 500);
    }
    const allowed = staff.role === "admin" || (staff.counter !== null && invoice.data.counterId === staff.counter.id);
    if (!allowed) return fail("Invoice not found", 404);

    return { success: true, data: invoice.data, statusCode: 200 };
  } catch (err: unknown) {
    return fromException(err, "Could not load the invoice.");
  }
}
