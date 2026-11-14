import { z } from "zod";
import { GST_RATES } from "./constants";

/** Max price accepted from forms: ₹1 crore, well inside the integer paise column. */
const MAX_PAISE = 1_000_000_000;

export const itemCodeSchema = z
  .string()
  .trim()
  .min(1, "Item code is required")
  .regex(/^[0-9A-Za-z_-]{1,32}$/, "Item code: up to 32 letters, digits, - or _");

/** Printable ASCII, no spaces (matches product_barcodes_barcode_format). */
export const barcodeSchema = z
  .string()
  .trim()
  .min(1, "Barcode is required")
  .regex(/^[!-~]{1,64}$/, "Barcode: up to 64 characters, no spaces");

const paiseSchema = z
  .number()
  .int("Price in paise must be an integer")
  .min(0, "Price cannot be negative")
  .max(MAX_PAISE, "Price is too large");

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const productFields = {
  itemCode: itemCodeSchema,
  name: z
    .string()
    .trim()
    .min(1, "Product name is required")
    .max(255, "Product name too long"),
  sellingPrice: paiseSchema,
  mrp: paiseSchema.nullable().optional(),
  gstRate: z.literal(GST_RATES, { error: "GST rate must be 0, 5, 12, 18, 28 or 40" }),
  hsnCode: z
    .string()
    .trim()
    .regex(/^(\d{4,8})?$/, "HSN code must be 4–8 digits")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  uom: z
    .string()
    .trim()
    .min(1, "UOM is required")
    .max(16, "UOM too long")
    .transform((v) => v.toUpperCase()),
  category: optionalText(100, "Category"),
  department: optionalText(100, "Department"),
  isActive: z.boolean(),
};

const sellingWithinMrp = (v: { sellingPrice?: number; mrp?: number | null }) =>
  v.sellingPrice === undefined || v.mrp === undefined || v.mrp === null || v.sellingPrice <= v.mrp;
const sellingWithinMrpIssue = { message: "Selling price cannot be above MRP", path: ["sellingPrice"] };

export const createProductSchema = z
  .object({
    ...productFields,
    uom: productFields.uom.default("PCS"),
    isActive: productFields.isActive.default(true),
    /** Optional manufacturer barcode (EAN) to link to the new product. */
    barcode: barcodeSchema.optional().or(z.literal("").transform(() => undefined)),
  })
  .refine(sellingWithinMrp, sellingWithinMrpIssue);

export const updateProductSchema = z
  .object(productFields)
  .partial()
  .refine(sellingWithinMrp, sellingWithinMrpIssue);

export const productSearchSchema = z.object({
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

export type CreateProductInput = z.input<typeof createProductSchema>;
export type UpdateProductInput = z.input<typeof updateProductSchema>;
export type ProductSearchInput = z.input<typeof productSearchSchema>;
