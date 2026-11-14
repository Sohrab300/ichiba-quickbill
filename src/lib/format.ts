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
 * Formats ISO date string into human readable Indian standard format.
 */
export function formatDateTime(isoString: string): string {
  if (!isoString) return "-";
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
