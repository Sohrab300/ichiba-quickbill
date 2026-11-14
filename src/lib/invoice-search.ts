/** Helpers for getRecentInvoices() (Print Previous Invoice). Pure; safe anywhere. */

const IST_OFFSET_MS = 330 * 60_000; // India has no DST

/** Start of the current day in India (00:00 IST), as a UTC instant. */
export function startOfTodayIst(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
}

/**
 * Normalises typed search text for an invoice-number "contains" match. Invoice numbers are
 * [A-Z0-9/-] only (invoices_invoice_no_format), so everything else is dropped — which also keeps
 * LIKE wildcards (% _ \) out of the pattern. "" when nothing searchable is left.
 */
export function toInvoiceNoSearchTerm(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9/-]/g, "").slice(0, 40);
}
