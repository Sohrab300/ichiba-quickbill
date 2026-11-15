import type { Database } from "./database.types";

type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type ProductBarcodeRow = Pick<Database["public"]["Tables"]["product_barcodes"]["Row"], "id" | "barcode">;

export interface ProductBarcode {
  id: string;
  barcode: string;
}

export interface Product {
  id: string;
  itemCode: string;
  name: string;
  sellingPrice: number; // paise, GST-inclusive
  mrp: number | null; // paise
  gstRate: number; // percent: 0, 5, 12, 18, 28 or 40
  hsnCode: string | null;
  uom: string;
  category: string | null;
  department: string | null;
  stockQty: number; // informational only
  isActive: boolean;
  /** Loose fruit/vegetables priced per kg: qty is kg with up to 3 decimals (REQUIREMENTS.md 17). */
  soldByWeight: boolean;
  barcodes: ProductBarcode[];
  createdAt: string;
  updatedAt: string;
}

export function mapProductFromDb(
  row: ProductRow,
  barcodes: ProductBarcodeRow[] = []
): Product {
  return {
    id: row.id,
    itemCode: row.item_code,
    name: row.name,
    sellingPrice: row.selling_price,
    mrp: row.mrp,
    gstRate: row.gst_rate,
    hsnCode: row.hsn_code,
    uom: row.uom,
    category: row.category,
    department: row.department,
    stockQty: Number(row.stock_qty),
    isActive: row.is_active,
    soldByWeight: row.sold_by_weight ?? false,
    barcodes: barcodes
      .map((b) => ({ id: b.id, barcode: b.barcode }))
      .sort((a, b) => a.barcode.localeCompare(b.barcode)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
