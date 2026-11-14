"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { createProduct } from "@/lib/actions";
import type { Product } from "@/lib/supabase/mappers";
import {
  ProductFormFields,
  emptyProductForm,
  formToValues,
  type ProductFormState,
} from "./ProductFormFields";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { DialogHeader, DialogOverlay, dialogPanelClasses } from "@/components/ui/Dialog";
import { fieldClasses, hintClasses, labelClasses } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";

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
    <DialogOverlay>
      <div className={cx("relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden", dialogPanelClasses)}>
        {/* Header */}
        <DialogHeader as="h3" title="Add New Product" icon={<Plus />} onClose={onClose} />

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {error && (
            <Alert tone="danger" size="sm">
              {error}
            </Alert>
          )}

          <ProductFormFields
            value={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />

          <div>
            <label
              htmlFor="add-barcode"
              className={`mb-1 block ${labelClasses}`}
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
              className={fieldClasses({ className: "font-mono" })}
            />
            <p className={`mt-1 ${hintClasses}`}>
              Scanning this barcode will find the product. The item code is always scannable too.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-ink/20 pt-4">
            <Button variant="ghost" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isLoading} className="px-5">
              {isLoading ? "Saving..." : "Save Product"}
            </Button>
          </div>
        </form>
      </div>
    </DialogOverlay>
  );
}
export default AddProductModal;
