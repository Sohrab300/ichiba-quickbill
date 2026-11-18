/**
 * Sales report (Reports page): sales per HSN + GST rate or per GST rate over a range of IST days,
 * summed in the database by sales_report() (migration 20261119100000_sales_report.sql).
 * Pure; safe to import from client components. The database call is in sales-report-data.ts.
 */

import { z } from "zod";
import { CSV_BOM, csvRow, paiseToRupees, quoted, type CsvValue } from "./csv";
import { addIstDays, istDaysInclusive, parseIstDate } from "./ist-date";
import { formatQty } from "./qty";

/** Longest range, in days with both ends included (a full quarter is 92 days). */
export const SALES_REPORT_MAX_DAYS = 92;

export const SALES_REPORT_GROUPS = ["hsn", "gst"] as const;
export type SalesReportGroup = (typeof SALES_REPORT_GROUPS)[number];

const istDate = (label: string) =>
  z.string({ error: `${label} date is required.` }).refine((v) => parseIstDate(v) !== null, {
    message: `${label} date must be a real date in YYYY-MM-DD form (IST).`,
  });

/** What the browser may send (Server Action input and the CSV route's query string). */
export const salesReportInputSchema = z
  .object({
    from: istDate("From"),
    to: istDate("To"),
    /** Counter code; empty / missing = all counters. */
    counter: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{0,8}$/, "Unknown counter.")
      .nullish()
      .transform((v) => v || null),
    group: z.enum(SALES_REPORT_GROUPS, { error: "Group by must be HSN or GST rate." }),
  })
  .check((ctx) => {
    const { from, to } = ctx.value;
    if (parseIstDate(from) === null || parseIstDate(to) === null) return;
    const days = istDaysInclusive(from, to);
    if (days < 1) {
      ctx.issues.push({ code: "custom", message: "From must be on or before To.", input: ctx.value, path: ["to"] });
    } else if (days > SALES_REPORT_MAX_DAYS) {
      ctx.issues.push({
        code: "custom",
        message: `Choose at most ${SALES_REPORT_MAX_DAYS} days (this range has ${days}).`,
        input: ctx.value,
        path: ["to"],
      });
    }
  });

export type SalesReportInput = z.input<typeof salesReportInputSchema>;
export type SalesReportQuery = z.output<typeof salesReportInputSchema>;

export type ParsedSalesReportInput = { ok: true; query: SalesReportQuery } | { ok: false; error: string };

export function parseSalesReportInput(input: unknown): ParsedSalesReportInput {
  const parsed = salesReportInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, query: parsed.data };
  return { ok: false, error: [...new Set(parsed.error.issues.map((i) => i.message))].join(" ") };
}

/** Sums for one group or the whole range. Money in paise; quantities in thousandths. */
export interface SalesSums {
  /** Distinct invoices. Group counts overlap (one bill can be in several groups); the total does not. */
  invoiceCount: number;
  lineCount: number;
  /** Lines sold by weight, kg × 1000. */
  qtyKgMilli: number;
  /** Other lines, pieces × 1000. */
  qtyPcsMilli: number;
  taxable: number;
  cgst: number;
  sgst: number;
  /** Before invoice round-off; = taxable + cgst + sgst. */
  lineTotal: number;
}

export interface SalesReportRow extends SalesSums {
  /** null = no HSN on the line (shown as "Unspecified"); always null when grouped by GST rate. */
  hsn: string | null;
  gstRate: number;
}

export interface SalesReport {
  from: string;
  to: string;
  /** null = all counters. */
  counter: string | null;
  group: SalesReportGroup;
  rows: SalesReportRow[];
  total: SalesSums;
}

export const hsnLabel = (hsn: string | null) => hsn ?? "Unspecified";

/** "0.375 kg · 4.5 pcs"; "—" when there is no quantity at all. */
export function quantityLabel(s: Pick<SalesSums, "qtyKgMilli" | "qtyPcsMilli">): string {
  const parts = [];
  if (s.qtyKgMilli) parts.push(`${formatQty(s.qtyKgMilli, true)} kg`);
  if (s.qtyPcsMilli) parts.push(`${formatQty(s.qtyPcsMilli, false)} pcs`);
  return parts.join(" · ") || "—";
}

// ---------------------------------------------------------------------------
// Quick ranges
// ---------------------------------------------------------------------------

export interface QuickRange {
  label: string;
  from: string;
  to: string;
}

/** Today, Yesterday, This month (1st to today), Last month (whole month). `today` in IST. */
export function quickRanges(today: string): QuickRange[] {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addIstDays(monthStart, -1);
  const yesterday = addIstDays(today, -1);
  return [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
  ];
}

// ---------------------------------------------------------------------------
// CSV (the rows on screen, then the totals row)
// ---------------------------------------------------------------------------

/** Query string of the CSV route for this report. */
export function salesReportCsvQuery(r: Pick<SalesReport, "from" | "to" | "counter" | "group">): string {
  const q = new URLSearchParams({ from: r.from, to: r.to, group: r.group });
  if (r.counter) q.set("counter", r.counter);
  return q.toString();
}

export function salesReportFilename(r: Pick<SalesReport, "from" | "to" | "counter" | "group">): string {
  const range = r.from === r.to ? r.from : `${r.from}_${r.to}`;
  return `sales-${r.group}-${range}${r.counter ? `-${r.counter}` : ""}.csv`;
}

function sumCells(s: SalesSums): CsvValue[] {
  return [
    s.invoiceCount,
    s.lineCount,
    formatQty(s.qtyKgMilli, true),
    formatQty(s.qtyPcsMilli, false),
    paiseToRupees(s.taxable),
    paiseToRupees(s.cgst),
    paiseToRupees(s.sgst),
    paiseToRupees(s.cgst + s.sgst),
    paiseToRupees(s.lineTotal),
  ];
}

/**
 * The whole file: BOM, header, one row per group in screen order, then "Total". Amounts in rupees
 * with 2 decimals; HSN always quoted so it stays text ("0401"). Missing HSN is "Unspecified".
 */
export function salesReportCsv(r: SalesReport): string {
  const byHsn = r.group === "hsn";
  const header = [
    ...(byHsn ? ["HSN"] : []),
    "GST Rate %",
    "Invoices",
    "Lines",
    "Qty (kg)",
    "Qty (pcs)",
    "Taxable Value",
    "CGST",
    "SGST",
    "Total GST",
    "Sales before round-off",
  ];
  const rows = r.rows.map((row) => [...(byHsn ? [quoted(hsnLabel(row.hsn))] : []), row.gstRate, ...sumCells(row)]);
  const total = [...(byHsn ? ["Total", ""] : ["Total"]), ...sumCells(r.total)];
  return CSV_BOM + [header, ...rows, total].map(csvRow).join("");
}
