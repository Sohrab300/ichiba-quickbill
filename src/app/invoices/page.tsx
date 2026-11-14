import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, FileText } from "lucide-react";
import PageLoading from "@/components/PageLoading";
import { InvoiceFiltersForm } from "@/components/invoices/InvoiceFiltersForm";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { tableStyles as tbl } from "@/components/ui/Table";
import { cx } from "@/components/ui/cx";
import { requireStaffForPage, type StaffContext } from "@/lib/auth";
import { PAYMENT_METHODS, paymentLabel } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import { todayIst } from "@/lib/ist-date";
import {
  INVOICES_PAGE_SIZE,
  filtersQuery,
  getDayTotals,
  listCounters,
  listInvoices,
  resolveInvoiceFilters,
  type DayTotals,
  type InvoiceFilters,
  type InvoiceListPage,
} from "@/lib/invoice-history";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Invoices searchParams={searchParams} />
    </Suspense>
  );
}

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

const longDate = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const shortDate = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

/** "Sun, 15 Nov 2026" for a YYYY-MM-DD date. */
function dateLabel(date: string): string {
  return longDate.format(new Date(`${date}T00:00:00Z`));
}

async function Invoices({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaffForPage();
  const params = await searchParams;

  let data;
  let error: string | null = null;
  try {
    const counters = staff.role === "admin" ? await listCounters() : [];
    const filters = resolveInvoiceFilters(staff, params, counters);
    const [list, totals] = await Promise.all([listInvoices(filters), getDayTotals(filters)]);
    data = { filters, counterCodes: counters.map((c) => c.code), list, totals };
  } catch (err: unknown) {
    console.error("Invoices page failed", err);
    error = err instanceof Error ? err.message : "Could not load invoices.";
  }

  const content = data ? (
    <InvoicesView staff={staff} {...data} />
  ) : (
    <Alert tone="danger" role="alert">
      <p className="text-base font-semibold">{error ?? "Could not load invoices."}</p>
    </Alert>
  );

  return <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6">{content}</div>;
}

function InvoicesView({
  staff,
  filters,
  counterCodes,
  list,
  totals,
}: {
  staff: StaffContext;
  filters: InvoiceFilters;
  counterCodes: string[];
  list: InvoiceListPage;
  totals: DayTotals;
}) {
  const isAdmin = staff.role === "admin";
  const today = todayIst();
  const exportQuery = `?date=${filters.date}${filters.counter ? `&counter=${encodeURIComponent(filters.counter.code)}` : ""}`;
  // The date in the num face (plain 0); the counter code stays in the body face.
  const scope = (
    <>
      <span className="num">{dateLabel(filters.date)}</span>
      {filters.date === today ? " (today)" : ""} · {filters.counter ? `Counter ${filters.counter.code}` : "All counters"}
    </>
  );

  return (
    <>
      <PageHeader
        title="Invoices"
        description={scope}
        actions={
          isAdmin && (
            <div className="flex flex-wrap gap-2">
              <ExportLink href={`/api/exports/daily-summary${exportQuery}`} label="Summary CSV" />
              <ExportLink href={`/api/exports/daily-lines${exportQuery}`} label="Lines CSV" />
            </div>
          )
        }
      />

      <InvoiceFiltersForm
        key={`${filters.date}|${filters.counter?.code ?? ""}|${filters.search}`}
        date={filters.date}
        counterCode={filters.counter?.code ?? null}
        search={filters.search}
        counterCodes={counterCodes}
        locked={filters.locked}
        today={today}
      />

      <DayTotalsPanel
        totals={totals}
        caption={filters.allDates ? <>Day totals for {scope}. The search below covers all dates.</> : null}
      />

      <InvoiceTable filters={filters} list={list} />
    </>
  );
}

function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className={buttonClasses({ variant: "secondary", size: "sm", link: true, className: "px-4" })}
    >
      <Download className="h-4 w-4" aria-hidden />
      {label}
    </a>
  );
}

