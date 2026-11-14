import type { Database } from "./database.types";

type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type SaleRow = Database["public"]["Tables"]["sales"]["Row"];
type SaleItemRow = Database["public"]["Tables"]["sale_items"]["Row"];

export interface Product {
  id: string;
  barcode: string;
  name: string;
  price: number; // in paise (e.g. 5000 = ₹50.00)
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string | null;
  productName: string;
  unitPrice: number; // in paise
  quantity: number;
}

export interface Sale {
  id: string;
  subtotal: number; // in paise
  createdAt: string;
  items?: SaleItem[];
}

export function mapProductFromDb(row: ProductRow): Product {
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    price: row.price,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSaleItemFromDb(row: SaleItemRow): SaleItem {
  return {
    id: row.id,
    saleId: row.sale_id,
    productId: row.product_id,
    productName: row.product_name,
    unitPrice: row.unit_price,
    quantity: row.quantity,
  };
}

export function mapSaleFromDb(
  row: SaleRow,
  items?: SaleItemRow[]
): Sale {
  return {
    id: row.id,
    subtotal: row.subtotal,
    createdAt: row.created_at,
    items: items ? items.map(mapSaleItemFromDb) : undefined,
  };
}
