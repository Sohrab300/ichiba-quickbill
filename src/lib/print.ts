import type { Invoice } from "./invoice";

/**
 * Prints an invoice returned by the server (create_invoice / get_invoice).
 *
 * Placeholder until the printing work (REQUIREMENTS.md section 7): the real version renders a
 * two-copy 58/80mm receipt into a print root and calls window.print(). Printing must never
 * affect the invoice itself, so this never throws.
 */
export function printInvoice(invoice: Invoice, options: { reprint?: boolean } = {}): void {
  console.info(`[printInvoice placeholder] ${options.reprint ? "reprint" : "print"} ${invoice.invoiceNo}`);
}
