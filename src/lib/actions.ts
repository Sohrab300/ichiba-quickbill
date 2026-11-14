"use server";

import { createServerClient } from "./supabase/server";
import {
  mapProductFromDb,
  mapSaleFromDb,
  type Product,
  type Sale,
} from "./supabase/mappers";
import {
  createProductSchema,
  updateProductSchema,
  completeSaleSchema,
  type CreateProductInput,
  type UpdateProductInput,
  type CompleteSaleInput,
} from "./validations";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

/**
 * Looks up a single product by its exact barcode.
 */
export async function getProductByBarcode(
  barcode: string
): Promise<ActionResult<Product | null>> {
  try {
    const trimmed = barcode?.trim();
    if (!trimmed) {
      return { success: true, data: null };
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("barcode", trimmed)
      .maybeSingle();

    if (error) {
      console.error("Error looking up barcode:", error);
      return { success: false, error: error.message, statusCode: 500 };
    }

    if (!data) {
      return { success: true, data: null, statusCode: 404 };
    }

    return { success: true, data: mapProductFromDb(data), statusCode: 200 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to lookup barcode";
    console.error("Lookup exception:", err);
    return { success: false, error: msg, statusCode: 500 };
  }
}

/**
 * Lists products, optionally filtered by a search query (matching name, barcode, or category).
 */
export async function getProducts(
  searchQuery?: string
): Promise<ActionResult<Product[]>> {
  try {
    const supabase = createServerClient();
    let query = supabase.from("products").select("*").order("name", { ascending: true });

    const trimmed = searchQuery?.trim();
    if (trimmed) {
      // Search across name, barcode, or category
      query = query.or(
        `name.ilike.%${trimmed}%,barcode.ilike.%${trimmed}%,category.ilike.%${trimmed}%`
      );
    }

    const { data, error } = await query;
    if (error) {
      console.error("Error listing products:", error);
      return { success: false, error: error.message, statusCode: 500 };
    }

    const mapped = (data || []).map(mapProductFromDb);
    return { success: true, data: mapped, statusCode: 200 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list products";
    console.error("Get products exception:", err);
    return { success: false, error: msg, statusCode: 500 };
  }
}

/**
 * Adds a new product to the catalog.
 */
export async function createProduct(
  input: CreateProductInput
): Promise<ActionResult<Product>> {
  try {
    const validated = createProductSchema.parse(input);
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("products")
      .insert({
        barcode: validated.barcode,
        name: validated.name,
        price: validated.price,
        category: validated.category || null,
      })
      .select()
      .single();

    if (error) {
      // Unique constraint violation in Postgres is error code 23505
      if (error.code === "23505") {
        return {
          success: false,
          error: `A product with barcode "${validated.barcode}" already exists.`,
          statusCode: 409,
        };
      }
      return { success: false, error: error.message, statusCode: 400 };
    }

    return { success: true, data: mapProductFromDb(data), statusCode: 201 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create product";
    console.error("Create product exception:", err);
    return { success: false, error: msg, statusCode: 400 };
  }
}

/**
 * Updates an existing product by its ID.
 */
export async function updateProduct(
  id: string,
  input: UpdateProductInput
): Promise<ActionResult<Product>> {
  try {
    if (!id) {
      return { success: false, error: "Product ID is required", statusCode: 400 };
    }

    const validated = updateProductSchema.parse(input);
    const supabase = createServerClient();

    const updatePayload: import("./supabase/database.types").Database["public"]["Tables"]["products"]["Update"] = {};
    if (validated.barcode !== undefined) updatePayload.barcode = validated.barcode;
    if (validated.name !== undefined) updatePayload.name = validated.name;
    if (validated.price !== undefined) updatePayload.price = validated.price;
    if (validated.category !== undefined) updatePayload.category = validated.category;

    const { data, error } = await supabase
      .from("products")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return {
          success: false,
          error: `Barcode "${validated.barcode}" is already taken by another product.`,
          statusCode: 409,
        };
      }
      return { success: false, error: error.message, statusCode: 400 };
    }

    if (!data) {
      return { success: false, error: "Product not found", statusCode: 404 };
    }

    return { success: true, data: mapProductFromDb(data), statusCode: 200 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update product";
    console.error("Update product exception:", err);
    return { success: false, error: msg, statusCode: 400 };
  }
}

/**
 * Deletes a product by ID.
 */
export async function deleteProduct(id: string): Promise<ActionResult<boolean>> {
  try {
    if (!id) {
      return { success: false, error: "Product ID is required", statusCode: 400 };
    }

    const supabase = createServerClient();
    const { error } = await supabase.from("products").delete().eq("id", id);

    if (error) {
      return { success: false, error: error.message, statusCode: 400 };
    }

    return { success: true, data: true, statusCode: 200 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete product";
    console.error("Delete product exception:", err);
    return { success: false, error: msg, statusCode: 500 };
  }
}

/**
 * Completes a sale by calling the Postgres complete_sale(items) RPC.
 * Snapshots product names and prices directly from the database to guarantee integrity.
 */
export async function completeSale(
  input: CompleteSaleInput
): Promise<ActionResult<{ saleId: string }>> {
  try {
    const validated = completeSaleSchema.parse(input);
    const supabase = createServerClient();

    // Map input to the format expected by complete_sale: [{ product_id, quantity }]
    const itemsPayload = validated.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    }));

    const { data, error } = await supabase.rpc("complete_sale", {
      items: itemsPayload as unknown as import("./supabase/database.types").Json,
    });

    if (error) {
      console.error("Error in complete_sale RPC:", error);
      return { success: false, error: error.message, statusCode: 400 };
    }

    if (!data) {
      return { success: false, error: "Sale creation failed to return an ID", statusCode: 500 };
    }

    return { success: true, data: { saleId: data }, statusCode: 201 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to complete sale";
    console.error("Complete sale exception:", err);
    return { success: false, error: msg, statusCode: 400 };
  }
}

export interface SaleSummary extends Sale {
  itemCount: number;
}

/**
 * Lists sales history with timestamp, subtotal, and count of items.
 */
export async function getSales(): Promise<ActionResult<SaleSummary[]>> {
  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("sales")
      .select("*, sale_items(*)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching sales:", error);
      return { success: false, error: error.message, statusCode: 500 };
    }

    const mapped: SaleSummary[] = (data || []).map((saleRow) => {
      const items = (saleRow.sale_items || []).map((it) => ({
        id: it.id,
        saleId: it.sale_id,
        productId: it.product_id,
        productName: it.product_name,
        unitPrice: it.unit_price,
        quantity: it.quantity,
      }));

      const itemCount = items.reduce((sum, it) => sum + it.quantity, 0);

      return {
        id: saleRow.id,
        subtotal: saleRow.subtotal,
        createdAt: saleRow.created_at,
        items,
        itemCount,
      };
    });

    return { success: true, data: mapped, statusCode: 200 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list sales";
    console.error("Get sales exception:", err);
    return { success: false, error: msg, statusCode: 500 };
  }
}

/**
 * Gets a single sale with its line items snapshot.
 */
export async function getSaleById(id: string): Promise<ActionResult<Sale | null>> {
  try {
    if (!id) {
      return { success: false, error: "Sale ID is required", statusCode: 400 };
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("sales")
      .select("*, sale_items(*)")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message, statusCode: 500 };
    }

    if (!data) {
      return { success: true, data: null, statusCode: 404 };
    }

    const mapped = mapSaleFromDb(data, data.sale_items);
    return { success: true, data: mapped, statusCode: 200 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to get sale details";
    console.error("Get sale exception:", err);
    return { success: false, error: msg, statusCode: 500 };
  }
}
