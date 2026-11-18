"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { getSalesReport } from "@/lib/report-actions";
import {
  SALES_REPORT_MAX_DAYS,
  hsnLabel,
  parseSalesReportInput,
  quantityLabel,
  quickRanges,
  salesReportCsvQuery,
  type SalesReport as Report,
  type SalesReportGroup,
  type SalesSums,
} from "@/lib/sales-report";
import { formatINR } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { fieldClasses, labelClasses } from "@/components/ui/Field";
import { tableStyles as tbl } from "@/components/ui/Table";
import { cx } from "@/components/ui/cx";
import { CounterSelect } from "@/components/invoices/CounterSelect";

interface Filters {
  from: string;
  to: string;
  /** Counter code; "" = all counters. */
  counter: string;
  group: SalesReportGroup;
}

const GROUPS: { value: SalesReportGroup; label: string }[] = [
  { value: "hsn", label: "HSN + GST rate" },
  { value: "gst", label: "GST rate" },
];

const dayFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayLabel = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));

function scopeLabel(r: Report): string {
  const range = r.from === r.to ? dayLabel(r.from) : `${dayLabel(r.from)} – ${dayLabel(r.to)}`;
  return `${range} · ${r.counter ? `Counter ${r.counter}` : "All counters"}`;
}

/** Taxable, CGST, SGST, Total GST, Sales before round-off. */
const amounts = (s: SalesSums) => [s.taxable, s.cgst, s.sgst, s.cgst + s.sgst, s.lineTotal];

