import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PageLoading from "@/components/PageLoading";
import { ReprintButton } from "@/components/invoices/ReprintButton";
import { requireStaffForPage } from "@/lib/auth";
import { paymentLabel } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import type { Invoice } from "@/lib/invoice";
import { getInvoiceForHistory } from "@/lib/invoice-history";
import { toInvoiceNoSearchTerm } from "@/lib/invoice-search";
import { parseIstDate } from "@/lib/ist-date";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function InvoiceDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageLoading />}>
      <InvoiceDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

/** The list filters the user came from, re-validated (only known keys and safe values). */
function backHref(sp: Record<string, string | string[] | undefined>): string {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = new URLSearchParams();
  const date = parseIstDate(one(sp.date));
  if (date) q.set("date", date);
  const counter = one(sp.counter).toUpperCase();
  if (/^[A-Z0-9]{1,8}$/.test(counter)) q.set("counter", counter);
  const search = toInvoiceNoSearchTerm(one(sp.q));
  if (search) q.set("q", search);
  const page = Number(one(sp.page));
  if (Number.isInteger(page) && page > 1 && page <= 10_000) q.set("page", String(page));
  const s = q.toString();
  return `/invoices${s ? `?${s}` : ""}`;
}

async function InvoiceDetail({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const staff = await requireStaffForPage();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const back = backHref(sp);

  let invoice: Invoice | null = null;
  let error: string | null = null;
  try {
    invoice = await getInvoiceForHistory(staff, id);
  } catch (err: unknown) {
    console.error("Invoice detail failed", err);
    error = err instanceof Error ? err.message : "Could not load the invoice.";
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <Link
        href={back}
        className="inline-flex h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to invoices
      </Link>

      {error ? (
        <p role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4 font-medium text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      ) : !invoice ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-lg font-semibold">Invoice not found</p>
          {staff.role !== "admin" && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Cashiers can open today&apos;s invoices of their own counter.</p>
          )}
        </div>
      ) : (
        <InvoiceView invoice={invoice} printWidthMm={staff.counter?.printWidthMm ?? null} />
      )}
    </div>
  );
}

function InvoiceView({ invoice, printWidthMm }: { invoice: Invoice; printWidthMm: 58 | 80 | null }) {
  const facts = [
    { label: "Date & time (IST)", value: dateTimeFormat.format(new Date(invoice.createdAt)) },
    { label: "Counter", value: invoice.counterCode },
    { label: "Cashier", value: invoice.cashierName },
    { label: "Payment", value: paymentLabel(invoice.paymentMethod) },
  ];

  return (
    <>
      <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between dark:border-zinc-800 dark:bg-zinc-900">
        <div className="min-w-0 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tax invoice</p>
            <h1 className="break-all font-mono text-2xl font-extrabold">{invoice.invoiceNo}</h1>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">{f.label}</dt>
                <dd className="font-semibold">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:items-end">
          <p className="text-3xl font-extrabold tabular-nums">{formatINR(invoice.grandTotal)}</p>
          <ReprintButton invoiceId={invoice.id} printWidthMm={printWidthMm} />
        </div>
      </section>

      <section aria-labelledby="lines-heading" className="space-y-2">
        <h2 id="lines-heading" className="text-lg font-bold">
          Items <span className="text-sm font-normal text-zinc-500">({invoice.itemCount} lines · qty {invoice.totalQty})</span>
        </h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-zinc-100 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2.5 text-left">#</th>
                <th className="px-3 py-2.5 text-left">Item</th>
                <th className="px-3 py-2.5 text-left">HSN</th>
                <th className="px-3 py-2.5 text-right">GST</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-right">Rate</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-3 py-2.5 text-right">Taxable</th>
                <th className="px-3 py-2.5 text-right">CGST</th>
                <th className="px-3 py-2.5 text-right">SGST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {invoice.items.map((it) => (
                <tr key={it.lineNo}>
                  <td className="px-3 py-2.5 tabular-nums text-zinc-500">{it.lineNo}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold">{it.name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {it.itemCode}
                      {it.mrp !== null && ` · MRP ${formatINR(it.mrp)}`}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{it.hsnCode ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{it.gstRate}%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {it.qty} <span className="text-xs text-zinc-500">{it.uom}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(it.unitPrice)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatINR(it.lineTotal)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(it.taxableValue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(it.cgst)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(it.sgst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="tax-heading" className="space-y-2">
          <h2 id="tax-heading" className="text-lg font-bold">
            Tax summary <span className="text-sm font-normal text-zinc-500">(GST included in prices)</span>
          </h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-zinc-100 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2.5 text-left">HSN</th>
                  <th className="px-3 py-2.5 text-right">GST</th>
                  <th className="px-3 py-2.5 text-right">Taxable</th>
                  <th className="px-3 py-2.5 text-right">CGST</th>
                  <th className="px-3 py-2.5 text-right">SGST</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {invoice.taxSummary.map((row) => (
                  <tr key={`${row.hsnCode ?? ""}|${row.gstRate}`}>
                    <td className="px-3 py-2.5 font-mono text-xs">{row.hsnCode ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {row.gstRate}%{" "}
                      <span className="text-xs text-zinc-500">
                        ({row.gstRate / 2}% + {row.gstRate / 2}%)
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(row.taxableValue)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(row.cgst)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(row.sgst)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-zinc-300 font-bold dark:border-zinc-700">
                <tr>
                  <td className="px-3 py-2.5" colSpan={2}>
                    Total
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(invoice.taxableTotal)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(invoice.cgstTotal)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(invoice.sgstTotal)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(invoice.subtotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section aria-labelledby="totals-heading" className="space-y-2">
          <h2 id="totals-heading" className="text-lg font-bold">
            Totals
          </h2>
          <dl className="space-y-1.5 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <TotalRow label="Sub total" value={formatINR(invoice.subtotal)} />
            <TotalRow label="Taxable value" value={formatINR(invoice.taxableTotal)} />
            <TotalRow label="CGST" value={formatINR(invoice.cgstTotal)} />
            <TotalRow label="SGST" value={formatINR(invoice.sgstTotal)} />
            <TotalRow label="Round off" value={formatINR(invoice.roundOff)} />
            <div className="flex items-baseline justify-between border-t-2 border-zinc-300 pt-2 text-lg font-extrabold dark:border-zinc-700">
              <dt>Grand total</dt>
              <dd className="tabular-nums">{formatINR(invoice.grandTotal)}</dd>
            </div>
          </dl>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Issued by {invoice.store.legalName} · GSTIN {invoice.store.gstin}
          </p>
        </section>
      </div>
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
