import { z } from "zod";
import { PAYMENT_METHODS } from "./constants";

/**
 * The invoice as returned by the create_invoice() / get_invoice() RPCs (public.invoice_json()),
 * converted to camelCase. All amounts are integer paise. Safe to import from client components.
 *
 * Two shapes (REQUIREMENTS.md section 16):
 * - AuditedInvoice: everything, including the price-edit audit fields (catalog price per line,
 *   price_edited, has_price_edit). Server-side only: admin history, detail page, tests.
 * - Invoice: what the browser and the receipts get — the charged prices only, with no trace of an
 *   edit. Every invoice a Server Action returns goes through toPublicInvoice().
 */

const paise = z.number().int();
// Plain strings, not z.uuid(): this parses a response for a sale that is already committed, so it
// must not reject anything the database legitimately produced.
const id = z.string().min(1);

const invoiceItemJson = z
  .object({
    line_no: z.number().int(),
    product_id: id,
    item_code: z.string(),
    name: z.string(),
    hsn_code: z.string().nullable(),
    uom: z.string(),
    unit_price: paise,
    // Optional only so a response from before the price-edit migration still parses.
    catalog_price: paise.optional(),
    price_edited: z.boolean().optional(),
    mrp: paise.nullable(),
    gst_rate: z.number().int(),
    qty: z.number().int(),
    line_total: paise,
    taxable_value: paise,
    cgst: paise,
    sgst: paise,
  })
  .transform((r) => ({
    lineNo: r.line_no,
    productId: r.product_id,
    itemCode: r.item_code,
    name: r.name,
    hsnCode: r.hsn_code,
    uom: r.uom,
    /** The price charged (GST-inclusive), paise. */
    unitPrice: r.unit_price,
    /** products.selling_price at the time of sale. Audit only. */
    catalogPrice: r.catalog_price ?? r.unit_price,
    /** The cashier changed the price for this bill. Audit only. */
    priceEdited: r.price_edited ?? false,
    mrp: r.mrp,
    gstRate: r.gst_rate,
    qty: r.qty,
    lineTotal: r.line_total,
    taxableValue: r.taxable_value,
    cgst: r.cgst,
    sgst: r.sgst,
  }));

const taxSummaryJson = z
  .object({
    hsn_code: z.string().nullable(),
    gst_rate: z.number().int(),
    taxable_value: paise,
    cgst: paise,
    sgst: paise,
    total: paise,
  })
  .transform((r) => ({
    hsnCode: r.hsn_code,
    gstRate: r.gst_rate,
    taxableValue: r.taxable_value,
    cgst: r.cgst,
    sgst: r.sgst,
    total: r.total,
  }));

export const invoiceJsonSchema = z
  .object({
    id,
    invoice_no: z.string(),
    counter_id: id,
    counter_code: z.string(),
    fy: z.string(),
    seq_number: z.number().int(),
    idempotency_key: id,
    cashier_user_id: id,
    cashier_name: z.string(),
    payment_method: z.enum(PAYMENT_METHODS),
    item_count: z.number().int(),
    total_qty: z.number().int(),
    subtotal: paise,
    taxable_total: paise,
    cgst_total: paise,
    sgst_total: paise,
    round_off: paise,
    grand_total: paise,
    has_price_edit: z.boolean().optional(),
    created_at: z.string(),
    store: z.object({
      legal_name: z.string(),
      address: z.string(),
      phone: z.string().nullable(),
      gstin: z.string(),
      state_code: z.string(),
      state_name: z.string(),
      footer: z.string().nullable(),
    }),
    items: z.array(invoiceItemJson),
    tax_summary: z.array(taxSummaryJson),
  })
  .transform((r) => ({
    id: r.id,
    invoiceNo: r.invoice_no,
    counterId: r.counter_id,
    counterCode: r.counter_code,
    fy: r.fy,
    seqNumber: r.seq_number,
    idempotencyKey: r.idempotency_key,
    cashierUserId: r.cashier_user_id,
    cashierName: r.cashier_name,
    paymentMethod: r.payment_method,
    itemCount: r.item_count,
    totalQty: r.total_qty,
    subtotal: r.subtotal,
    taxableTotal: r.taxable_total,
    cgstTotal: r.cgst_total,
    sgstTotal: r.sgst_total,
    roundOff: r.round_off,
    grandTotal: r.grand_total,
    /** At least one line has an edited price. Audit only. */
    hasPriceEdit: r.has_price_edit ?? false,
    /** ISO timestamp (UTC); display in Asia/Kolkata. */
    createdAt: r.created_at,
    store: {
      legalName: r.store.legal_name,
      address: r.store.address,
      phone: r.store.phone,
      gstin: r.store.gstin,
      stateCode: r.store.state_code,
      stateName: r.store.state_name,
      footer: r.store.footer,
    },
    items: r.items,
    taxSummary: r.tax_summary,
  }));

export type AuditedInvoice = z.output<typeof invoiceJsonSchema>;
export type AuditedInvoiceItem = AuditedInvoice["items"][number];

type AuditItemField = "catalogPrice" | "priceEdited";
export type InvoiceItem = Omit<AuditedInvoiceItem, AuditItemField>;
export type Invoice = Omit<AuditedInvoice, "hasPriceEdit" | "items"> & { items: InvoiceItem[] };
export type InvoiceTaxSummaryRow = Invoice["taxSummary"][number];

/**
 * The invoice without its price-edit audit fields, as new objects (a Server Action serialises
 * every own property, so the fields must be gone, not just untyped). The receipt is the same
 * either way: it prints only the charged rate.
 */
export function toPublicInvoice(invoice: AuditedInvoice): Invoice {
  const out: Invoice & Partial<Pick<AuditedInvoice, "hasPriceEdit">> = {
    ...invoice,
    items: invoice.items.map((item) => {
      const copy: InvoiceItem & Partial<Pick<AuditedInvoiceItem, AuditItemField>> = { ...item };
      delete copy.catalogPrice;
      delete copy.priceEdited;
      return copy;
    }),
  };
  delete out.hasPriceEdit;
  return out;
}
