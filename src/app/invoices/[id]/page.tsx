import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PageLoading from "@/components/PageLoading";
import { ReprintButton } from "@/components/invoices/ReprintButton";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { tableStyles as tbl } from "@/components/ui/Table";
import { cx } from "@/components/ui/cx";
import { requireStaffForPage } from "@/lib/auth";
import { paymentLabel } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import { formatLinesAndPieces, formatQty, isFractionalPieces } from "@/lib/qty";
import type { AuditedInvoice, Invoice } from "@/lib/invoice";
import { getInvoiceForHistory, type HistoryInvoice } from "@/lib/invoice-history";
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
  if (one(sp.edited) === "1") q.set("edited", "1"); // ignored for cashiers by the list page
  if (one(sp.fraction) === "1") q.set("fraction", "1"); // likewise
  const s = q.toString();
  return `/invoices${s ? `?${s}` : ""}`;
}

async function InvoiceDetail({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const staff = await requireStaffForPage();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const back = backHref(sp);

  let found: HistoryInvoice | null = null;
  let error: string | null = null;
  try {
    found = await getInvoiceForHistory(staff, id);
  } catch (err: unknown) {
    console.error("Invoice detail failed", err);
    error = err instanceof Error ? err.message : "Could not load the invoice.";
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <Link
        href={back}
        className={buttonClasses({ variant: "ghost", size: "sm", link: true, className: "-ml-1 px-2" })}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to invoices
      </Link>

      {error ? (
        <Alert tone="danger" role="alert">
          <p className="text-base font-semibold">{error}</p>
        </Alert>
      ) : !found ? (
        <div className="rounded-card border border-dashed border-ink/50 bg-surface p-10 text-center">
          <p className="font-display text-2xl font-bold">Invoice not found</p>
          {staff.role !== "admin" && (
            <p className="mt-1 text-sm text-ink-muted">Cashiers can open today&apos;s invoices of their own counter.</p>
          )}
        </div>
      ) : (
        <InvoiceView
          invoice={found.invoice}
          // Admins only: the server never loads the edit fields into a cashier's page.
          audit={found.audited ? found.invoice : null}
          printWidthMm={staff.counter?.printWidthMm ?? null}
        />
      )}
    </div>
  );
}

function InvoiceView({
  invoice,
  audit,
  printWidthMm,
}: {
  invoice: Invoice;
  /** The same invoice with its audit fields (price edit, fraction flag); null for cashiers. */
  audit: AuditedInvoice | null;
  printWidthMm: 58 | 80 | null;
}) {
  const edited = audit?.hasPriceEdit === true;
  const editedLines = new Map((audit?.items ?? []).filter((it) => it.priceEdited).map((it) => [it.lineNo, it]));
  // Admins only: lines not sold by weight with a fractional qty (REQUIREMENTS.md section 17).
  const fractional = audit?.hasFractionalQty === true;
  const fractionLines = new Set(audit ? invoice.items.filter(isFractionalPieces).map((it) => it.lineNo) : []);
  const facts = [
    { label: "Date & time (IST)", value: dateTimeFormat.format(new Date(invoice.createdAt)), num: true },
    { label: "Counter", value: invoice.counterCode },
    { label: "Cashier", value: invoice.cashierName },
    { label: "Payment", value: paymentLabel(invoice.paymentMethod) },
  ];

  return (
    <>
      <section className={cardClasses({ strong: true, className: "flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between" })}>
        <div className="min-w-0 space-y-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold tracking-wide text-brand uppercase">
              Tax invoice
              {edited && <Badge tone="warning">Edited</Badge>}
              {fractional && <Badge tone="warning">Fraction</Badge>}
            </p>
            <h1 className="font-mono text-2xl font-extrabold break-all tabular-nums sm:text-3xl">{invoice.invoiceNo}</h1>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-xs font-bold tracking-wide text-ink-muted uppercase">{f.label}</dt>
                <dd className={cx("font-semibold", f.num && "num")}>{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:items-end">
          <p className="font-display text-4xl leading-none font-extrabold tabular-nums">{formatINR(invoice.grandTotal)}</p>
          <ReprintButton invoiceId={invoice.id} printWidthMm={printWidthMm} />
        </div>
      </section>

      <section aria-labelledby="lines-heading" className="space-y-2">
        <h2 id="lines-heading" className="text-lg font-bold">
          Items <span className="num text-sm font-normal text-ink-muted">({formatLinesAndPieces(invoice.itemCount, invoice.totalQtyMilli)})</span>
        </h2>
        {edited && (
          <p className="text-sm text-ink-muted">
            The price was changed on this bill for{" "}
            <span className="num">{editedLines.size}</span> {editedLines.size === 1 ? "line" : "lines"}: Rate is the price
            charged, with the catalog price below it. The receipt shows only the charged rate.
          </p>
        )}
        {fractionLines.size > 0 && (
          <p className="text-sm text-ink-muted">
            <span className="num">{fractionLines.size}</span> {fractionLines.size === 1 ? "line" : "lines"} sold by the piece{" "}
            {fractionLines.size === 1 ? "has" : "have"} a fractional quantity (highlighted). The receipt shows the quantity
            with no marker.
          </p>
        )}
        <div className={tbl.wrap}>
          <table className={cx(tbl.table, "min-w-[860px]")}>
            <thead className={tbl.thead}>
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
            <tbody className={tbl.tbody}>
              {invoice.items.map((it) => (
                <tr key={it.lineNo} className={cx(tbl.tr, fractionLines.has(it.lineNo) && "bg-warning-soft")}>
                  <td className="num px-3 py-2.5 text-ink-muted">{it.lineNo}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-bold">{it.name}</p>
                    <p className="text-sm text-ink-muted">
                      <span className="font-mono">{it.itemCode}</span>
                      {it.mrp !== null && (
                        <>
                          {" · MRP "}
                          <span className="num">{formatINR(it.mrp)}</span>
                        </>
                      )}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{it.hsnCode ?? "—"}</td>
                  <td className="num px-3 py-2.5 text-right">{it.gstRate}%</td>
                  <td className="num px-3 py-2.5 text-right">
                    {it.soldByWeight ? (
                      <>
                        {formatQty(it.qtyMilli, true)} <span className="text-xs text-ink-muted">kg</span>
                      </>
                    ) : (
                      <>
                        <span className={cx(fractionLines.has(it.lineNo) && "font-bold")}>{formatQty(it.qtyMilli, false)}</span>{" "}
                        <span className="text-xs text-ink-muted">{it.uom}</span>
                      </>
                    )}
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    <PriceCell charged={it.unitPrice} catalog={editedLines.get(it.lineNo)?.catalogPrice ?? null} />
                  </td>
                  <td className="num px-3 py-2.5 text-right font-bold">{formatINR(it.lineTotal)}</td>
                  <td className="num px-3 py-2.5 text-right">{formatINR(it.taxableValue)}</td>
                  <td className="num px-3 py-2.5 text-right">{formatINR(it.cgst)}</td>
                  <td className="num px-3 py-2.5 text-right">{formatINR(it.sgst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="tax-heading" className="space-y-2">
          <h2 id="tax-heading" className="text-lg font-bold">
            Tax summary <span className="text-sm font-normal text-ink-muted">(GST included in prices)</span>
          </h2>
          <div className={tbl.wrap}>
            <table className={cx(tbl.table, "min-w-[520px]")}>
              <thead className={tbl.thead}>
                <tr>
                  <th className="px-3 py-2.5 text-left">HSN</th>
                  <th className="px-3 py-2.5 text-right">GST</th>
                  <th className="px-3 py-2.5 text-right">Taxable</th>
                  <th className="px-3 py-2.5 text-right">CGST</th>
                  <th className="px-3 py-2.5 text-right">SGST</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className={tbl.tbody}>
                {invoice.taxSummary.map((row) => (
                  <tr key={`${row.hsnCode ?? ""}|${row.gstRate}`} className={tbl.tr}>
                    <td className="px-3 py-2.5 font-mono text-xs">{row.hsnCode ?? "—"}</td>
                    <td className="num px-3 py-2.5 text-right">
                      {row.gstRate}%{" "}
                      <span className="text-xs text-ink-muted">
                        ({row.gstRate / 2}% + {row.gstRate / 2}%)
                      </span>
                    </td>
                    <td className="num px-3 py-2.5 text-right">{formatINR(row.taxableValue)}</td>
                    <td className="num px-3 py-2.5 text-right">{formatINR(row.cgst)}</td>
                    <td className="num px-3 py-2.5 text-right">{formatINR(row.sgst)}</td>
                    <td className="num px-3 py-2.5 text-right">{formatINR(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className={tbl.tfoot}>
                <tr>
                  <td className="px-3 py-2.5" colSpan={2}>
                    Total
                  </td>
                  <td className="num px-3 py-2.5 text-right">{formatINR(invoice.taxableTotal)}</td>
                  <td className="num px-3 py-2.5 text-right">{formatINR(invoice.cgstTotal)}</td>
                  <td className="num px-3 py-2.5 text-right">{formatINR(invoice.sgstTotal)}</td>
                  <td className="num px-3 py-2.5 text-right">{formatINR(invoice.subtotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section aria-labelledby="totals-heading" className="space-y-2">
          <h2 id="totals-heading" className="text-lg font-bold">
            Totals
          </h2>
          <dl className={cardClasses({ className: "space-y-1.5 p-4 text-sm" })}>
            <TotalRow label="Sub total" value={formatINR(invoice.subtotal)} />
            <TotalRow label="Taxable value" value={formatINR(invoice.taxableTotal)} />
            <TotalRow label="CGST" value={formatINR(invoice.cgstTotal)} />
            <TotalRow label="SGST" value={formatINR(invoice.sgstTotal)} />
            <TotalRow label="Round off" value={formatINR(invoice.roundOff)} />
            <div className="flex items-baseline justify-between border-t border-ink pt-2 font-display text-2xl leading-tight font-extrabold">
              <dt>Grand total</dt>
              <dd className="tabular-nums">{formatINR(invoice.grandTotal)}</dd>
            </div>
          </dl>
          <p className="text-sm text-ink-muted">
            Issued by {invoice.store.legalName} · GSTIN {invoice.store.gstin}
          </p>
        </section>
      </div>
    </>
  );
}

/** Rate; for an edited line (admins only) the catalog price under it. */
function PriceCell({ charged, catalog }: { charged: number; catalog: number | null }) {
  if (catalog === null) return <>{formatINR(charged)}</>;
  const diff = charged - catalog;
  return (
    <span className="inline-flex flex-col items-end">
      <span className="flex items-center gap-1.5">
        <Badge tone="warning">Edited</Badge>
        <span className="font-bold">{formatINR(charged)}</span>
      </span>
      <span className="text-xs text-ink-muted">
        catalog <span className="line-through">{formatINR(catalog)}</span> ({diff > 0 ? "+" : "−"}
        {formatINR(Math.abs(diff))})
      </span>
    </span>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="num font-semibold">{value}</dd>
    </div>
  );
}
