"use client";

import { useEffect, useState } from "react";
import { getProducts } from "@/lib/actions";
import type { Product } from "@/lib/supabase/mappers";

interface SearchResult {
  term: string;
  products: Product[];
  error: string | null;
}

/**
 * Debounced product search by name / item code / barcode.
 *
 * Server Actions are dispatched one at a time per page, so a search in flight delays the next
 * scan lookup: callers should only enable this for text a person is typing, not scanner input.
 */
export function useProductSearch(query: string, { enabled = true, limit = 8, delayMs = 250 } = {}) {
  const term = query.trim();
  const active = enabled && term.length >= 2;
  const [result, setResult] = useState<SearchResult | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getProducts({ query: term, limit })
        .then((res) => {
          if (cancelled) return;
          setResult(
            res.success && res.data
              ? { term, products: res.data.products, error: null }
              : { term, products: [], error: res.error ?? "Search failed" }
          );
        })
        .catch(() => {
          if (!cancelled) setResult({ term, products: [], error: "Search failed. Check the connection." });
        });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, term, limit, delayMs]);

  const current = active && result?.term === term ? result : null;
  return {
    /** Results for exactly the current query (never stale ones). */
    products: current?.products ?? [],
    error: current?.error ?? null,
    loading: active && current === null,
    active,
  };
}
