"use client";

import { useState } from "react";
import { Link2, Loader2, PackagePlus, Search } from "lucide-react";
import { addProductBarcode } from "@/lib/actions";
import { formatINR } from "@/lib/format";
import type { Product } from "@/lib/supabase/mappers";
import { InlineAlert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, labelClasses } from "@/components/ui/Field";
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
      <p className="text-base text-ink">
        <span className="rounded-md border border-ink bg-surface px-2 py-0.5 font-mono font-bold text-ink">{code}</span>{" "}
        did not match any barcode or item code.
      </p>

      <Button variant="primary" size="lg" block onClick={() => onCreateNew(code)} className="text-base">
        <PackagePlus className="h-5 w-5" aria-hidden />
        Create a new product with this barcode
      </Button>

      <div className="space-y-2">
        <label htmlFor="link-search" className={`block ${labelClasses}`}>
          …or link it to an existing product
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input
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
            fieldSize="lg"
            withIcon
          />
        </div>

        {error && (
          <InlineAlert tone="danger" role="alert">
            {error}
          </InlineAlert>
        )}

        {search.active && (
          <ul className="max-h-72 divide-y divide-ink/15 overflow-y-auto rounded-card border border-ink bg-surface">
            {search.loading && (
              <li className="flex items-center gap-2 p-3 text-sm text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </li>
            )}
            {!search.loading && search.products.length === 0 && (
              <li className="p-3 text-sm text-ink-muted">{search.error ?? "No products found."}</li>
            )}
            {search.products.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">
                    {p.name}
                    {!p.isActive && <Badge className="ml-2">INACTIVE</Badge>}
                  </p>
                  <p className="text-sm text-ink-muted">
                    <span className="font-mono">{p.itemCode}</span> · <span className="num">{formatINR(p.sellingPrice)}</span>
                    {p.barcodes.length > 0 && (
                      <>
                        {" · "}
                        <span className="num">{p.barcodes.length}</span>
                        {` barcode${p.barcodes.length > 1 ? "s" : ""}`}
                      </>
                    )}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => link(p)} disabled={linking !== null} className="gap-1.5">
                  {linking === p.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
                  Link
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
