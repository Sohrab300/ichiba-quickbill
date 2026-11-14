"use client";

import { useState, useEffect } from "react";
import {
  Package,
  Plus,
  Search,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  Tag,
} from "lucide-react";
import { getProducts, deleteProduct, type ProductList } from "@/lib/actions";
import { formatINR } from "@/lib/format";
import type { Product } from "@/lib/supabase/mappers";
import AddProductModal from "@/components/AddProductModal";
import EditProductModal from "@/components/EditProductModal";

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2.5">
            <Package className="h-7 w-7 text-emerald-600" />
            Product Catalog
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1">
            Item codes, barcodes, selling price, MRP and GST. Prices include GST.
          </p>
        </div>

        {canManage && (
          <button
            onClick={() => setIsAddOpen(true)}
            className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors shadow-sm self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            <span>Add New Product</span>
          </button>
        )}
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, item code, barcode or category..."
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <button
          type="submit"
          className="h-11 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-medium text-xs sm:text-sm transition-colors"
        >
          Search
        </button>
        {searchQuery && (
          <button
            type="button"
            onClick={handleClearSearch}
            className="h-11 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs sm:text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Clear
          </button>
        )}
      </form>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-xs sm:text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-900">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && products.length > 0 && (
        <p className="text-xs text-zinc-500 -mt-3">
          {products.length < total
            ? `Showing ${products.length.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} products. Search to narrow down.`
            : `${total.toLocaleString("en-IN")} ${total === 1 ? "product" : "products"}`}
        </p>
      )}

      {/* Products Table */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-500">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            <span className="text-xs">Loading products...</span>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <Package className="h-12 w-12 text-zinc-300 dark:text-zinc-700 mb-3" />
            <h3 className="font-bold text-base text-zinc-800 dark:text-zinc-200">
              No products found
            </h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm">
              {searchQuery
                ? `No products matched "${searchQuery}". Try a different keyword.`
                : canManage
                  ? "No products in your catalog yet. Click 'Add New Product' above to create your first item."
                  : "No products in the catalog yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                  <th className="py-3 px-4 sm:px-6">Item code</th>
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4 text-right">Selling</th>
                  <th className="py-3 px-4 text-right">MRP</th>
                  <th className="py-3 px-4 text-right">GST</th>
                  <th className="py-3 px-4 text-right">Stock</th>
                  {canManage && <th className="py-3 px-4 sm:px-6 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
                {products.map((product) => (
                  <tr
                    key={product.id}
                    className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${product.isActive ? "" : "opacity-60"}`}
                  >
                    <td className="py-3.5 px-4 sm:px-6 font-mono text-xs text-zinc-600 dark:text-zinc-400 align-top">
                      {product.itemCode}
                    </td>
                    <td className="py-3.5 px-4 align-top">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 flex-wrap">
                        {product.name}
                        {!product.isActive && (
                          <span className="rounded-md bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-300">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                        {product.category && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-zinc-700 dark:text-zinc-300">
                            <Tag className="h-3 w-3 text-zinc-400" />
                            {product.category}
                          </span>
                        )}
                        {product.hsnCode && <span>HSN {product.hsnCode}</span>}
                        {product.barcodes.map((b) => (
                          <span key={b.id} className="font-mono" title="Linked barcode">
                            {b.barcode}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums align-top whitespace-nowrap">
                      {formatINR(product.sellingPrice)}
                    </td>
                    <td className="py-3.5 px-4 text-right text-zinc-600 dark:text-zinc-400 tabular-nums align-top whitespace-nowrap">
                      {product.mrp === null ? "-" : formatINR(product.mrp)}
                    </td>
                    <td className="py-3.5 px-4 text-right text-zinc-700 dark:text-zinc-300 tabular-nums align-top">
                      {product.gstRate}%
                    </td>
                    <td className="py-3.5 px-4 text-right text-xs text-zinc-500 tabular-nums align-top whitespace-nowrap">
                      {product.stockQty.toLocaleString("en-IN")} {product.uom}
                    </td>
                    {canManage && (
                      <td className="py-3.5 px-4 sm:px-6 text-right align-top">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setEditingProduct(product)}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                            title="Edit product"
                            aria-label={`Edit ${product.name}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(product)}
                            disabled={deletingId === product.id}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50"
                            title="Delete product"
                            aria-label={`Delete ${product.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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
