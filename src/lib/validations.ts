import { z } from "zod";

export const createProductSchema = z.object({
  barcode: z
    .string()
    .trim()
    .min(1, "Barcode is required")
    .max(64, "Barcode too long"),
  name: z
    .string()
    .trim()
    .min(1, "Product name is required")
    .max(255, "Product name too long"),
  price: z
    .number()
    .int("Price in paise must be an integer")
    .min(0, "Price cannot be negative"),
  category: z
    .string()
    .trim()
    .max(100, "Category name too long")
    .nullable()
    .optional(),
});

export const updateProductSchema = z.object({
  barcode: z
    .string()
    .trim()
    .min(1, "Barcode is required")
    .max(64, "Barcode too long")
    .optional(),
  name: z
    .string()
    .trim()
    .min(1, "Product name is required")
    .max(255, "Product name too long")
    .optional(),
  price: z
    .number()
    .int("Price in paise must be an integer")
    .min(0, "Price cannot be negative")
    .optional(),
  category: z
    .string()
    .trim()
    .max(100, "Category name too long")
    .nullable()
    .optional(),
});

export const saleItemInputSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
});

export const completeSaleSchema = z.object({
  items: z.array(saleItemInputSchema).min(1, "Sale must have at least one item"),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type SaleItemInput = z.infer<typeof saleItemInputSchema>;
export type CompleteSaleInput = z.infer<typeof completeSaleSchema>;
