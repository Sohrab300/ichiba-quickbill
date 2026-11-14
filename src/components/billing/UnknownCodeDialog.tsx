"use client";

import { useState } from "react";
import { Link2, Loader2, PackagePlus, Search } from "lucide-react";
import { addProductBarcode } from "@/lib/actions";
import { formatINR } from "@/lib/format";
import type { Product } from "@/lib/supabase/mappers";
import { Modal } from "./Modal";
import { useProductSearch } from "./useProductSearch";

interface UnknownCodeDialogProps {
  /** The scanned code that matched nothing; null = closed. */
  code: string | null;
  onClose: () => void;
  /** The code is now linked to `product` (add it to the cart). */
  onLinked: (product: Product) => void;
  /** Open the "new product" form with this code prefilled. */
  onCreateNew: (code: string) => void;
}

/** Admin only: link an unknown barcode to an existing product, or create a new product. */
export function UnknownCodeDialog({ code, onClose, onLinked, onCreateNew }: UnknownCodeDialogProps) {
  return (
    <Modal open={code !== null} title="Code not in catalog" onClose={onClose} size="max-w-xl">
      {code !== null && (
        // Keyed so every new code starts with a clean search.
        <LinkForm key={code} code={code} onLinked={onLinked} onCreateNew={onCreateNew} />
      )}
    </Modal>
  );
}

function LinkForm({ code, onLinked, onCreateNew }: { code: string; onLinked: (p: Product) => void; onCreateNew: (code: string) => void }) {
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = useProductSearch(query, { limit: 20 });

  const link = async (product: Product) => {
    setLinking(product.id);
    setError(null);
    try {
      const res = await addProductBarcode(product.id, code);
      if (!res.success) {
        setError(res.error ?? "Could not link the barcode.");
        return;
      }
      onLinked({ ...product, barcodes: res.data ? [...product.barcodes, res.data] : product.barcodes });
    } catch {
      setError("Could not link the barcode. Check the connection and try again.");
    } finally {
      setLinking(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-base text-zinc-700 dark:text-zinc-300">
        <span className="rounded bg-zinc-200 px-2 py-0.5 font-mono font-bold text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50">{code}</span>{" "}
        did not match any barcode or item code.
      </p>

      <button
        type="button"
        onClick={() => onCreateNew(code)}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 text-base font-bold text-white hover:bg-emerald-800"
      >
        <PackagePlus className="h-5 w-5" aria-hidden />
        Create a new product with this barcode
      </button>

      <div className="space-y-2">
        <label htmlFor="link-search" className="block text-sm font-bold text-zinc-800 dark:text-zinc-200">
          …or link it to an existing product
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" aria-hidden />
          <input
            id="link-search"
            type="text"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or item code"
            className="h-12 w-full rounded-xl border-2 border-zinc-300 bg-white pl-10 pr-3 text-base focus:border-emerald-600 focus:outline-none dark:border-zinc-600 dark:bg-zinc-950"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-900 dark:bg-red-950/50 dark:text-red-200">
            {error}
          </p>
        )}

        {search.active && (
          <ul className="max-h-72 divide-y divide-zinc-200 overflow-y-auto rounded-xl border-2 border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {search.loading && (
              <li className="flex items-center gap-2 p-3 text-sm text-zinc-600">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </li>
            )}
            {!search.loading && search.products.length === 0 && (
              <li className="p-3 text-sm text-zinc-600 dark:text-zinc-400">{search.error ?? "No products found."}</li>
            )}
            {search.products.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {p.name}
                    {!p.isActive && <span className="ml-2 rounded bg-zinc-200 px-1.5 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">INACTIVE</span>}
                  </p>
                  <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                    {p.itemCode} · {formatINR(p.sellingPrice)}
                    {p.barcodes.length > 0 && ` · ${p.barcodes.length} barcode${p.barcodes.length > 1 ? "s" : ""}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => link(p)}
                  disabled={linking !== null}
                  className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg border-2 border-zinc-900 px-3 text-sm font-bold text-zinc-900 hover:bg-zinc-900 hover:text-white disabled:opacity-50 dark:border-zinc-200 dark:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900"
                >
                  {linking === p.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
                  Link
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
