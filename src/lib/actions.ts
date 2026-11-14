"use server";

// NOTE: no authentication yet — every action below is callable by anyone who can reach the app.
// Prompt 2 (login, counters, roles) adds getStaffContext() checks to each of them.

import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";
import { createServerClient } from "./supabase/server";
import type { Database } from "./supabase/database.types";
import { mapProductFromDb, type Product, type ProductBarcode } from "./supabase/mappers";
import { toSafeIlikeTerm } from "./search";
import {
  barcodeSchema,
  createProductSchema,
  productSearchSchema,
  updateProductSchema,
  type CreateProductInput,
  type ProductSearchInput,
  type UpdateProductInput,
} from "./validations";

type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

export interface ProductList {
  products: Product[];
  /** Total rows matching the search (may exceed products.length). */
  total: number;
  limit: number;
}

const PRODUCT_SELECT = "*, product_barcodes(id, barcode)" as const;
const uuidSchema = z.uuid("Invalid ID");

function fail<T>(error: string, statusCode: number): ActionResult<T> {
  return { success: false, error, statusCode };
}

function fromException<T>(err: unknown, fallback: string, statusCode = 500): ActionResult<T> {
  if (err instanceof z.ZodError) {
    return fail(err.issues.map((i) => i.message).join("; "), 400);
  }
  console.error(fallback, err);
  return fail(err instanceof Error ? err.message : fallback, statusCode);
}

/** Maps Postgres constraint errors to messages a cashier/admin can act on. */
function dbError<T>(error: PostgrestError, fallback: string): ActionResult<T> {
  const text = `${error.message} ${error.details ?? ""}`;
  if (error.code === "23505") {
    if (text.includes("products_item_code_key")) return fail("A product with this item code already exists.", 409);
    if (text.includes("product_barcodes_barcode_key")) return fail("This barcode is already linked to a product.", 409);
    return fail("This value already exists.", 409);
  }
  if (error.code === "23514") {
    if (text.includes("products_selling_le_mrp")) return fail("Selling price cannot be above MRP.", 400);
    if (text.includes("products_gst_rate_valid")) return fail("GST rate must be 0, 5, 12, 18, 28 or 40.", 400);
    if (text.includes("products_hsn_format")) return fail("HSN code must be 4–8 digits.", 400);
    return fail("Invalid value: a database check failed.", 400);
  }
  console.error(fallback, error);
  return fail(`${fallback}: ${error.message}`, 500);
}

/**
 * Rejects a barcode that is already an alias, or that equals another product's item code
 * (the alias would silently shadow that product at the scanner).
 */
async function checkBarcodeAvailable(barcode: string, forProductId?: string): Promise<string | null> {
  const supabase = createServerClient();
  const [alias, item] = await Promise.all([
    supabase.from("product_barcodes").select("product_id, products(item_code, name)").eq("barcode", barcode).maybeSingle(),
    supabase.from("products").select("id, item_code, name").eq("item_code", barcode).maybeSingle(),
  ]);
  if (alias.error) throw alias.error;
  if (item.error) throw item.error;
  if (alias.data) {
    const p = alias.data.products;
    return `Barcode ${barcode} is already linked to ${p ? `${p.item_code} · ${p.name}` : "another product"}.`;
  }
  if (item.data && item.data.id !== forProductId) {
    return `${barcode} is already the item code of ${item.data.item_code} · ${item.data.name}.`;
  }
  return null;
}

/**
 * Scan lookup: product_barcodes.barcode first, then products.item_code (one round trip via the
 * lookup_product RPC). Inactive products are returned; the caller decides what to do with them.
 */
export async function lookupProduct(code: string): Promise<ActionResult<Product | null>> {
  try {
    const parsed = barcodeSchema.safeParse(code ?? "");
    if (!parsed.success) return { success: true, data: null, statusCode: 404 };

    const supabase = createServerClient();
    const { data, error } = await supabase
      .rpc("lookup_product", { p_code: parsed.data })
      .maybeSingle();
    if (error) return dbError(error, "Lookup failed");
    if (!data) return { success: true, data: null, statusCode: 404 };
    return { success: true, data: mapProductFromDb(data), statusCode: 200 };
  } catch (err: unknown) {
    return fromException(err, "Failed to look up code");
  }
}

/**
 * Lists products ordered by name, optionally filtered by name, item code, category or an exact
 * barcode alias. Returns at most `limit` rows plus the total match count.
 */
export async function getProducts(
  input: ProductSearchInput = {}
): Promise<ActionResult<ProductList>> {
  try {
    const { query: rawQuery, limit } = productSearchSchema.parse(input);
    const supabase = createServerClient();
    let query = supabase
      .from("products")
      .select(PRODUCT_SELECT, { count: "exact" })
      .order("name", { ascending: true })
      .range(0, limit - 1);

    const raw = rawQuery?.trim() ?? "";
    if (raw) {
      const term = toSafeIlikeTerm(raw);
      const filters: string[] = [];
      if (term) {
        const pattern = `"*${term}*"`;
        filters.push(`name.ilike.${pattern}`, `item_code.ilike.${pattern}`, `category.ilike.${pattern}`);
      }
      const asBarcode = barcodeSchema.safeParse(raw);
      if (asBarcode.success) {
        const { data: aliases, error } = await supabase
          .from("product_barcodes")
          .select("product_id")
          .eq("barcode", asBarcode.data);
        if (error) return dbError(error, "Failed to search barcodes");
        const ids = (aliases ?? []).map((a) => a.product_id);
        if (ids.length) filters.push(`id.in.(${ids.join(",")})`);
      }
      if (filters.length === 0) return { success: true, data: { products: [], total: 0, limit }, statusCode: 200 };
      query = query.or(filters.join(","));
    }

    const { data, error, count } = await query;
    if (error) return dbError(error, "Failed to list products");

    const products = (data ?? []).map((row) => mapProductFromDb(row, row.product_barcodes));
    return { success: true, data: { products, total: count ?? products.length, limit }, statusCode: 200 };
  } catch (err: unknown) {
    return fromException(err, "Failed to list products");
  }
}

