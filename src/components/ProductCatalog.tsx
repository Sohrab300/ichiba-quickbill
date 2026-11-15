"use client";

import { useState, useEffect } from "react";
import {
  Package,
  Plus,
  Search,
  Edit2,
  Trash2,
  Loader2,
  Tag,
} from "lucide-react";
import { getProducts, deleteProduct, type ProductList } from "@/lib/actions";
import { formatINR } from "@/lib/format";
import type { Product } from "@/lib/supabase/mappers";
import AddProductModal from "@/components/AddProductModal";
import EditProductModal from "@/components/EditProductModal";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { tableStyles as tbl } from "@/components/ui/Table";
import { cx } from "@/components/ui/cx";

export default function ProductCatalog({
  canManage,
}: {
  /** Admins can add, edit and delete products; cashiers get a read-only list. */
  canManage: boolean;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    getProducts()
      .then((res) => {
        if (!isMounted) return;
        if (res.success && res.data) {
          applyList(res.data);
        } else {
          setError(res.error || "Failed to load products");
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : "Error fetching products";
        setError(msg);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  function applyList(list: ProductList) {
    setProducts(list.products);
    setTotal(list.total);
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const res = await getProducts({ query: searchQuery });
      if (res.success && res.data) {
        applyList(res.data);
      } else {
        setError(res.error || "Failed to load products");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error fetching products";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearSearch = async () => {
    setSearchQuery("");
    setIsLoading(true);
    setError(null);
    try {
      const res = await getProducts();
      if (res.success && res.data) {
        applyList(res.data);
      } else {
        setError(res.error || "Failed to load products");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (product: Product) => {
    if (!confirm(`Are you sure you want to delete "${product.name}"?`)) {
      return;
    }

    setDeletingId(product.id);
    try {
      const res = await deleteProduct(product.id);
      if (res.success) {
        setProducts((prev) => prev.filter((p) => p.id !== product.id));
        setTotal((t) => Math.max(0, t - 1));
      } else {
        alert(res.error || "Failed to delete product");
      }
    } catch {
      alert("Error deleting product");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Banner & Header */}
      <PageHeader
        title="Product Catalog"
        icon={<Package />}
        description="Item codes, barcodes, selling price, MRP and GST. Prices include GST."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setIsAddOpen(true)}>
              <Plus className="h-5 w-5" />
              <span>Add New Product</span>
            </Button>
          )
        }
      />

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-ink-muted" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, item code, barcode or category..."
            withIcon
          />
        </div>
        <Button type="submit" variant="ink" size="sm" className="px-4">
          Search
        </Button>
        {searchQuery && (
          <Button variant="ghost" size="sm" onClick={handleClearSearch}>
            Clear
          </Button>
        )}
      </form>

      {/* Error Message */}
      {error && (
        <Alert tone="danger" size="sm">
          {error}
        </Alert>
      )}

      {!isLoading && products.length > 0 && (
        <p className="-mt-3 text-sm text-ink-muted">
          {products.length < total ? (
            <>
              Showing <span className="num">{products.length.toLocaleString("en-IN")}</span> of{" "}
              <span className="num">{total.toLocaleString("en-IN")}</span> products. Search to narrow down.
            </>
          ) : (
            <>
              <span className="num">{total.toLocaleString("en-IN")}</span> {total === 1 ? "product" : "products"}
            </>
          )}
        </p>
      )}

      {/* Products Table */}
      <div className={cardClasses({ className: "overflow-hidden" })}>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-ink-muted">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
            <span className="text-sm">Loading products...</span>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <Package className="mb-3 h-12 w-12 text-ink-muted" />
            <h3 className="font-display text-xl font-bold text-ink">
              No products found
            </h3>
            <p className="mt-1 max-w-sm text-sm text-ink-muted">
              {searchQuery
                ? `No products matched "${searchQuery}". Try a different keyword.`
                : canManage
                  ? "No products in your catalog yet. Click 'Add New Product' above to create your first item."
                  : "No products in the catalog yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={cx(tbl.table, "border-collapse text-left")}>
              <thead className={tbl.thead}>
                <tr>
                  <th className="py-3 px-4 sm:px-6">Item code</th>
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4 text-right">Selling</th>
                  <th className="py-3 px-4 text-right">MRP</th>
                  <th className="py-3 px-4 text-right">GST</th>
                  <th className="py-3 px-4 text-right">Stock</th>
                  {canManage && <th className="py-3 px-4 sm:px-6 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className={tbl.tbody}>
                {products.map((product) => (
                  <tr
                    key={product.id}
                    className={cx(tbl.tr, "transition-colors hover:bg-brand-soft", !product.isActive && "opacity-60")}
                  >
                    <td className="px-4 py-3.5 align-top font-mono text-sm text-ink-muted sm:px-6">
                      {product.itemCode}
                    </td>
                    <td className="py-3.5 px-4 align-top">
                      <div className="flex flex-wrap items-center gap-2 font-bold text-ink">
                        {product.name}
                        {product.soldByWeight && (
                          <Badge tone="ink" title="Sold by weight: price per kg, qty in kg with up to 3 decimals">
                            Per kg
                          </Badge>
                        )}
                        {!product.isActive && (
                          <Badge>Inactive</Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
                        {product.category && (
                          <span className="inline-flex items-center gap-1 rounded-full border-hairline border-ink/40 bg-paper px-2 py-px text-ink">
                            <Tag className="h-3.5 w-3.5 text-ink-muted" />
                            {product.category}
                          </span>
                        )}
                        {product.hsnCode && (
                          <span>
                            HSN <span className="font-mono">{product.hsnCode}</span>
                          </span>
                        )}
                        {product.barcodes.map((b) => (
                          <span key={b.id} className="font-mono" title="Linked barcode">
                            {b.barcode}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num px-4 py-3.5 text-right align-top font-extrabold whitespace-nowrap text-ink">
                      {formatINR(product.sellingPrice)}
                    </td>
                    <td className="num px-4 py-3.5 text-right align-top whitespace-nowrap text-ink-muted">
                      {product.mrp === null ? "-" : formatINR(product.mrp)}
                    </td>
                    <td className="num px-4 py-3.5 text-right align-top text-ink">
                      {product.gstRate}%
                    </td>
                    <td className="num px-4 py-3.5 text-right align-top text-sm whitespace-nowrap text-ink-muted">
                      {product.stockQty.toLocaleString("en-IN")} {product.uom}
                    </td>
                    {canManage && (
                      <td className="px-4 py-2 text-right align-top sm:px-6">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            square
                            onClick={() => setEditingProduct(product)}
                            title="Edit product"
                            aria-label={`Edit ${product.name}`}
                          >
                            <Edit2 className="h-5 w-5" />
                          </Button>
                          <Button
                            variant="ghost-danger"
                            size="sm"
                            square
                            onClick={() => handleDelete(product)}
                            disabled={deletingId === product.id}
                            title="Delete product"
                            aria-label={`Delete ${product.name}`}
                          >
                            <Trash2 className="h-5 w-5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Product Modal */}
      {canManage && isAddOpen && (
        <AddProductModal
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          onProductCreated={(newProd) => {
            setProducts((prev) => [newProd, ...prev]);
            setTotal((t) => t + 1);
          }}
        />
      )}

      {/* Edit Product Modal */}
      {canManage && editingProduct && (
        <EditProductModal
          key={editingProduct.id}
          isOpen={Boolean(editingProduct)}
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onProductUpdated={(updatedProd) => {
            setProducts((prev) =>
              prev.map((p) => (p.id === updatedProd.id ? updatedProd : p))
            );
          }}
        />
      )}
    </div>
  );
}
