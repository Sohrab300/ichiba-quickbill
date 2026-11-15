"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Minus, Plus, X } from "lucide-react";
import { formatINR } from "@/lib/format";
import { chargedPrice, type CartAction, type CartItem } from "@/lib/cart";
import { MAX_LINE_QTY } from "@/lib/constants";
import { Basket } from "@/components/brand/Illustrations";
import { Button } from "@/components/ui/Button";
import { fieldBase } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";

/** A cart line with its preview amount (src/lib/gst.ts, on the charged price). */
export type CartTableLine = CartItem & { lineTotal: number };

interface CartTableProps {
  items: CartTableLine[];
  /** The most recently scanned line; `seq` changes on every scan so re-scans scroll too. */
  highlight: { productId: string; seq: number } | null;
  locked: boolean;
  dispatch: (action: CartAction) => void;
  /** Called after any button/qty action so focus can go back to the scan box. */
  onDone: () => void;
  /** Double-click / double-tap on a line's Price: open the price edit beside `anchor`. */
  onEditPrice: (productId: string, anchor: HTMLElement) => void;
}

/** Two taps closer than this (ms) count as a double-tap. */
const DOUBLE_TAP_MS = 400;

/**
 * A line's price; double-click (mouse) or double-tap (touch) opens the per-bill price edit.
 * Pressing it never moves focus or selects text, so the scan box keeps the scanner's input.
 * An edited price is shown in a heavier weight with a dotted underline (cashier hint only).
 */
function PriceTrigger({
  item,
  locked,
  onEdit,
  className,
  children,
}: {
  item: CartItem;
  locked: boolean;
  onEdit: (anchor: HTMLElement) => void;
  className?: string;
  children: ReactNode;
}) {
  const lastTap = useRef(0);
  const edited = item.editedPrice !== undefined;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-disabled={locked || undefined}
      aria-label={`Price of ${item.name}: ${formatINR(chargedPrice(item))}. Double-click to change it for this bill.`}
      title={locked ? undefined : "Double-click to change the price for this bill"}
      onMouseDown={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if (!locked) onEdit(e.currentTarget);
      }}
      onPointerUp={(e) => {
        if (e.pointerType === "mouse") return; // mice use dblclick
        const now = e.timeStamp;
        if (now - lastTap.current < DOUBLE_TAP_MS) {
          lastTap.current = 0;
          if (!locked) onEdit(e.currentTarget);
        } else {
          lastTap.current = now;
        }
      }}
      className={cx(
        "num touch-manipulation rounded-sm select-none",
        !locked && "cursor-pointer hover:bg-paper-2",
        edited && "font-extrabold underline decoration-dotted decoration-2 underline-offset-4",
        className
      )}
    >
      {children}
    </button>
  );
}

// One DOM per line: a card on phones, a table row (shared column template) from lg up.
const LG_COLUMNS =
  "lg:grid-cols-[2.5rem_minmax(0,1fr)_5.5rem_5.5rem_9.75rem_6.5rem_3rem] lg:items-center lg:gap-x-3 lg:gap-y-0 " +
  "lg:[grid-template-areas:'idx_name_mrp_price_qty_amount_remove']";
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 [grid-template-areas:'name_remove'_'qty_amount'] " + LG_COLUMNS;

export function CartTable({ items, highlight, locked, dispatch, onDone, onEditPrice }: CartTableProps) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!highlight) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-product-id="${CSS.escape(highlight.productId)}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <Basket className="h-24 w-24" />
        <p className="font-display text-2xl leading-tight font-bold text-ink">Ready for the next customer</p>
        <p className="max-w-sm text-base text-ink-muted">
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
        className={`hidden lg:grid ${LG_COLUMNS} bg-ink px-3 py-2 text-xs font-bold tracking-wide text-paper uppercase`}
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
              className={cx(
                ROW_GRID,
                "rounded-card border p-3 shadow-hard-sm lg:rounded-none lg:border-0 lg:border-b-hairline lg:border-b-ink/20 lg:px-3 lg:py-1.5 lg:shadow-none",
                isNew ? "border-brand bg-brand-soft lg:border-l-[5px] lg:border-l-brand" : "border-ink bg-surface"
              )}
            >
              <span className="num hidden text-sm font-bold text-ink-muted [grid-area:idx] lg:block">
                {index + 1}
              </span>

              <div className="min-w-0 [grid-area:name]">
                <p className="text-base leading-snug font-bold text-ink lg:truncate" title={item.name}>
                  {item.name}
                </p>
                <p className="text-sm text-ink-muted lg:truncate">
                  <span className="font-mono">{item.itemCode}</span>
                  {item.hsnCode && (
                    <>
                      {" · HSN "}
                      <span className="font-mono">{item.hsnCode}</span>
                    </>
                  )}
                  {" · GST "}
                  <span className="num">{item.gstRate}%</span>
                  <span className="lg:hidden">
                    {" · "}
                    <PriceTrigger
                      item={item}
                      locked={locked}
                      onEdit={(anchor) => onEditPrice(item.productId, anchor)}
                      className="-mx-1 px-1 py-0.5 text-ink"
                    >
                      {formatINR(chargedPrice(item))}
                    </PriceTrigger>{" "}
                    each
                  </span>
                </p>
              </div>

              <span className="num hidden text-right text-sm text-ink-muted [grid-area:mrp] lg:block">
                {item.mrp !== null ? formatINR(item.mrp) : "—"}
              </span>
              <span className="hidden text-right text-sm font-semibold [grid-area:price] lg:block">
                <PriceTrigger
                  item={item}
                  locked={locked}
                  onEdit={(anchor) => onEditPrice(item.productId, anchor)}
                  className="-mr-1 px-1 py-1"
                >
                  {formatINR(chargedPrice(item))}
                </PriceTrigger>
              </span>

              <div className="flex items-center gap-1 [grid-area:qty] lg:justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  square
                  disabled={locked || item.qty <= 1}
                  onClick={() => act({ type: "decrement", productId: item.productId })}
                  aria-label={`One less ${item.name}`}
                >
                  <Minus className="h-5 w-5" />
                </Button>
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
                  className={cx(fieldBase, "num h-11 w-14 text-center text-lg font-bold")}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  square
                  disabled={locked || item.qty >= MAX_LINE_QTY}
                  onClick={() => act({ type: "increment", productId: item.productId })}
                  aria-label={`One more ${item.name}`}
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>

              <span className="num self-center text-right text-lg font-extrabold text-ink [grid-area:amount]">
                {formatINR(item.lineTotal)}
              </span>

              <Button
                variant="ghost-danger"
                size="sm"
                square
                disabled={locked}
                onClick={() => act({ type: "remove", productId: item.productId })}
                aria-label={`Remove ${item.name}`}
                className="justify-self-end [grid-area:remove]"
              >
                <X className="h-5 w-5" />
              </Button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
