/**
 * Formats integer paise into INR currency representation (₹ en-IN).
 * e.g., 8500 paise -> "₹85.00"
 */
export function formatINR(paise: number): string {
  const rupees = (paise || 0) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Parses a rupee amount typed by a user ("50", "50.5", "1,190.00") into integer paise.
 * Returns null for anything that is not a non-negative amount with at most 2 decimals.
 */
export function parseRupeesToPaise(input: string): number | null {
  const s = input.trim().replace(/,/g, "");
  const m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Paise -> plain rupee string for form inputs ("1190.00"). */
export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  return (paise / 100).toFixed(2);
}
