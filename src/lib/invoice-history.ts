import "server-only";

// Invoice history reads for /invoices, its detail page and the CSV exports
// (REQUIREMENTS.md section 9). Read-only; every caller has already run getStaffContext().

import { z } from "zod";
import type { StaffContext } from "./auth";
import { createServerClient } from "./supabase/server";
import { PAYMENT_METHODS, type PaymentMethod } from "./constants";
import { invoiceJsonSchema, type Invoice } from "./invoice";
import { toInvoiceNoSearchTerm } from "./invoice-search";
import { istDateOf, istDayRange, parseIstDate, todayIst } from "./ist-date";

export const INVOICES_PAGE_SIZE = 50;

export interface CounterOption {
  id: string;
  code: string;
  isActive: boolean;
}

export interface InvoiceFilters {
  /** IST date, YYYY-MM-DD. */
  date: string;
  /** null = all counters (admins only). */
  counter: CounterOption | null;
  /** Normalised invoice-number search ("" = none). */
  search: string;
  /** 1-based. */
  page: number;
  /** true for cashiers: date and counter are fixed to today and their own counter. */
  locked: boolean;
  /**
   * Admin with search text: the list ignores `date` and searches every date (the counter filter
   * still applies). Cashiers never get this. Day totals always stay on `date`.
   */
  allDates: boolean;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Every counter, including disabled ones (they still have history). Sorted by code. */
export async function listCounters(): Promise<CounterOption[]> {
  const { data, error } = await createServerClient().from("counters").select("id, code, is_active").order("code");
  if (error) throw new Error(`Could not load counters: ${error.message}`);
  return data.map((c) => ({ id: c.id, code: c.code, isActive: c.is_active }));
}

/**
 * Turns query parameters into the filters this login may use. Cashiers always get today and
 * their own counter, whatever the URL says; admins may pick any date and counter (or all).
 */
export function resolveInvoiceFilters(staff: StaffContext, params: RawParams, counters: CounterOption[]): InvoiceFilters {
  const search = toInvoiceNoSearchTerm(first(params.q) ?? "");
  const pageNum = Number(first(params.page));
  const page = Number.isInteger(pageNum) && pageNum >= 1 && pageNum <= 10_000 ? pageNum : 1;

  if (staff.role !== "admin") {
    const own = staff.counter;
    return {
      date: todayIst(),
      counter: own ? { id: own.id, code: own.code, isActive: true } : null,
      search,
      page,
      locked: true,
      allDates: false,
    };
  }

  const code = first(params.counter)?.toUpperCase();
  return {
    date: parseIstDate(first(params.date)) ?? todayIst(),
    counter: counters.find((c) => c.code === code) ?? null,
    search,
    page,
    locked: false,
    allDates: search !== "",
  };
}

/** Query string for these filters (page omitted when 1), for links that keep them. */
export function filtersQuery(f: Pick<InvoiceFilters, "date" | "counter" | "search" | "page" | "locked">, page = f.page): string {
  const q = new URLSearchParams();
  if (!f.locked) {
    q.set("date", f.date);
    if (f.counter) q.set("counter", f.counter.code);
  }
  if (f.search) q.set("q", f.search);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface InvoiceListRow {
  id: string;
  invoiceNo: string;
  createdAt: string;
  counterCode: string;
  cashierName: string;
  paymentMethod: PaymentMethod;
  itemCount: number;
  grandTotal: number;
}

export interface InvoiceListPage {
  rows: InvoiceListRow[];
  /** Matching invoices on all pages; null when the page is past the end. */
  total: number | null;
}

const listRow = z.object({
  id: z.string().min(1),
  invoice_no: z.string(),
  created_at: z.string(),
  counter_code: z.string(),
  cashier_name: z.string(),
  payment_method: z.enum(PAYMENT_METHODS),
  item_count: z.number().int(),
  grand_total: z.number().int(),
});

/**
 * One page of invoices matching the filters, newest first. A login without a counter that isn't
 * admin gets nothing.
 */
export async function listInvoices(f: InvoiceFilters): Promise<InvoiceListPage> {
  if (f.locked && !f.counter) return { rows: [], total: 0 };
  const offset = (f.page - 1) * INVOICES_PAGE_SIZE;

  let query = createServerClient()
    .from("invoices")
    .select("id, invoice_no, created_at, counter_code, cashier_name, payment_method, item_count, grand_total", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .order("invoice_no", { ascending: false })
    .range(offset, offset + INVOICES_PAGE_SIZE - 1);
  if (!f.allDates) {
    const { from, to } = istDayRange(f.date);
    query = query.gte("created_at", from.toISOString()).lt("created_at", to.toISOString());
  }
  if (f.counter) query = query.eq("counter_id", f.counter.id);
  // toInvoiceNoSearchTerm() leaves only [A-Z0-9/-], so no LIKE wildcards get through.
  if (f.search) query = query.ilike("invoice_no", `%${f.search}%`);

  const { data, error, count } = await query;
  if (error) {
    if (error.code === "PGRST103") return { rows: [], total: null }; // offset past the last row
    throw new Error(`Could not load invoices: ${error.message}`);
  }
  const rows = z.array(listRow).parse(data);
  return {
    total: count ?? rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoice_no,
      createdAt: r.created_at,
      counterCode: r.counter_code,
      cashierName: r.cashier_name,
      paymentMethod: r.payment_method,
      itemCount: r.item_count,
      grandTotal: r.grand_total,
    })),
  };
}

