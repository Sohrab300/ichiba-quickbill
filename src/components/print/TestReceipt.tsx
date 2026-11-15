import type { PrintWidth } from "@/lib/print-settings";
import { Kv, Rule, receiptAmount, receiptDateTime } from "./InvoiceReceipt";

/**
 * Printer test page: same fonts, widths and two-page structure as a real invoice, so it shows
 * whether the edges are cut off, the text is dark enough and the driver cuts between pages.
 * Contains no store or sale data.
 */
export function TestReceipt({ width, printedAt }: { width: PrintWidth; printedAt: Date }) {
  return (
    <div className="receipt" data-width={width}>
      {[1, 2].map((page) => (
        <section key={page} className="receipt-copy">
          <p className="r-center r-title">PRINTER TEST</p>
          <p className="r-center r-bold">Page {page} of 2</p>
          <Rule />
          <Kv label="Paper" value={`${width} mm`} />
          <Kv label="Printed" value={receiptDateTime(printedAt)} />
          <Rule />
          <p className="r-small">Both edges of this box must be fully visible:</p>
          <div className="r-edges">
            <span>|&lt;</span>
            <span>{width === 58 ? "48 mm" : "72 mm"}</span>
            <span>&gt;|</span>
          </div>
          <p className="r-name">0123456789012345678901234567890123456789</p>
          <p className="r-name">
            A long product name wraps onto the next line instead of being cut off at the edge
          </p>
          <table className="r-table">
            <thead>
              <tr>
                <th className="r-left">Item</th>
                <th className="r-num">Qty</th>
                <th className="r-num">Rate</th>
                <th className="r-num">Amount</th>
              </tr>
            </thead>
            <tbody className="r-line">
              <tr>
                <td colSpan={4} className="r-name">
                  SAMPLE ITEM
                </td>
              </tr>
              <tr>
                <td />
                <td className="r-num">12</td>
                <td className="r-num">{receiptAmount(123450)}</td>
                <td className="r-num">{receiptAmount(1481400)}</td>
              </tr>
            </tbody>
            <tbody className="r-line">
              <tr>
                <td colSpan={4} className="r-name">
                  SAMPLE LOOSE ITEM P/KG
                </td>
              </tr>
              <tr>
                <td />
                <td className="r-num">999.999 kg</td>
                <td className="r-num">{receiptAmount(7000)}</td>
                <td className="r-num">{receiptAmount(6999993)}</td>
              </tr>
            </tbody>
          </table>
          <Rule />
          <div className="r-kv r-total">
            <span>TOTAL</span>
            <span className="r-kv-value">₹{receiptAmount(1481400)}</span>
          </div>
          <Rule />
          <p className="r-center r-small">
            {page === 1 ? "The printer should cut (or pause) after this page." : "End of test."}
          </p>
        </section>
      ))}
    </div>
  );
}
