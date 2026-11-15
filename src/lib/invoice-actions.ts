"use server";

// Sale completion and reprint (REQUIREMENTS.md sections 5–7). Like every action, each one calls
// getStaffContext() first: Server Actions are public POST endpoints.

import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";
import { AuthError, getStaffContext } from "./auth";
import { createServerClient } from "./supabase/server";
import { MAX_INVOICE_LINES, MAX_LINE_QTY, PAYMENT_METHODS } from "./constants";
import { invoiceJsonSchema, toPublicInvoice, type Invoice } from "./invoice";
import type { ActionResult } from "./actions";
import { startOfTodayIst, toInvoiceNoSearchTerm } from "./invoice-search";
import { fetchInvoice } from "./invoice-history";

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
        // A per-bill price edit (REQUIREMENTS.md section 16), GST-inclusive paise. Only a request:
        // create_invoice() reads the catalog price and MRP itself and refuses anything outside
        // 0 < price <= MRP.
        unitPrice: z
          .number()
          .int("A changed price must be a whole number of paise")
          .min(1, "A changed price must be more than ₹0")
          .max(2_147_483_647, "A changed price is too large")
          .optional(),
      })
    )
    .min(1, "The cart is empty")
    .max(MAX_INVOICE_LINES, `Too many lines on one bill (max ${MAX_INVOICE_LINES})`),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: "Choose Cash, UPI or Card" }),
  // Any other field (a counter id, catalog prices, totals…) is stripped and ignored.
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
 * The counter and cashier come only from the signed-in staff profile. Names, catalog prices, MRP,
 * GST and totals come only from the database; an item's unitPrice is only a request to charge a
 * different price on this bill, which the database accepts within 0 < price <= MRP. The returned
 * invoice carries the charged prices only (no edit audit fields). Re-sending the same idempotencyKey returns the invoice
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
        p_items: items.map((i) =>
          i.unitPrice === undefined
            ? { product_id: i.productId, qty: i.qty }
            : { product_id: i.productId, qty: i.qty, unit_price: i.unitPrice }
        ),
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
  return { success: true, data: toPublicInvoice(invoice.data), statusCode: 201 };
}

/**
 * Re-fetches an issued invoice from Supabase for reprint, without its price-edit audit fields
 * (the receipt shows only the charged rate). Never creates anything.
 * Admins can reprint any invoice; other staff only invoices of their own counter. An invoice the
 * caller may not see is reported as not found.
 */
export async function getInvoiceForReprint(invoiceId: string): Promise<ActionResult<Invoice>> {
  try {
    const staff = await getStaffContext();
    const id = z.uuid().safeParse(invoiceId);
    if (!id.success) return fail("Invalid invoice id", 400);

    let invoice;
    try {
      invoice = await fetchInvoice(id.data);
    } catch (err: unknown) {
      console.error("get_invoice failed", err);
      return fail(err instanceof Error ? err.message : "Could not load the invoice.", 500);
    }
    if (invoice === null) return fail("Invoice not found", 404);

    const allowed = staff.role === "admin" || (staff.counter !== null && invoice.counterId === staff.counter.id);
    if (!allowed) return fail("Invoice not found", 404);

    return { success: true, data: toPublicInvoice(invoice), statusCode: 200 };
  } catch (err: unknown) {
    return fromException(err, "Could not load the invoice.");
  }
}

/** One row of the Print Previous Invoice list. Amounts in paise. */
export interface RecentInvoice {
  id: string;
  invoiceNo: string;
  counterCode: string;
  /** ISO timestamp (UTC); display in Asia/Kolkata. */
  createdAt: string;
  grandTotal: number;
  paymentMethod: (typeof PAYMENT_METHODS)[number];
}

const RECENT_INVOICES_LIMIT = 20;

const recentInvoicesSchema = z.object({
  search: z.string().max(100, "Search text is too long").optional(),
});

const recentInvoiceRow = z.object({
  id: z.string().min(1),
  invoice_no: z.string(),
  counter_code: z.string(),
  created_at: z.string(),
  grand_total: z.number().int(),
  payment_method: z.enum(PAYMENT_METHODS),
});

/**
 * Invoices for the Print Previous Invoice dialog (REQUIREMENTS.md section 12), newest first,
 * at most 20. Read-only.
 *
 * - No search: today's (IST) invoices of the caller's own counter (none for a login without one).
 * - Search: invoices whose number contains the text (case-insensitive). Cashiers: own counter,
 *   today only. Admins: any counter, any date.
 */
export async function getRecentInvoices(input: { search?: string } = {}): Promise<ActionResult<RecentInvoice[]>> {
  const empty: ActionResult<RecentInvoice[]> = { success: true, data: [], statusCode: 200 };
  try {
    const staff = await getStaffContext();
    const parsed = recentInvoicesSchema.safeParse(input ?? {});
    if (!parsed.success) return { success: false, error: parsed.error.issues.map((i) => i.message).join("; "), statusCode: 400 };

    const raw = parsed.data.search?.trim() ?? "";
    const term = toInvoiceNoSearchTerm(raw);
    if (raw && !term) return empty;

    const anyCounterAnyDate = staff.role === "admin" && term !== "";
    const counter = staff.counter;
    if (!anyCounterAnyDate && !counter) return empty;

    let query = createServerClient()
      .from("invoices")
      .select("id, invoice_no, counter_code, created_at, grand_total, payment_method")
      .order("created_at", { ascending: false })
      .limit(RECENT_INVOICES_LIMIT);
    if (!anyCounterAnyDate && counter) {
      query = query.eq("counter_id", counter.id).gte("created_at", startOfTodayIst().toISOString());
    }
    if (term) query = query.ilike("invoice_no", `%${term}%`);

    const { data, error } = await query;
    if (error) {
      console.error("getRecentInvoices failed", error);
      return { success: false, error: `Could not load invoices: ${error.message}`, statusCode: 500 };
    }
    const rows = z.array(recentInvoiceRow).safeParse(data);
    if (!rows.success) {
      console.error("Unreadable invoices rows", rows.error.issues);
      return { success: false, error: "Could not read the invoices.", statusCode: 500 };
    }
    return {
      success: true,
      statusCode: 200,
      data: rows.data.map((r) => ({
        id: r.id,
        invoiceNo: r.invoice_no,
        counterCode: r.counter_code,
        createdAt: r.created_at,
        grandTotal: r.grand_total,
        paymentMethod: r.payment_method,
      })),
    };
  } catch (err: unknown) {
    const { error, statusCode } = fromException(err, "Could not load invoices.");
    return { success: false, error, statusCode };
  }
}
