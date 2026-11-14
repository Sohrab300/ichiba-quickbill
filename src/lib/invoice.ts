import { z } from "zod";
import { PAYMENT_METHODS } from "./constants";

/**
 * The invoice as returned by the create_invoice() / get_invoice() RPCs (public.invoice_json()),
 * converted to camelCase. All amounts are integer paise. Safe to import from client components.
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
    unitPrice: r.unit_price,
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

export type Invoice = z.output<typeof invoiceJsonSchema>;
export type InvoiceItem = Invoice["items"][number];
export type InvoiceTaxSummaryRow = Invoice["taxSummary"][number];
