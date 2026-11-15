/**
 * Part of scripts/test-db-local.sh: every invoice the throwaway database issued (edited prices
 * included) must match the browser preview (src/lib/gst.ts) computed on the charged prices, and
 * its price-edit flags must agree with the prices.
 *
 *   tsx scripts/db-tests/check-preview.ts <invoices.json>   (a JSON array of invoice_json())
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { computeInvoiceTotals } from "../../src/lib/gst";
import { invoiceJsonSchema } from "../../src/lib/invoice";

const file = process.argv[2];
if (!file) throw new Error("usage: check-preview.ts <invoices.json>");
const invoices = z.array(invoiceJsonSchema).parse(JSON.parse(readFileSync(file, "utf8")));

let failures = 0;
let edited = 0;
for (const inv of invoices) {
  const { lines, totals } = computeInvoiceTotals(inv.items);
  const problems: string[] = [];
  inv.items.forEach((item, i) => {
    const l = lines[i];
    if (l.lineTotal !== item.lineTotal || l.taxableValue !== item.taxableValue || l.cgst !== item.cgst || l.sgst !== item.sgst) {
      problems.push(`line ${item.lineNo}: db ${JSON.stringify(item)} preview ${JSON.stringify(l)}`);
    }
    if (item.priceEdited !== (item.unitPrice !== item.catalogPrice)) problems.push(`line ${item.lineNo}: price_edited flag`);
  });
  const db = {
    totalQty: inv.totalQty,
    subtotal: inv.subtotal,
    taxableTotal: inv.taxableTotal,
    cgstTotal: inv.cgstTotal,
    sgstTotal: inv.sgstTotal,
    roundOff: inv.roundOff,
    grandTotal: inv.grandTotal,
  };
  for (const [k, v] of Object.entries(db)) {
    if (totals[k as keyof typeof totals] !== v) problems.push(`${k}: db ${v} preview ${totals[k as keyof typeof totals]}`);
  }
  if (inv.hasPriceEdit !== inv.items.some((i) => i.priceEdited)) problems.push("has_price_edit flag");
  if (inv.hasPriceEdit) edited++;
  if (problems.length) {
    failures++;
    console.log(`  FAIL  ${inv.invoiceNo}\n        ${problems.join("\n        ")}`);
  }
}
if (edited === 0) {
  failures++;
  console.log("  FAIL  no invoice with an edited price to compare");
}
console.log(
  failures
    ? `  ${failures} invoice(s) differ from the preview`
    : `  PASS  ${invoices.length} invoices (${edited} with edited prices) match the gst.ts preview`
);
process.exit(failures ? 1 : 0);
