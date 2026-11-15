import type { Invoice } from "@/lib/invoice";
import type { PrintWidth } from "@/lib/print-settings";
import { formatQtyWithUnit } from "@/lib/qty";
import { paymentLabel } from "@/components/billing/PaymentButtons";

/**
 * The printed invoice (REQUIREMENTS.md section 7): one document, two copies separated by a page
 * break. Everything on it comes from the invoice the server returned (create_invoice /
 * get_invoice), including the store snapshot taken when the invoice was issued — nothing is
 * recomputed or looked up on this device. Styles: src/app/print.css.
 */

const COPIES = ["CUSTOMER COPY", "STORE COPY"] as const;

const amountFormat = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Integer paise → "1,234.50" (no currency sign: lines up in columns). */
export function receiptAmount(paise: number): string {
  return amountFormat.format(paise / 100);
}

/** "+0.40" / "-0.49" / "0.00" — ASCII minus, which every receipt font has. */
function signedAmount(paise: number): string {
  if (paise === 0) return receiptAmount(0);
  return `${paise > 0 ? "+" : "-"}${receiptAmount(Math.abs(paise))}`;
}

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

/** "14/11/2026, 06:32 pm IST" */
export function receiptDateTime(iso: string | Date): string {
  return `${dateTimeFormat.format(new Date(iso))} IST`;
}

/** Half of a GST slab, for the CGST/SGST labels: 18 → "9%", 5 → "2.5%". */
function halfRate(gstRate: number): string {
  return `${gstRate / 2}%`;
}

export function Kv({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`r-kv ${className}`}>
      <span>{label}</span>
      <span className="r-kv-value">{value}</span>
    </div>
  );
}

export function Rule() {
  return <hr className="r-rule" />;
}

interface InvoiceReceiptProps {
  invoice: Invoice;
  width: PrintWidth;
  /** Printed again from Supabase (Reprint): adds a small "REPRINT" marker. */
  reprint: boolean;
}

export function InvoiceReceipt({ invoice, width, reprint }: InvoiceReceiptProps) {
  return (
    <div className="receipt" data-width={width}>
      {COPIES.map((label) => (
        <ReceiptCopy key={label} invoice={invoice} width={width} label={label} reprint={reprint} />
      ))}
    </div>
  );
}

function ReceiptCopy({ invoice, width, label, reprint }: InvoiceReceiptProps & { label: string }) {
  const { store } = invoice;

  return (
    <section className="receipt-copy">
      <p className="r-center r-bold">{label}</p>
      {reprint && <p className="r-center r-small">*** REPRINT ***</p>}

      <header className="r-center r-gap">
        <p className="r-store">{store.legalName}</p>
        <p className="r-pre">{store.address}</p>
        {store.phone && <p>Ph: {store.phone}</p>}
        <p className="r-bold">GSTIN: {store.gstin}</p>
        <p>
          State: {store.stateName} ({store.stateCode})
        </p>
      </header>

      <Rule />
      <p className="r-center r-title">TAX INVOICE</p>
      <Rule />

      <Kv label="Invoice No" value={invoice.invoiceNo} className="r-bold" />
      <Kv label="Date" value={receiptDateTime(invoice.createdAt)} />
      <Kv label="Counter" value={invoice.counterCode} />
      <Kv label="Cashier" value={invoice.cashierName} />

      <Rule />

      <table className="r-table">
        <thead>
          <tr>
            <th className="r-left">Item</th>
            <th className="r-num">Qty</th>
            <th className="r-num">Rate</th>
            <th className="r-num">Amount</th>
          </tr>
        </thead>
        {invoice.items.map((item) => (
          // One <tbody> per line keeps the name and its numbers together.
          <tbody key={item.lineNo} className="r-line">
            <tr>
              <td colSpan={4} className="r-name">
                {item.name}
              </td>
            </tr>
            <tr>
              <td />
              <td className="r-num">{formatQtyWithUnit(item.qtyMilli, item.soldByWeight)}</td>
              <td className="r-num">{receiptAmount(item.unitPrice)}</td>
              <td className="r-num">{receiptAmount(item.lineTotal)}</td>
            </tr>
          </tbody>
        ))}
      </table>

      <Rule />

      <p>
        Lines {invoice.itemCount} · Pcs {invoice.totalQty}
      </p>
      <Kv label="Sub total" value={receiptAmount(invoice.subtotal)} />
      <Kv label="Round off" value={signedAmount(invoice.roundOff)} />

      <div className="r-kv r-total">
        <span>TOTAL</span>
        <span className="r-kv-value">₹{receiptAmount(invoice.grandTotal)}</span>
      </div>
      <Kv label="Paid by" value={paymentLabel(invoice.paymentMethod)} className="r-bold" />

      <Rule />

      <TaxSummary invoice={invoice} width={width} />

      {store.footer && (
        <>
          <Rule />
          <p className="r-center r-pre">{store.footer}</p>
        </>
      )}
    </section>
  );
}

/** HSN / rate-wise GST summary (REQUIREMENTS.md section 3). Prices are GST-inclusive. */
function TaxSummary({ invoice, width }: { invoice: Invoice; width: PrintWidth }) {
  const totalGst = invoice.cgstTotal + invoice.sgstTotal;

  if (width === 58) {
    // Four amount columns don't fit 48mm at a readable size: one block per HSN/rate.
    return (
      <div>
        <p className="r-bold">GST summary (incl. in price)</p>
        {invoice.taxSummary.map((row) => (
          <div key={`${row.hsnCode ?? ""}|${row.gstRate}`} className="r-block">
            <p>
              {row.hsnCode ? `HSN ${row.hsnCode} · ` : ""}GST {row.gstRate}%
            </p>
            <Kv label="Taxable" value={receiptAmount(row.taxableValue)} className="r-indent" />
            <Kv label={`CGST ${halfRate(row.gstRate)}`} value={receiptAmount(row.cgst)} className="r-indent" />
            <Kv label={`SGST ${halfRate(row.gstRate)}`} value={receiptAmount(row.sgst)} className="r-indent" />
          </div>
        ))}
        <Kv label="Total GST" value={receiptAmount(totalGst)} className="r-bold" />
      </div>
    );
  }

  return (
    <div>
      <p className="r-bold">GST summary (incl. in price)</p>
      <table className="r-table">
        <thead>
          <tr>
            <th className="r-left">GST</th>
            <th className="r-num">Taxable</th>
            <th className="r-num">CGST</th>
            <th className="r-num">SGST</th>
          </tr>
        </thead>
        {invoice.taxSummary.map((row) => (
          <tbody key={`${row.hsnCode ?? ""}|${row.gstRate}`} className="r-line">
            {row.hsnCode && (
              <tr>
                <td colSpan={4} className="r-name r-small">
                  HSN {row.hsnCode}
                </td>
              </tr>
            )}
            <tr>
              <td className="r-left">{row.gstRate}%</td>
              <td className="r-num">{receiptAmount(row.taxableValue)}</td>
              <td className="r-num">{receiptAmount(row.cgst)}</td>
              <td className="r-num">{receiptAmount(row.sgst)}</td>
            </tr>
          </tbody>
        ))}
        <tfoot>
          <tr className="r-bold">
            <td className="r-left">Total</td>
            <td className="r-num">{receiptAmount(invoice.taxableTotal)}</td>
            <td className="r-num">{receiptAmount(invoice.cgstTotal)}</td>
            <td className="r-num">{receiptAmount(invoice.sgstTotal)}</td>
          </tr>
        </tfoot>
      </table>
      <Kv label="Total GST" value={receiptAmount(totalGst)} className="r-bold" />
    </div>
  );
}