/**
 * Adds a product, optionally linking a manufacturer barcode to it.
 */
export async function createProduct(input: CreateProductInput): Promise<ActionResult<Product>> {
  try {
    const v = createProductSchema.parse(input);
    const supabase = createServerClient();

    if (v.barcode) {
      const conflict = await checkBarcodeAvailable(v.barcode);
      if (conflict) return fail(conflict, 409);
    }

    const { data: row, error } = await supabase
      .from("products")
      .insert({
        item_code: v.itemCode,
        name: v.name,
        selling_price: v.sellingPrice,
        mrp: v.mrp ?? null,
        gst_rate: v.gstRate,
        hsn_code: v.hsnCode ?? null,
        uom: v.uom,
        category: v.category ?? null,
        department: v.department ?? null,
        is_active: v.isActive,
      })
      .select()
      .single();
    if (error) return dbError(error, "Failed to create product");

    let barcodes: ProductBarcode[] = [];
    if (v.barcode) {
      const { data: alias, error: aliasError } = await supabase
        .from("product_barcodes")
        .insert({ barcode: v.barcode, product_id: row.id })
        .select("id, barcode")
        .single();
      if (aliasError) {
        // Keep create atomic from the user's point of view.
        await supabase.from("products").delete().eq("id", row.id);
        return dbError(aliasError, "Failed to link barcode");
      }
      barcodes = [alias];
    }

    return { success: true, data: mapProductFromDb(row, barcodes), statusCode: 201 };
  } catch (err: unknown) {
    return fromException(err, "Failed to create product", 400);
  }
}

/**
 * Updates an existing product by its ID. Barcode aliases are managed separately.
 */
export async function updateProduct(
  id: string,
  input: UpdateProductInput
): Promise<ActionResult<Product>> {
  try {
    const productId = uuidSchema.parse(id);
    const v = updateProductSchema.parse(input);

    const payload: ProductUpdate = {};
    if (v.itemCode !== undefined) payload.item_code = v.itemCode;
    if (v.name !== undefined) payload.name = v.name;
    if (v.sellingPrice !== undefined) payload.selling_price = v.sellingPrice;
    if (v.mrp !== undefined) payload.mrp = v.mrp;
    if (v.gstRate !== undefined) payload.gst_rate = v.gstRate;
    if (v.hsnCode !== undefined) payload.hsn_code = v.hsnCode;
    if (v.uom !== undefined) payload.uom = v.uom;
    if (v.category !== undefined) payload.category = v.category;
    if (v.department !== undefined) payload.department = v.department;
    if (v.isActive !== undefined) payload.is_active = v.isActive;
    if (Object.keys(payload).length === 0) return fail("Nothing to update", 400);

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("products")
      .update(payload)
      .eq("id", productId)
      .select(PRODUCT_SELECT)
      .maybeSingle();
    if (error) return dbError(error, "Failed to update product");
    if (!data) return fail("Product not found", 404);

    return { success: true, data: mapProductFromDb(data, data.product_barcodes), statusCode: 200 };
  } catch (err: unknown) {
    return fromException(err, "Failed to update product", 400);
  }
}

/**
 * Deletes a product by ID (its barcode aliases are removed with it).
 */
export async function deleteProduct(id: string): Promise<ActionResult<boolean>> {
  try {
    const productId = uuidSchema.parse(id);
    const supabase = createServerClient();
    const { error } = await supabase.from("products").delete().eq("id", productId);
    if (error) return dbError(error, "Failed to delete product");
    return { success: true, data: true, statusCode: 200 };
  } catch (err: unknown) {
    return fromException(err, "Failed to delete product");
  }
}

/**
 * Links a manufacturer barcode (EAN/UPC) to a product.
 */
export async function addProductBarcode(
  productId: string,
  barcode: string
): Promise<ActionResult<ProductBarcode>> {
  try {
    const id = uuidSchema.parse(productId);
    const code = barcodeSchema.parse(barcode);
    const conflict = await checkBarcodeAvailable(code, id);
    if (conflict) return fail(conflict, 409);

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("product_barcodes")
      .insert({ barcode: code, product_id: id })
      .select("id, barcode")
      .single();
    if (error) {
      if (error.code === "23503") return fail("Product not found", 404);
      return dbError(error, "Failed to link barcode");
    }
    return { success: true, data, statusCode: 201 };
  } catch (err: unknown) {
    return fromException(err, "Failed to link barcode", 400);
  }
}

/**
 * Removes a barcode alias by its ID.
 */
export async function removeProductBarcode(barcodeId: string): Promise<ActionResult<boolean>> {
  try {
    const id = uuidSchema.parse(barcodeId);
    const supabase = createServerClient();
    const { error } = await supabase.from("product_barcodes").delete().eq("id", id);
    if (error) return dbError(error, "Failed to remove barcode");
    return { success: true, data: true, statusCode: 200 };
  } catch (err: unknown) {
    return fromException(err, "Failed to remove barcode");
  }
}

/**
 * Checkout is disabled: the prototype's sales tables were dropped and invoice creation
 * (GST, invoice numbers, idempotency — REQUIREMENTS.md sections 3, 5, 6) replaces it in prompt 3.
 */
export async function completeSale(): Promise<ActionResult<{ saleId: string }>> {
  return fail(
    "Checkout is disabled until invoice creation (GST and invoice numbers) is built.",
    501
  );
}
