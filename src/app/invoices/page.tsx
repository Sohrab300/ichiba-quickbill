import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, FileText } from "lucide-react";
import PageLoading from "@/components/PageLoading";
import { InvoiceFiltersForm } from "@/components/invoices/InvoiceFiltersForm";
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
    <p role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4 font-medium text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      {error ?? "Could not load invoices."}
    </p>
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
  const scope = `${dateLabel(filters.date)}${filters.date === today ? " (today)" : ""} · ${
    filters.counter ? `Counter ${filters.counter.code}` : "All counters"
  }`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Invoices</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{scope}</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <ExportLink href={`/api/exports/daily-summary${exportQuery}`} label="Summary CSV" />
            <ExportLink href={`/api/exports/daily-lines${exportQuery}`} label="Lines CSV" />
          </div>
        )}
      </div>

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
        caption={filters.allDates ? `Day totals for ${scope}. The search below covers all dates.` : null}
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
      className="flex h-11 items-center gap-2 rounded-lg border-2 border-zinc-300 bg-white px-4 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      <Download className="h-4 w-4" aria-hidden />
      {label}
    </a>
  );
}

function DayTotalsPanel({ totals, caption }: { totals: DayTotals; caption: string | null }) {
  const tiles = [
    { label: "Invoices", value: totals.invoiceCount.toLocaleString("en-IN") },
    { label: "Taxable value", value: formatINR(totals.taxableTotal) },
    { label: "CGST", value: formatINR(totals.cgstTotal) },
    { label: "SGST", value: formatINR(totals.sgstTotal) },
  ];

  return (
    <section aria-label="Day totals" className="space-y-3">
      {caption && <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{caption}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{t.value}</p>
          </div>
        ))}
        <div className="col-span-2 rounded-xl border-2 border-emerald-600 bg-emerald-50 p-3 md:col-span-1 dark:bg-emerald-950/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Grand total</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{formatINR(totals.grandTotal)}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Round off {formatINR(totals.roundOff)}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PAYMENT_METHODS.map((m) => {
          const t = totals.byPaymentMethod[m];
          return (
            <div
              key={m}
              className="flex items-baseline justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <p className="font-semibold">
                {paymentLabel(m)}{" "}
                <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
                  {t.invoiceCount} {t.invoiceCount === 1 ? "invoice" : "invoices"}
                </span>
              </p>
              <p className="font-bold tabular-nums">{formatINR(t.grandTotal)}</p>
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
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <FileText className="mx-auto h-8 w-8 text-zinc-400" aria-hidden />
        <p className="mt-2 font-medium text-zinc-700 dark:text-zinc-300">
          {list.total === null
            ? "This page is past the last invoice."
            : filters.locked && !filters.counter
              ? "This login has no counter."
              : filters.search
                ? `No invoice number contains “${filters.search}”${filters.allDates ? " on any date" : " for this day"}.`
                : "No invoices for this day."}
        </p>
        {list.total === null && (
          <Link href={`/invoices${filtersQuery(filters, 1)}`} className="mt-3 inline-block font-semibold text-emerald-700 hover:underline">
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
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2.5">Invoice no</th>
              {filters.allDates && <th className="px-3 py-2.5">Date</th>}
              <th className="px-3 py-2.5">Time (IST)</th>
              <th className="px-3 py-2.5">Counter</th>
              <th className="px-3 py-2.5">Cashier</th>
              <th className="px-3 py-2.5">Payment</th>
              <th className="px-3 py-2.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {list.rows.map((r) => (
              <tr key={r.id} className="relative hover:bg-emerald-50 dark:hover:bg-emerald-950/30">
                <td className="px-3 py-3 font-mono font-bold">
                  {/* The link covers the whole row (after:absolute). */}
                  <Link href={`/invoices/${r.id}${detailQuery}`} className="after:absolute after:inset-0 hover:underline">
                    {r.invoiceNo}
                  </Link>
                </td>
                {filters.allDates && (
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{shortDate.format(new Date(r.createdAt))}</td>
                )}
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{timeFormat.format(new Date(r.createdAt))}</td>
                <td className="px-3 py-3">{r.counterCode}</td>
                <td className="px-3 py-3">{r.cashierName}</td>
                <td className="px-3 py-3">{paymentLabel(r.paymentMethod)}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatINR(r.grandTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
        <p className="text-zinc-600 dark:text-zinc-400">
          {start}–{end} of {total.toLocaleString("en-IN")}
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
  const className =
    "flex h-11 items-center gap-1 rounded-lg border-2 border-zinc-300 px-4 font-semibold dark:border-zinc-700";
  if (!href) {
    return (
      <span aria-disabled className={`${className} cursor-not-allowed opacity-40`}>
        {!iconAfter && children}
        {label}
        {iconAfter && children}
      </span>
    );
  }
  return (
    <Link href={href} className={`${className} bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800`}>
      {!iconAfter && children}
      {label}
      {iconAfter && children}
    </Link>
  );
}
