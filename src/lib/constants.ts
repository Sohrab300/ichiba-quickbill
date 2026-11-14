/** GST slabs accepted by products.gst_rate (DB check constraint products_gst_rate_valid). */
export const GST_RATES = [0, 5, 12, 18, 28, 40] as const;
export type GstRate = (typeof GST_RATES)[number];

/** invoices.payment_method (DB check constraint invoices_payment_method_valid). */
export const PAYMENT_METHODS = ["cash", "upi", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Limits enforced by create_invoice() (supabase/migrations/20261114230000_invoices.sql). */
export const MAX_INVOICE_LINES = 500;
export const MAX_LINE_QTY = 9999;

export const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: "Cash", upi: "UPI", card: "Card" };

/** "Cash" / "UPI" / "Card"; "—" for anything else. Safe in server and client components. */
export function paymentLabel(method: string | null | undefined): string {
  return method && method in PAYMENT_LABELS ? PAYMENT_LABELS[method as PaymentMethod] : "—";
}
