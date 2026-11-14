"use client";

import { useState } from "react";
import { X, Edit3, Barcode, Loader2 } from "lucide-react";
import { updateProduct, addProductBarcode, removeProductBarcode } from "@/lib/actions";
import type { Product, ProductBarcode } from "@/lib/supabase/mappers";
import {
  ProductFormFields,
  formToValues,
  productToForm,
  type ProductFormState,
} from "./ProductFormFields";
import { Alert, InlineAlert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { DialogHeader, DialogOverlay, dialogPanelClasses } from "@/components/ui/Dialog";
import { fieldClasses } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";

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
    <DialogOverlay>
      <div className={cx("relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden", dialogPanelClasses)}>
        {/* Header */}
        <DialogHeader as="h3" title="Edit Product" icon={<Edit3 />} onClose={onClose} />

        <div className="overflow-y-auto">
          {/* Product fields */}
          <form id="edit-product-form" onSubmit={handleSubmit} className="p-5 space-y-4">
            {error && (
              <Alert tone="danger" size="sm">
                {error}
              </Alert>
            )}
            <ProductFormFields
              value={form}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              showActive
            />
          </form>

          {/* Barcode aliases (saved immediately) */}
          <div className="px-5 pb-5 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-ink">
              <Barcode className="h-4 w-4" />
              Manufacturer barcodes
              <span className="font-normal text-ink-muted">(changes save immediately)</span>
            </div>
            {barcodeError && <InlineAlert tone="danger">{barcodeError}</InlineAlert>}
            {barcodes.length === 0 ? (
              <p className="text-sm text-ink-muted">
                None linked. The item code <span className="font-mono">{product.itemCode}</span> is
                always scannable.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {barcodes.map((b) => (
                  <li
                    key={b.id}
                    className="inline-flex items-center gap-1 rounded-full border border-ink bg-surface py-0.5 pr-1 pl-2.5 font-mono text-sm text-ink"
                  >
                    {b.barcode}
                    <button
                      type="button"
                      onClick={() => handleRemoveBarcode(b)}
                      disabled={barcodeBusy !== null}
                      aria-label={`Unlink barcode ${b.barcode}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    >
                      {barcodeBusy === b.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
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
                className={fieldClasses({ className: "flex-1 font-mono" })}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddBarcode}
                disabled={barcodeBusy !== null || !newBarcode.trim()}
              >
                {barcodeBusy === "add" ? "Linking..." : "Link"}
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-ink bg-surface px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" form="edit-product-form" variant="primary" disabled={isLoading} className="px-5">
            {isLoading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </DialogOverlay>
  );
}
export default EditProductModal;
