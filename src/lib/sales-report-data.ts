import "server-only";

// Reads the sales report from the database (sales_report(), one round trip for any range).
// Admin only: every caller has already checked getStaffContext("admin") (or the page's role check).

import { z } from "zod";
import { createServerClient } from "./supabase/server";
import { istDayRange } from "./ist-date";
import { qtyMilliFromNumber } from "./qty";
import type { SalesReport, SalesReportQuery, SalesSums } from "./sales-report";

/** A request the database cannot answer as asked (unknown counter): HTTP 400, not a server error. */
export class SalesReportInputError extends Error {
  readonly status = 400;
}

const paise = z.number().int();
const count = z.number().int().nonnegative();
/** numeric(…, 3) sums arrive as JSON numbers (or strings, depending on size): kept as thousandths. */
const qtyMilli = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const milli = qtyMilliFromNumber(Number(v));
  if (milli === null || milli < 0) {
    ctx.addIssue({ code: "custom", message: `Unreadable quantity ${v}` });
    return z.NEVER;
  }
  return milli;
});

const reportRow = z.object({
  is_total: z.boolean(),
  hsn: z.string().nullable(),
  gst_rate: z.number().int().nullable(),
  invoice_count: count,
  line_count: count,
  qty_kg: qtyMilli,
  qty_pcs: qtyMilli,
  taxable: paise,
  cgst: paise,
  sgst: paise,
  line_total: paise,
});

type ReportRow = z.output<typeof reportRow>;

function sums(r: ReportRow): SalesSums {
  return {
    invoiceCount: r.invoice_count,
    lineCount: r.line_count,
    qtyKgMilli: r.qty_kg,
    qtyPcsMilli: r.qty_pcs,
    taxable: r.taxable,
    cgst: r.cgst,
    sgst: r.sgst,
    lineTotal: r.line_total,
  };
}

/** The report for a validated query (parseSalesReportInput()). */
export async function fetchSalesReport(q: SalesReportQuery): Promise<SalesReport> {
  const db = createServerClient();

  let counterId: string | null = null;
  if (q.counter) {
    const { data, error } = await db.from("counters").select("id").eq("code", q.counter).maybeSingle();
    if (error) throw new Error(`Could not load the counter: ${error.message}`);
    if (!data) throw new SalesReportInputError(`Unknown counter ${q.counter}.`);
    counterId = data.id;
  }

  // [first IST day 00:00, day after the last IST day 00:00) — the same boundaries as /invoices.
  const { data, error } = await db.rpc("sales_report", {
    p_from: istDayRange(q.from).from.toISOString(),
    p_to: istDayRange(q.to).to.toISOString(),
    ...(counterId ? { p_counter_id: counterId } : {}),
    p_group: q.group,
  });
  if (error) {
    if (error.code === "PGRST202") throw new Error("sales_report() is missing — apply the sales report migration.");
    throw new Error(`Could not load the sales report: ${error.message}`);
  }

  const rows = z.array(reportRow).safeParse(data);
  if (!rows.success) {
    console.error("Unreadable sales_report rows", rows.error.issues);
    throw new Error("Could not read the sales report.");
  }
  const total = rows.data.find((r) => r.is_total);
  if (!total) throw new Error("The sales report has no totals row.");

  return {
    from: q.from,
    to: q.to,
    counter: q.counter,
    group: q.group,
    // Already in screen order (HSN, missing HSN last, then rate).
    rows: rows.data
      .filter((r) => !r.is_total)
      .map((r) => ({ hsn: r.hsn, gstRate: r.gst_rate ?? 0, ...sums(r) })),
    total: sums(total),
  };
}
