"use client";

import { useRef } from "react";
import type { CartAction, CartItem } from "@/lib/cart";
import { ScanBurstDetector, SCAN_KEY_GAP_MS } from "@/lib/price-edit";
import { formatQty, parseQty } from "@/lib/qty";
import { fieldBase } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";

/**
 * Text typed in a line's qty box that is not settled yet. `show`: the problem (if any) is shown
 * — at once for a definite mistake, only after leaving the box for an unfinished one ("", "0.").
 */
export interface QtyDraft {
  text: string;
  show: boolean;
}

/** Why the line's draft can't be billed, or null (no draft, or a valid one). Blocks payment. */
export function qtyDraftProblem(item: Pick<CartItem, "soldByWeight">, draft: QtyDraft | undefined): string | null {
  if (draft === undefined) return null;
  const parsed = parseQty(draft.text, item.soldByWeight);
  return parsed.ok ? null : parsed.error;
}

/** While typing, these just mean "not finished yet". */
function isUnfinished(text: string): boolean {
  return /^0*\.?0*$/.test(text.trim());
}

/** Keys that don't type a character but may sit inside a scanner burst (as in ScanBurstDetector). */
const NEUTRAL_KEYS = new Set(["Shift", "CapsLock"]);

interface QtyInputProps {
  item: CartItem;
  /** Owned by the billing screen, which blocks payment while any line's draft is invalid. */
  draft: QtyDraft | undefined;
  onDraft: (draft: QtyDraft | null) => void;
  locked: boolean;
  dispatch: (action: CartAction) => void;
  /** After Enter / Esc / a scan: give focus back to the scan box. */
  onDone: () => void;
  /** A barcode scanner typed into this box: bill the code as a normal scan instead. */
  onScan: (code: string) => void;
  /** id of the element the row renders the problem in. */
  messageId: string;
}

/**
 * The qty box of a cart line (REQUIREMENTS.md sections 13 and 17).
 *
 * - Pieces: whole numbers 1–9,999 (numeric keypad). Sold by weight: kg with up to 3 decimals,
 *   0.001–999.999 (decimal keypad), e.g. ".250".
 * - Every valid keystroke goes straight into the cart, so the amount, the total and a payment
 *   shortcut pressed right away all use exactly what is in the box.
 * - Invalid text stays in the box with a message, and payment is blocked until it is fixed.
 * - Enter settles a valid value and returns to the scan box; Esc restores the qty the line had
 *   when the box was focused.
 * - A keyboard-wedge scanner typing into the box (the price edit's burst rule): the box and the
 *   line are put back exactly as they were before the burst, and the code is billed as a scan.
 */
export function QtyInput({ item, draft, onDraft, locked, dispatch, onDone, onScan, messageId }: QtyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const burst = useRef<ScanBurstDetector>(null);
  const lastKeyAt = useRef(Number.NEGATIVE_INFINITY);
  /** Box and line before the current run of fast keys (restored if the run is a scan). */
  const runStart = useRef<{ draft: QtyDraft | undefined; qtyMilli: number } | null>(null);
  /** The line's qty when the box got focus (Esc goes back to it). */
  const focusQty = useRef(item.qtyMilli);
  /** Enter / Esc / a scan already settled the box; the blur that follows must not redo it. */
  const settled = useRef(false);

  const text = draft?.text ?? formatQty(item.qtyMilli, item.soldByWeight);
  const problem = qtyDraftProblem(item, draft);
  const showing = problem !== null && draft?.show === true;

  const setQtyMilli = (qtyMilli: number) => {
    if (qtyMilli !== item.qtyMilli) dispatch({ type: "setQty", productId: item.productId, qtyMilli });
  };

  const finish = () => {
    settled.current = true;
    inputRef.current?.blur();
    settled.current = false;
    onDone();
  };

  return (
    <input
      ref={inputRef}
      data-qty-input=""
      value={text}
      type="text"
      inputMode={item.soldByWeight ? "decimal" : "numeric"}
      autoComplete="off"
      spellCheck={false}
      enterKeyHint="done"
      aria-label={item.soldByWeight ? `Weight of ${item.name} in kg` : `Quantity of ${item.name}`}
      aria-invalid={showing || undefined}
      aria-describedby={showing ? messageId : undefined}
      disabled={locked}
      onFocus={(e) => {
        focusQty.current = item.qtyMilli;
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const next = e.currentTarget.value;
        const parsed = parseQty(next, item.soldByWeight);
        if (parsed.ok) setQtyMilli(parsed.qtyMilli);
        onDraft({ text: next, show: !parsed.ok && !isUnfinished(next) });
      }}
      onKeyDown={(e) => {
        if (!NEUTRAL_KEYS.has(e.key)) {
          // A key after a pause starts a new run; remember the state before it.
          if (e.timeStamp - lastKeyAt.current > SCAN_KEY_GAP_MS) runStart.current = { draft, qtyMilli: item.qtyMilli };
          lastKeyAt.current = e.timeStamp;
        }
        burst.current ??= new ScanBurstDetector();
        const code = burst.current.key(e.key, e.timeStamp, e.repeat);
        if (code !== null) {
          e.preventDefault();
          e.stopPropagation();
          const before = runStart.current;
          if (before) {
            setQtyMilli(before.qtyMilli);
            onDraft(before.draft ?? null);
          }
          onScan(code);
          finish();
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();
          if (parseQty(text, item.soldByWeight).ok) {
            onDraft(null);
            finish();
          } else {
            onDraft({ text, show: true }); // stay in the box until it is fixed (or Esc)
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          setQtyMilli(focusQty.current);
          onDraft(null);
          finish();
        }
      }}
      onBlur={() => {
        if (settled.current || draft === undefined) return;
        const trimmed = draft.text.trim();
        // Empty: the line keeps its qty. Valid: shown again in standard form ("0.25" -> "0.250").
        if (trimmed === "" || parseQty(trimmed, item.soldByWeight).ok) onDraft(null);
        else if (!draft.show) onDraft({ ...draft, show: true });
      }}
      className={cx(
        fieldBase,
        "num h-11 px-1 text-center text-lg font-bold",
        item.soldByWeight ? "w-20" : "w-14",
        showing && "border-danger"
      )}
    />
  );
}