// ---------------------------------------------------------------------------
// Day totals
// ---------------------------------------------------------------------------

export interface Totals {
  invoiceCount: number;
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  roundOff: number;
  grandTotal: number;
}

export interface DayTotals extends Totals {
  byPaymentMethod: Record<PaymentMethod, Totals>;
}

const ZERO: Totals = { invoiceCount: 0, taxableTotal: 0, cgstTotal: 0, sgstTotal: 0, roundOff: 0, grandTotal: 0 };

const totalsRow = z.object({
  payment_method: z.enum(PAYMENT_METHODS),
  invoice_count: z.number().int(),
  taxable_total: z.number().int(),
  cgst_total: z.number().int(),
  sgst_total: z.number().int(),
  round_off: z.number().int(),
  grand_total: z.number().int(),
});

/**
 * Totals for the whole IST day and counter filter (the invoice-number search does not narrow
 * them), so they match the daily-summary export for the same date and counter.
 */
export async function getDayTotals(f: Pick<InvoiceFilters, "date" | "counter" | "locked">): Promise<DayTotals> {
  const byPaymentMethod = { cash: { ...ZERO }, upi: { ...ZERO }, card: { ...ZERO } };
  const day: DayTotals = { ...ZERO, byPaymentMethod };
  if (f.locked && !f.counter) return day;

  const { from, to } = istDayRange(f.date);
  const { data, error } = await createServerClient().rpc("invoice_day_totals", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    ...(f.counter ? { p_counter_id: f.counter.id } : {}),
  });
  if (error) {
    if (error.code === "PGRST202") throw new Error("invoice_day_totals() is missing — apply the invoice history migration.");
    throw new Error(`Could not load day totals: ${error.message}`);
  }
  for (const r of z.array(totalsRow).parse(data)) {
    const t: Totals = {
      invoiceCount: r.invoice_count,
      taxableTotal: r.taxable_total,
      cgstTotal: r.cgst_total,
      sgstTotal: r.sgst_total,
      roundOff: r.round_off,
      grandTotal: r.grand_total,
    };
    byPaymentMethod[r.payment_method] = t;
    for (const k of Object.keys(ZERO) as (keyof Totals)[]) day[k] += t[k];
  }
  return day;
}

// ---------------------------------------------------------------------------
// One invoice
// ---------------------------------------------------------------------------

/** The full invoice (get_invoice RPC), or null if the id does not exist. Throws on database errors. */
export async function fetchInvoice(invoiceId: string): Promise<Invoice | null> {
  const { data, error } = await createServerClient().rpc("get_invoice", { p_invoice_id: invoiceId });
  if (error) throw new Error(`Could not load the invoice: ${error.message}`);
  if (data === null) return null;
  const invoice = invoiceJsonSchema.safeParse(data);
  if (!invoice.success) {
    console.error("Unreadable get_invoice response", invoice.error.issues);
    throw new Error("Could not read the invoice.");
  }
  return invoice.data;
}

/**
 * The invoice for the history detail page, or null when it does not exist or this login may not
 * see it (admins: any; cashiers: their own counter, today — the same scope as the list).
 */
export async function getInvoiceForHistory(staff: StaffContext, invoiceId: string): Promise<Invoice | null> {
  if (!z.uuid().safeParse(invoiceId).success) return null;
  const invoice = await fetchInvoice(invoiceId);
  if (!invoice) return null;
  if (staff.role === "admin") return invoice;
  const own = staff.counter !== null && invoice.counterId === staff.counter.id;
  return own && istDateOf(invoice.createdAt) === todayIst() ? invoice : null;
}
