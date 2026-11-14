"use client";

import { useState } from "react";
import { X, Plus, AlertCircle } from "lucide-react";
import { createProduct } from "@/lib/actions";
import type { Product } from "@/lib/supabase/mappers";
import {
  ProductFormFields,
  emptyProductForm,
  formToValues,
  type ProductFormState,
} from "./ProductFormFields";

interface AddProductModalProps {
  isOpen: boolean;
  /** Code that was scanned and not found; linked to the new product as a barcode alias. */
  initialBarcode?: string;
  onClose: () => void;
  onProductCreated: (product: Product) => void;
}

export function AddProductModal({
  isOpen,
  initialBarcode = "",
  onClose,
  onProductCreated,
}: AddProductModalProps) {
  const [form, setForm] = useState<ProductFormState>(emptyProductForm);
  const [barcode, setBarcode] = useState(initialBarcode);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = formToValues(form);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const trimmedBarcode = barcode.trim();
    if (trimmedBarcode && !/^[!-~]{1,64}$/.test(trimmedBarcode)) {
      setError("Barcode: up to 64 characters, no spaces.");
      return;
    }

    setIsLoading(true);
    try {
      const result = await createProduct({
        ...parsed.values,
        barcode: trimmedBarcode || undefined,
      });

      if (!result.success || !result.data) {
        setError(result.error || "Failed to create product");
        return;
      }

      onProductCreated(result.data);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error creating product";
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
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <Plus className="h-4 w-4" />
            </div>
            <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
              Add New Product
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-900">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <ProductFormFields
            value={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            accent="emerald"
          />

          <div>
            <label
              htmlFor="add-barcode"
              className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1"
            >
              Manufacturer barcode (EAN)
            </label>
            <input
              id="add-barcode"
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Optional, e.g. 8901030865412"
              autoComplete="off"
              className="w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-mono text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Scanning this barcode will find the product. The item code is always scannable too.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
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
              disabled={isLoading}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-1.5"
            >
              {isLoading ? "Saving..." : "Save Product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
export default AddProductModal;
