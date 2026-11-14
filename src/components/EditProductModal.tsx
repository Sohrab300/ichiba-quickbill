"use client";

import { useState } from "react";
import { X, Edit3, AlertCircle, Barcode, Loader2 } from "lucide-react";
import { updateProduct, addProductBarcode, removeProductBarcode } from "@/lib/actions";
import type { Product, ProductBarcode } from "@/lib/supabase/mappers";
import {
  ProductFormFields,
  formToValues,
  productToForm,
  type ProductFormState,
} from "./ProductFormFields";

interface EditProductModalProps {
  isOpen: boolean;
  product: Product;
  onClose: () => void;
  onProductUpdated: (product: Product) => void;
}

export function EditProductModal({
  isOpen,
  product,
  onClose,
  onProductUpdated,
}: EditProductModalProps) {
  const [form, setForm] = useState<ProductFormState>(() => productToForm(product));
  const [barcodes, setBarcodes] = useState<ProductBarcode[]>(product.barcodes);
  const [newBarcode, setNewBarcode] = useState("");
  const [barcodeBusy, setBarcodeBusy] = useState<string | null>(null); // "add" or barcode id
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const publishBarcodes = (next: ProductBarcode[]) => {
    setBarcodes(next);
    onProductUpdated({ ...product, barcodes: next });
  };

  const handleAddBarcode = async () => {
    const code = newBarcode.trim();
    setBarcodeError(null);
    if (!/^[!-~]{1,64}$/.test(code)) {
      setBarcodeError("Barcode: up to 64 characters, no spaces.");
      return;
    }
    setBarcodeBusy("add");
    try {
      const res = await addProductBarcode(product.id, code);
      if (!res.success || !res.data) {
        setBarcodeError(res.error || "Failed to link barcode");
        return;
      }
      publishBarcodes([...barcodes, res.data].sort((a, b) => a.barcode.localeCompare(b.barcode)));
      setNewBarcode("");
    } catch (err: unknown) {
      setBarcodeError(err instanceof Error ? err.message : "Failed to link barcode");
    } finally {
      setBarcodeBusy(null);
    }
  };

  const handleRemoveBarcode = async (b: ProductBarcode) => {
    if (!confirm(`Unlink barcode ${b.barcode} from this product?`)) return;
    setBarcodeError(null);
    setBarcodeBusy(b.id);
    try {
      const res = await removeProductBarcode(b.id);
      if (!res.success) {
        setBarcodeError(res.error || "Failed to remove barcode");
        return;
      }
      publishBarcodes(barcodes.filter((x) => x.id !== b.id));
    } catch (err: unknown) {
      setBarcodeError(err instanceof Error ? err.message : "Failed to remove barcode");
    } finally {
      setBarcodeBusy(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = formToValues(form);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setIsLoading(true);
    try {
      const result = await updateProduct(product.id, parsed.values);

      if (!result.success || !result.data) {
        setError(result.error || "Failed to update product");
        return;
      }

      onProductUpdated(result.data);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error updating product";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Edit3 className="h-4 w-4" />
            </div>
            <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
              Edit Product
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto">
          {/* Product fields */}
          <form id="edit-product-form" onSubmit={handleSubmit} className="p-5 space-y-4">
            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-900">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <ProductFormFields
              value={form}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              accent="blue"
              showActive
            />
          </form>

          {/* Barcode aliases (saved immediately) */}
          <div className="px-5 pb-5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <Barcode className="h-3.5 w-3.5" />
              Manufacturer barcodes
              <span className="font-normal text-zinc-500">(changes save immediately)</span>
            </div>
            {barcodeError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
                {barcodeError}
              </div>
            )}
            {barcodes.length === 0 ? (
              <p className="text-xs text-zinc-500">
                None linked. The item code <span className="font-mono">{product.itemCode}</span> is
                always scannable.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {barcodes.map((b) => (
                  <li
                    key={b.id}
                    className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 pl-2 pr-1 py-0.5 font-mono text-xs text-zinc-700 dark:text-zinc-300"
                  >
                    {b.barcode}
                    <button
                      type="button"
                      onClick={() => handleRemoveBarcode(b)}
                      disabled={barcodeBusy !== null}
                      aria-label={`Unlink barcode ${b.barcode}`}
                      className="rounded p-0.5 text-zinc-400 hover:text-red-600 disabled:opacity-50"
                    >
                      {barcodeBusy === b.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newBarcode}
                onChange={(e) => setNewBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddBarcode();
                  }
                }}
                placeholder="Scan or type an EAN to link"
                autoComplete="off"
                aria-label="New barcode"
                className="flex-1 rounded-xl border border-zinc-300 bg-white px-3.5 py-2 text-sm font-mono text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={handleAddBarcode}
                disabled={barcodeBusy !== null || !newBarcode.trim()}
                className="px-3 rounded-xl text-xs font-semibold border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                {barcodeBusy === "add" ? "Linking..." : "Link"}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-product-form"
            disabled={isLoading}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {isLoading ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
export default EditProductModal;
