"use client";

import { parseRupeesToPaise, paiseToRupeesInput } from "@/lib/format";
import { GST_RATES, type GstRate } from "@/lib/constants";
import type { Product } from "@/lib/supabase/mappers";

export interface ProductFormState {
  itemCode: string;
  name: string;
  sellingRupees: string;
  mrpRupees: string;
  gstRate: string;
  hsnCode: string;
  uom: string;
  category: string;
  department: string;
  isActive: boolean;
}

export interface ProductFormValues {
  itemCode: string;
  name: string;
  sellingPrice: number;
  mrp: number | null;
  gstRate: GstRate;
  hsnCode: string | null;
  uom: string;
  category: string | null;
  department: string | null;
  isActive: boolean;
}

export const emptyProductForm: ProductFormState = {
  itemCode: "",
  name: "",
  sellingRupees: "",
  mrpRupees: "",
  gstRate: "18",
  hsnCode: "",
  uom: "PCS",
  category: "",
  department: "",
  isActive: true,
};

export function productToForm(p: Product): ProductFormState {
  return {
    itemCode: p.itemCode,
    name: p.name,
    sellingRupees: paiseToRupeesInput(p.sellingPrice),
    mrpRupees: paiseToRupeesInput(p.mrp),
    gstRate: String(p.gstRate),
    hsnCode: p.hsnCode ?? "",
    uom: p.uom,
    category: p.category ?? "",
    department: p.department ?? "",
    isActive: p.isActive,
  };
}

/** Client-side checks for quick feedback; the server validates again. */
export function formToValues(
  f: ProductFormState
): { ok: true; values: ProductFormValues } | { ok: false; error: string } {
  const itemCode = f.itemCode.trim();
  const name = f.name.trim();
  if (!/^[0-9A-Za-z_-]{1,32}$/.test(itemCode)) {
    return { ok: false, error: "Item code is required (letters, digits, - or _; up to 32)." };
  }
  if (!name) return { ok: false, error: "Product name is required." };

  const sellingPrice = parseRupeesToPaise(f.sellingRupees);
  if (sellingPrice === null) return { ok: false, error: "Enter a valid selling price in ₹ (e.g. 50 or 50.50)." };

  let mrp: number | null = null;
  if (f.mrpRupees.trim()) {
    mrp = parseRupeesToPaise(f.mrpRupees);
    if (mrp === null) return { ok: false, error: "Enter a valid MRP in ₹, or leave it empty." };
    if (sellingPrice > mrp) return { ok: false, error: "Selling price cannot be above MRP." };
  }

  const gstRate = Number(f.gstRate) as GstRate;
  if (!(GST_RATES as readonly number[]).includes(gstRate)) return { ok: false, error: "Choose a GST rate." };

  const hsnCode = f.hsnCode.trim();
  if (hsnCode && !/^\d{4,8}$/.test(hsnCode)) return { ok: false, error: "HSN code must be 4–8 digits." };

  const uom = f.uom.trim().toUpperCase();
  if (!uom) return { ok: false, error: "UOM is required (e.g. PCS)." };

  return {
    ok: true,
    values: {
      itemCode,
      name,
      sellingPrice,
      mrp,
      gstRate,
      hsnCode: hsnCode || null,
      uom,
      category: f.category.trim() || null,
      department: f.department.trim() || null,
      isActive: f.isActive,
    },
  };
}

const ACCENT = {
  emerald: "focus:border-emerald-500 focus:ring-emerald-500/20",
  blue: "focus:border-blue-500 focus:ring-blue-500/20",
} as const;

interface ProductFormFieldsProps {
  value: ProductFormState;
  onChange: (patch: Partial<ProductFormState>) => void;
  accent?: keyof typeof ACCENT;
  showActive?: boolean;
}

export function ProductFormFields({
  value,
  onChange,
  accent = "emerald",
  showActive = false,
}: ProductFormFieldsProps) {
  const input = `w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 shadow-sm focus:outline-none focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 ${ACCENT[accent]}`;
  const label = "block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1";

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label} htmlFor="pf-item-code">Item code *</label>
          <input
            id="pf-item-code"
            type="text"
            value={value.itemCode}
            onChange={(e) => onChange({ itemCode: e.target.value })}
            placeholder="e.g. 7021317"
            required
            autoComplete="off"
            className={`${input} font-mono`}
          />
        </div>
        <div className="col-span-2">
          <label className={label} htmlFor="pf-name">Product name *</label>
          <input
            id="pf-name"
            type="text"
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. 12 GRABS 10 ELEMENTS VITA SERUM 50 ML"
            required
            className={input}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label} htmlFor="pf-selling">Selling ₹ (incl. GST) *</label>
          <input
            id="pf-selling"
            type="text"
            inputMode="decimal"
            value={value.sellingRupees}
            onChange={(e) => onChange({ sellingRupees: e.target.value })}
            placeholder="0.00"
            required
            className={`${input} tabular-nums`}
          />
        </div>
        <div>
          <label className={label} htmlFor="pf-mrp">MRP ₹</label>
          <input
            id="pf-mrp"
            type="text"
            inputMode="decimal"
            value={value.mrpRupees}
            onChange={(e) => onChange({ mrpRupees: e.target.value })}
            placeholder="0.00"
            className={`${input} tabular-nums`}
          />
        </div>
        <div>
          <label className={label} htmlFor="pf-gst">GST % *</label>
          <select
            id="pf-gst"
            value={value.gstRate}
            onChange={(e) => onChange({ gstRate: e.target.value })}
            className={input}
          >
            {GST_RATES.map((r) => (
              <option key={r} value={String(r)}>
                {r}%
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label} htmlFor="pf-hsn">HSN code</label>
          <input
            id="pf-hsn"
            type="text"
            inputMode="numeric"
            value={value.hsnCode}
            onChange={(e) => onChange({ hsnCode: e.target.value })}
            placeholder="e.g. 33049990"
            className={`${input} font-mono`}
          />
        </div>
        <div>
          <label className={label} htmlFor="pf-uom">UOM *</label>
          <input
            id="pf-uom"
            type="text"
            value={value.uom}
            onChange={(e) => onChange({ uom: e.target.value })}
            placeholder="PCS"
            required
            className={input}
          />
        </div>
        <div>
          <label className={label} htmlFor="pf-dept">Department</label>
          <input
            id="pf-dept"
            type="text"
            value={value.department}
            onChange={(e) => onChange({ department: e.target.value })}
            className={input}
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="pf-category">Category</label>
        <input
          id="pf-category"
          type="text"
          value={value.category}
          onChange={(e) => onChange({ category: e.target.value })}
          placeholder="e.g. Beauty & Personal Care"
          className={input}
        />
      </div>

      {showActive && (
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={value.isActive}
            onChange={(e) => onChange({ isActive: e.target.checked })}
            className="h-4 w-4 rounded border-zinc-300"
          />
          Active (inactive products cannot be billed)
        </label>
      )}
    </>
  );
}

export default ProductFormFields;