function DayTotalsPanel({ totals, caption }: { totals: DayTotals; caption: React.ReactNode }) {
  const tiles = [
    { label: "Invoices", value: totals.invoiceCount.toLocaleString("en-IN") },
    { label: "Taxable value", value: formatINR(totals.taxableTotal) },
    { label: "CGST", value: formatINR(totals.cgstTotal) },
    { label: "SGST", value: formatINR(totals.sgstTotal) },
  ];

  return (
    <section aria-label="Day totals" className="space-y-3">
      {caption && <p className="text-sm font-semibold text-ink-muted">{caption}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className={cardClasses({ raised: false, className: "p-3" })}>
            <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">{t.label}</p>
            <p className="num mt-1 text-lg font-bold">{t.value}</p>
          </div>
        ))}
        <div className="col-span-2 rounded-card border-strong border-ink bg-brand p-3 text-paper shadow-hard md:col-span-1">
          <p className="text-xs font-bold tracking-wide uppercase">Grand total</p>
          <p className="mt-1 font-display text-3xl leading-none font-extrabold tabular-nums">{formatINR(totals.grandTotal)}</p>
          <p className="mt-1 text-xs">
            Round off <span className="num">{formatINR(totals.roundOff)}</span>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PAYMENT_METHODS.map((m) => {
          const t = totals.byPaymentMethod[m];
          return (
            <div
              key={m}
              className={cardClasses({ raised: false, className: "flex items-baseline justify-between gap-3 px-3 py-2" })}
            >
              <p className="font-semibold">
                {paymentLabel(m)}{" "}
                <span className="text-sm font-normal text-ink-muted">
                  <span className="num">{t.invoiceCount}</span> {t.invoiceCount === 1 ? "invoice" : "invoices"}
                </span>
              </p>
              <p className="num font-bold">{formatINR(t.grandTotal)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InvoiceTable({ filters, list }: { filters: InvoiceFilters; list: InvoiceListPage }) {
  if (list.rows.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-ink/50 bg-surface p-10 text-center">
        <FileText className="mx-auto h-8 w-8 text-ink-muted" aria-hidden />
        <p className="mt-2 font-semibold text-ink">
          {list.total === null
            ? "This page is past the last invoice."
            : filters.locked && !filters.counter
              ? "This login has no counter."
              : filters.search
                ? `No invoice number contains “${filters.search}”${filters.allDates ? " on any date" : " for this day"}.`
                : "No invoices for this day."}
        </p>
        {list.total === null && (
          <Link href={`/invoices${filtersQuery(filters, 1)}`} className="mt-3 inline-block font-bold text-brand underline underline-offset-2 hover:text-brand-hover">
            Go to the first page
          </Link>
        )}
      </div>
    );
  }

  const total = list.total ?? 0;
  const start = (filters.page - 1) * INVOICES_PAGE_SIZE + 1;
  const end = start + list.rows.length - 1;
  const hasPrev = filters.page > 1;
  const hasNext = end < total;
  const detailQuery = filtersQuery(filters);

  return (
    <section aria-label="Invoices" className="space-y-3">
      <div className={tbl.wrap}>
        <table className={cx(tbl.table, "min-w-[640px]")}>
          <thead className={tbl.thead}>
            <tr>
              <th className={tbl.th}>Invoice no</th>
              {filters.allDates && <th className={tbl.th}>Date</th>}
              <th className={tbl.th}>Time (IST)</th>
              <th className={tbl.th}>Counter</th>
              <th className={tbl.th}>Cashier</th>
              <th className={tbl.th}>Payment</th>
              <th className={cx(tbl.th, "text-right")}>Total</th>
            </tr>
          </thead>
          <tbody className={tbl.tbody}>
            {list.rows.map((r) => (
              <tr key={r.id} className={cx("relative", tbl.tr, tbl.trHover)}>
                <td className="px-3 py-3 font-mono font-bold tabular-nums">
                  {/* The link covers the whole row (after:absolute). */}
                  <Link href={`/invoices/${r.id}${detailQuery}`} className="after:absolute after:inset-0 hover:underline">
                    {r.invoiceNo}
                  </Link>
                </td>
                {filters.allDates && (
                  <td className="num px-3 py-3 whitespace-nowrap">{shortDate.format(new Date(r.createdAt))}</td>
                )}
                <td className="num px-3 py-3 whitespace-nowrap">{timeFormat.format(new Date(r.createdAt))}</td>
                <td className="px-3 py-3">{r.counterCode}</td>
                <td className="px-3 py-3">{r.cashierName}</td>
                <td className="px-3 py-3">{paymentLabel(r.paymentMethod)}</td>
                <td className="num px-3 py-3 text-right font-bold">{formatINR(r.grandTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
        <p className="text-ink-muted">
          <span className="num">
            {start}–{end}
          </span>{" "}
          of <span className="num">{total.toLocaleString("en-IN")}</span>
          {filters.search && ` matching “${filters.search}”`}
          {filters.allDates && " (all dates)"}
        </p>
        <div className="flex gap-2">
          <PageLink href={hasPrev ? `/invoices${filtersQuery(filters, filters.page - 1)}` : null} label="Previous">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </PageLink>
          <PageLink href={hasNext ? `/invoices${filtersQuery(filters, filters.page + 1)}` : null} label="Next" iconAfter>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </PageLink>
        </div>
      </nav>
    </section>
  );
}

function PageLink({
  href,
  label,
  iconAfter = false,
  children,
}: {
  href: string | null;
  label: string;
  iconAfter?: boolean;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <span
        aria-disabled
        className="inline-flex h-11 cursor-not-allowed items-center gap-1 rounded-control border border-ink-muted px-4 font-bold text-ink-muted opacity-70"
      >
        {!iconAfter && children}
        {label}
        {iconAfter && children}
      </span>
    );
  }
  return (
    <Link href={href} className={buttonClasses({ variant: "secondary", size: "sm", link: true, className: "gap-1 px-4" })}>
      {!iconAfter && children}
      {label}
      {iconAfter && children}
    </Link>
  );
}