export default function SalesReport({
  today,
  counterCodes,
  initial,
  initialError,
}: {
  today: string;
  counterCodes: string[];
  /** Today, all counters, by HSN (rendered by the page). */
  initial: Report | null;
  initialError: string | null;
}) {
  const [filters, setFilters] = useState<Filters>({ from: today, to: today, counter: "", group: "hsn" });
  const [report, setReport] = useState<Report | null>(initial);
  const [error, setError] = useState(initialError ?? "");
  const [pending, startTransition] = useTransition();
  /** Only the newest request may change the screen. */
  const latest = useRef(0);

  /** One sales_report() round trip for the whole range. */
  function load(next: Filters) {
    setFilters(next);
    const id = ++latest.current;
    const parsed = parseSalesReportInput(next);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await getSalesReport(next);
      if (id !== latest.current) return;
      startTransition(() => {
        if (result.success && result.data) setReport(result.data);
        else setError(result.error || "Could not load the sales report. Please retry.");
      });
    });
  }

  const byHsn = report?.group === "hsn";
  const headers = [...(byHsn ? ["HSN"] : []), "GST %", "Invoices", "Lines", "Quantity", "Taxable value", "CGST", "SGST", "Total GST", "Sales before round-off"];
  const field = fieldClasses({ className: "w-auto num" });
  const label = cx("flex flex-col gap-1.5", labelClasses);

  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-brand">SALES ANALYSIS</p><h1 className="font-display text-4xl font-extrabold">Sales reports</h1><p className="text-ink-muted">HSN and GST summaries from saved invoice lines, for a day or up to {SALES_REPORT_MAX_DAYS} days.</p></div><Link href="/invoices" className={buttonClasses({ variant: "secondary" })}>View invoices</Link></div>

    <form onSubmit={(e) => { e.preventDefault(); load(filters); }} className={cardClasses({ raised: false, className: "space-y-4 p-4" })}>
      <div className="flex flex-wrap items-end gap-4">
        <label className={label}>From (IST)<input className={field} type="date" required value={filters.from} max={today} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
        <label className={label}>To (IST)<input className={field} type="date" required value={filters.to} max={today} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
        <label className={label}>Counter<CounterSelect value={filters.counter} counterCodes={counterCodes} onChange={e => load({ ...filters, counter: e.target.value })} /></label>
        <button disabled={pending} className={buttonClasses({ variant: "primary", size: "sm", className: "px-5" })}>{pending ? "Loading sales…" : "Show report"}</button>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick ranges">
        {quickRanges(today).map(r => {
          const active = filters.from === r.from && filters.to === r.to;
          return <button key={r.label} type="button" aria-pressed={active} onClick={() => load({ ...filters, from: r.from, to: r.to })} className={buttonClasses({ variant: active ? "ink" : "secondary", size: "sm" })}>{r.label}</button>;
        })}
      </div>
    </form>

    {error && <p role="alert" className="rounded-lg border border-red-400 bg-red-50 p-4 text-red-800">{error}</p>}

    {report ? <div className={cx("space-y-6 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="num text-lg font-bold">{scopeLabel(report)}</h2><p className="text-sm text-ink-muted"><span className="num">{report.total.invoiceCount.toLocaleString("en-IN")}</span> invoices · <span className="num">{report.total.lineCount.toLocaleString("en-IN")}</span> sale lines</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 font-semibold" role="group" aria-label="Group by">Group by
            {GROUPS.map(g => <button key={g.value} type="button" aria-pressed={filters.group === g.value} onClick={() => load({ ...filters, group: g.value })} className={buttonClasses({ variant: filters.group === g.value ? "ink" : "secondary", size: "sm" })}>{g.label}</button>)}
          </div>
          {report.rows.length
            ? <a href={`/api/exports/sales-report?${salesReportCsvQuery(report)}`} download className={buttonClasses({ variant: "secondary", size: "sm", link: true })}><Download className="h-4 w-4" aria-hidden />Download report CSV</a>
            : <button type="button" disabled className={buttonClasses({ variant: "secondary", size: "sm" })}><Download className="h-4 w-4" aria-hidden />Download report CSV</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{([["Taxable sales", report.total.taxable], ["CGST", report.total.cgst], ["SGST", report.total.sgst], ["Sales before round-off", report.total.lineTotal]] as const).map(([name, value]) => <div key={name} className={cardClasses({ raised: false, className: "p-4" })}><p className="text-sm text-ink-muted">{name}</p><p className="num mt-2 text-xl font-bold">{formatINR(value)}</p></div>)}</div>

      {report.rows.length ? <div className={tbl.wrap}><table className={`${tbl.table} min-w-[1000px]`}>
        <thead className={tbl.thead}><tr>{headers.map(h => <th key={h} className={tbl.th}>{h}</th>)}</tr></thead>
        <tbody className={tbl.tbody}>{report.rows.map(g => <tr key={`${g.hsn}-${g.gstRate}`} className={tbl.tr}>{byHsn && <td className={cx(tbl.td, "num")}>{hsnLabel(g.hsn)}</td>}<td className={cx(tbl.td, "num")}>{g.gstRate}%</td><td className={cx(tbl.td, "num")}>{g.invoiceCount}</td><td className={cx(tbl.td, "num")}>{g.lineCount}</td><td className={cx(tbl.td, "num")}>{quantityLabel(g)}</td>{amounts(g).map((n, i) => <td key={i} className={`${tbl.td} num whitespace-nowrap`}>{formatINR(n)}</td>)}</tr>)}</tbody>
        <tfoot className={tbl.tfoot}><tr><td className={tbl.td} colSpan={byHsn ? 2 : 1}>Total</td><td className={cx(tbl.td, "num")}>{report.total.invoiceCount}</td><td className={cx(tbl.td, "num")}>{report.total.lineCount}</td><td className={cx(tbl.td, "num")}>{quantityLabel(report.total)}</td>{amounts(report.total).map((n, i) => <td key={i} className={`${tbl.td} num whitespace-nowrap`}>{formatINR(n)}</td>)}</tr></tfoot>
      </table></div> : <p className="rounded-lg border border-dashed border-ink/30 p-10 text-center">No sales for these dates and counter.</p>}

      <p className="text-sm text-ink-muted">Sales are the sum of invoice lines, before invoice round-off: taxable value, CGST, SGST and the invoice count match the Invoices page for the same day and counter; its grand total also includes round-off. One invoice can appear in several groups, so group invoice counts overlap; the Total counts each invoice once. Missing HSN codes appear as Unspecified. Quantity is kg for items sold by weight and pieces for everything else. The CSV has exactly these rows and the Total.</p>
    </div> : !pending && !error && <div className="rounded-lg border border-dashed border-ink/30 p-12 text-center text-ink-muted">Choose dates and show a report to view sales by HSN or GST rate.</div>}
  </div>;
}
