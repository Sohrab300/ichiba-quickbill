"use client";

import { useEffect, useRef } from "react";
import { Minus, Plus, ShoppingCart, X } from "lucide-react";
import { formatINR } from "@/lib/format";
import type { CartAction, CartItem } from "@/lib/cart";
import { MAX_LINE_QTY } from "@/lib/constants";

interface CartTableProps {
  items: CartItem[];
  /** The most recently scanned line; `seq` changes on every scan so re-scans scroll too. */
  highlight: { productId: string; seq: number } | null;
  locked: boolean;
  dispatch: (action: CartAction) => void;
  /** Called after any button/qty action so focus can go back to the scan box. */
  onDone: () => void;
}

// One DOM per line: a card on phones, a table row (shared column template) from lg up.
const LG_COLUMNS =
  "lg:grid-cols-[2.5rem_minmax(0,1fr)_5.5rem_5.5rem_9.75rem_6.5rem_3rem] lg:items-center lg:gap-x-3 lg:gap-y-0 " +
  "lg:[grid-template-areas:'idx_name_mrp_price_qty_amount_remove']";
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 [grid-template-areas:'name_remove'_'qty_amount'] " + LG_COLUMNS;

export function CartTable({ items, highlight, locked, dispatch, onDone }: CartTableProps) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!highlight) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-product-id="${CSS.escape(highlight.productId)}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          <ShoppingCart className="h-8 w-8" aria-hidden />
        </div>
        <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Ready for the next customer</p>
        <p className="max-w-sm text-base text-zinc-600 dark:text-zinc-400">
          Scan an item with the barcode reader, use the camera, or type a name or item code.
        </p>
      </div>
    );
  }

  const act = (action: CartAction) => {
    dispatch(action);
    onDone();
  };

  return (
    <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <div
        className={`hidden lg:grid ${LG_COLUMNS} border-b-2 border-zinc-300 bg-zinc-100 px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400`}
        aria-hidden
      >
        <span className="[grid-area:idx]">#</span>
        <span className="[grid-area:name]">Item</span>
        <span className="text-right [grid-area:mrp]">MRP</span>
        <span className="text-right [grid-area:price]">Price</span>
        <span className="text-center [grid-area:qty]">Qty</span>
        <span className="text-right [grid-area:amount]">Amount</span>
        <span className="[grid-area:remove]" />
      </div>

      <ol ref={listRef} className="space-y-2 p-3 lg:min-h-0 lg:flex-1 lg:space-y-0 lg:overflow-y-auto lg:p-0" aria-label="Items in this bill">
        {items.map((item, index) => {
          const isNew = highlight?.productId === item.productId;
          return (
            <li
              key={item.productId}
              data-product-id={item.productId}
              className={`${ROW_GRID} rounded-xl border-2 p-3 lg:rounded-none lg:border-0 lg:border-b lg:px-3 lg:py-1.5 ${
                isNew
                  ? "border-emerald-600 bg-emerald-50 lg:border-l-4 lg:border-l-emerald-600 lg:border-b-zinc-200 dark:bg-emerald-950/40 dark:lg:border-b-zinc-800"
                  : "border-zinc-200 bg-white lg:border-b-zinc-200 dark:border-zinc-800 dark:bg-zinc-950 dark:lg:border-b-zinc-800"
              }`}
            >
              <span className="hidden text-sm font-semibold tabular-nums text-zinc-500 [grid-area:idx] lg:block">
                {index + 1}
              </span>

              <div className="min-w-0 [grid-area:name]">
                <p className="text-base font-semibold leading-snug text-zinc-950 lg:truncate dark:text-zinc-50" title={item.name}>
                  {item.name}
                </p>
                <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  {item.itemCode}
                  {item.hsnCode ? ` · HSN ${item.hsnCode}` : ""} · GST {item.gstRate}%
                  <span className="font-sans lg:hidden"> · {formatINR(item.unitPrice)} each</span>
                </p>
              </div>

              <span className="hidden text-right text-sm tabular-nums text-zinc-600 [grid-area:mrp] lg:block dark:text-zinc-400">
                {item.mrp !== null ? formatINR(item.mrp) : "—"}
              </span>
              <span className="hidden text-right text-sm font-medium tabular-nums [grid-area:price] lg:block">
                {formatINR(item.unitPrice)}
              </span>

              <div className="flex items-center gap-1 [grid-area:qty] lg:justify-center">
                <button
                  type="button"
                  disabled={locked || item.qty <= 1}
                  onClick={() => act({ type: "decrement", productId: item.productId })}
                  aria-label={`One less ${item.name}`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-30 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <input
                  // Uncontrolled and re-keyed on qty: typing is free-form, committed on blur/Enter,
                  // and a scan that bumps the qty refreshes the box.
                  key={item.qty}
                  defaultValue={item.qty}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={`Quantity of ${item.name}`}
                  disabled={locked}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                      onDone();
                    } else if (e.key === "Escape") {
                      e.currentTarget.value = String(item.qty);
                      e.currentTarget.blur();
                      onDone();
                    }
                  }}
                  onBlur={(e) => {
                    const qty = Number.parseInt(e.currentTarget.value.replace(/\D/g, ""), 10);
                    if (Number.isFinite(qty) && qty >= 1 && qty !== item.qty) {
                      dispatch({ type: "setQty", productId: item.productId, qty: Math.min(qty, MAX_LINE_QTY) });
                    } else {
                      e.currentTarget.value = String(item.qty);
                    }
                  }}
                  className="h-11 w-14 rounded-lg border-2 border-zinc-300 bg-white text-center text-lg font-bold tabular-nums text-zinc-950 focus:border-emerald-600 focus:outline-none disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <button
                  type="button"
                  disabled={locked || item.qty >= MAX_LINE_QTY}
                  onClick={() => act({ type: "increment", productId: item.productId })}
                  aria-label={`One more ${item.name}`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-30 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>

              <span className="self-center text-right text-lg font-bold tabular-nums text-zinc-950 [grid-area:amount] dark:text-zinc-50">
                {formatINR(item.unitPrice * item.qty)}
              </span>

              <button
                type="button"
                disabled={locked}
                onClick={() => act({ type: "remove", productId: item.productId })}
                aria-label={`Remove ${item.name}`}
                className="flex h-11 w-11 items-center justify-center justify-self-end rounded-lg text-zinc-500 [grid-area:remove] hover:bg-red-50 hover:text-red-700 disabled:opacity-30 dark:hover:bg-red-950/50"
              >
                <X className="h-5 w-5" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
