"use client";

import { useState, useEffect } from "react";
import {
  ReceiptText,
  Calendar,
  Package,
  ChevronRight,
  Loader2,
  AlertCircle,
  X,
  Receipt,
  Clock,
} from "lucide-react";
import { getSales, type SaleSummary } from "@/lib/actions";
import { formatINR, formatDateTime } from "@/lib/format";

export default function SalesPage() {
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected sale for receipt/line items modal
  const [selectedSale, setSelectedSale] = useState<SaleSummary | null>(null);

  useEffect(() => {
    let isMounted = true;
    getSales()
      .then((res) => {
        if (!isMounted) return;
        if (res.success && res.data) {
          setSales(res.data);
        } else {
          setError(res.error || "Failed to load sales history");
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : "Error loading sales";
        setError(msg);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2.5">
          <ReceiptText className="h-7 w-7 text-emerald-600" />
          Sales History
        </h1>
        <p className="text-xs sm:text-sm text-zinc-500 mt-1">
          Review past transactions, item counts, totals, and line item receipts.
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-xs sm:text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-900">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Sales List Container */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-500">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            <span className="text-xs">Loading sales history...</span>
          </div>
        ) : sales.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <Receipt className="h-12 w-12 text-zinc-300 dark:text-zinc-700 mb-3" />
            <h3 className="font-bold text-base text-zinc-800 dark:text-zinc-200">
              No sales recorded yet
            </h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm">
              Completed sales from the Billing screen will appear here with full line item details.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sales.map((sale) => (
              <div
                key={sale.id}
                onClick={() => setSelectedSale(sale)}
                className="flex items-center justify-between p-4 sm:p-5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 cursor-pointer transition-colors group"
              >
                {/* Left: Date & Sale ID */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{formatDateTime(sale.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
                      #{sale.id.slice(0, 8)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      <Package className="h-3 w-3" />
                      {sale.itemCount} {sale.itemCount === 1 ? "item" : "items"}
                    </span>
                  </div>
                </div>

                {/* Right: Subtotal & Arrow */}
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[10px] uppercase font-bold text-zinc-400">
                      Total
                    </div>
                    <div className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400">
                      {formatINR(sale.subtotal)}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sale Details / Receipt Modal */}
      {selectedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <Receipt className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                    Sale Receipt
                  </h3>
                  <p className="text-[11px] font-mono text-zinc-400">
                    ID: {selectedSale.id}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedSale(null)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Meta info */}
            <div className="px-5 py-3 bg-zinc-50 dark:bg-zinc-800/40 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-zinc-400" />
                <span>{formatDateTime(selectedSale.createdAt)}</span>
              </div>
              <div>
                <span>{selectedSale.itemCount} items purchased</span>
              </div>
            </div>

            {/* Line Items List */}
            <div className="flex-1 overflow-y-auto p-5 divide-y divide-zinc-100 dark:divide-zinc-800">
              {selectedSale.items && selectedSale.items.length > 0 ? (
                selectedSale.items.map((item) => {
                  const lineTotal = item.unitPrice * item.quantity;
                  return (
                    <div key={item.id} className="py-3 first:pt-0 last:pb-0 flex justify-between gap-3">
                      <div>
                        <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                          {item.productName}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {formatINR(item.unitPrice)} × {item.quantity}
                        </div>
                      </div>
                      <div className="text-right font-bold text-sm text-zinc-900 dark:text-zinc-100">
                        {formatINR(lineTotal)}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-6 text-center text-xs text-zinc-400">
                  No line item details found for this sale.
                </div>
              )}
            </div>

            {/* Total Footer */}
            <div className="border-t border-zinc-200 dark:border-zinc-800 p-5 bg-zinc-50/70 dark:bg-zinc-800/30">
              <div className="flex justify-between items-center">
                <span className="font-extrabold text-sm text-zinc-700 dark:text-zinc-300">
                  Total Paid
                </span>
                <span className="font-black text-xl text-emerald-600 dark:text-emerald-400">
                  {formatINR(selectedSale.subtotal)}
                </span>
              </div>
              <button
                onClick={() => setSelectedSale(null)}
                className="mt-4 w-full py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-medium text-xs transition-colors"
              >
                Close Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
