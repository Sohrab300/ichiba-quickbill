"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chargedPrice, priceEditProblem, type CartItem } from "@/lib/cart";
import { shieldNextClick } from "@/lib/click-shield";
import { computeLineGst } from "@/lib/gst";
import { formatINR, paiseToRupeesInput, parseRupeesToPaise } from "@/lib/format";
import { outsidePress, ScanBurstDetector, type PriceEditMode } from "@/lib/price-edit";
import { Button } from "@/components/ui/Button";
import { fieldBase } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";

interface PriceEditPopoverProps {
  item: CartItem;
  /** The Price the cashier double-clicked / double-tapped; the popover sits right beside it. */
  anchor: HTMLElement;
  /** A new price for this bill (paise), or null for "Reset to original price". */
  onSave: (price: number | null) => void;
  /** Closed without saving (Esc, Discard, a press outside with nothing to save). */
  onClose: () => void;
  /** A barcode scanner typed into the popover: close it and bill this code as a normal scan. */
  onScan: (code: string) => void;
}

const GAP = 8;

/**
 * The per-bill price edit (REQUIREMENTS.md section 16): one ₹ field, the new line amount, Save and
 * Reset. Enter saves, Esc closes without saving.
 *
 * A press outside never runs what is under it (Cash/UPI/Card, +/−, Clear cart…): it is swallowed
 * and only closes the popover — or, if a valid new price was typed, turns it into
 * "Save new price ₹X?" (Save / Discard), which stays until the cashier picks one. The billing
 * screen treats the popover as an overlay (no payment shortcuts, no focus stealing) and puts
 * focus back in the scan box when it closes. A scanner burst typed into it is handed to the
 * normal scan handler instead of being lost. Rendered in a portal with fixed positioning so the
 * cart's scroll box can't clip it.
 */
export function PriceEditPopover({ item, anchor, onSave, onClose, onScan }: PriceEditPopoverProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const burst = useRef<ScanBurstDetector>(null);
  const inputId = useId();
  const messageId = useId();
  const [text, setText] = useState(() => paiseToRupeesInput(chargedPrice(item)));
  const [mode, setMode] = useState<PriceEditMode>({ kind: "edit" });
  /** Bumped on each press outside while asking, to draw attention to the question. */
  const [nudge, setNudge] = useState(0);

  const price = parseRupeesToPaise(text);
  const problem = priceEditProblem(item, price);
  const newAmount = problem === null && price !== null ? computeLineGst({ ...item, unitPrice: price }).lineTotal : null;
  const edited = item.editedPrice !== undefined;

  // Right of the price; else left of it; else below (or above) it, always inside the viewport.
  // Positioned straight on the DOM node before paint, and again on scroll/resize/mode change.
  useLayoutEffect(() => {
    const place = () => {
      const box = boxRef.current;
      if (!box) return;
      const a = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
      let left: number;
      let top: number;
      if (a.right + GAP + w <= vw - GAP) {
        left = a.right + GAP;
        top = a.top + a.height / 2 - h / 2;
      } else if (a.left - GAP - w >= GAP) {
        left = a.left - GAP - w;
        top = a.top + a.height / 2 - h / 2;
      } else {
        left = a.left + a.width / 2 - w / 2;
        top = a.bottom + GAP + h <= vh - GAP ? a.bottom + GAP : a.top - GAP - h;
      }
      box.style.left = `${clamp(left, GAP, vw - w - GAP)}px`;
      box.style.top = `${clamp(top, GAP, vh - h - GAP)}px`;
      box.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, mode.kind]);

  // Edit: the price field, text selected. Asking: the Save button (Enter saves, Esc discards).
  useEffect(() => {
    if (mode.kind === "confirm") {
      confirmRef.current?.focus({ preventScroll: true });
      return;
    }
    const input = inputRef.current;
    input?.focus({ preventScroll: true });
    input?.select();
  }, [mode.kind]);

  const pressedOutside = useEffectEvent(() => {
    const outcome = outsidePress(mode, item, text);
    if (outcome.next === "close") onClose();
    else if (outcome.next === "confirm") setMode({ kind: "confirm", price: outcome.price });
    else setNudge((n) => n + 1);
  });

  // A press anywhere outside is swallowed: no focus change, no click on what is under it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && boxRef.current?.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      shieldNextClick();
      pressedOutside();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const save = () => {
    if (problem === null && price !== null) onSave(price);
  };

  return createPortal(
    <div
      ref={boxRef}
      role={mode.kind === "confirm" ? "alertdialog" : "dialog"}
      aria-label={mode.kind === "confirm" ? `Save the new price of ${item.name}?` : `Price of ${item.name} on this bill`}
      // Hidden until placed (first layout effect), so it never flashes at 0,0.
      style={{ top: 0, left: 0, visibility: "hidden" }}
      className="fixed z-50 w-72 max-w-[calc(100vw-1rem)] rounded-card border-strong border-ink bg-surface p-3 shadow-hard"
      onKeyDownCapture={(e) => {
        // A scanner typing in here: bill the code as a scan rather than lose it (or save it as a price).
        burst.current ??= new ScanBurstDetector();
        const code = burst.current.key(e.key, e.timeStamp, e.repeat);
        if (code !== null) {
          e.preventDefault();
          e.stopPropagation();
          onScan(code);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {mode.kind === "confirm" ? (
        <div className="space-y-2">
          <p key={nudge} className={cx("text-base font-bold text-ink", nudge > 0 && "animate-pulse")}>
            Save new price <span className="num">{formatINR(mode.price)}</span>?
          </p>
          <p className="text-sm text-ink-muted">
            {item.name}: <span className="num">{item.qty}</span> × ={" "}
            <span className="num font-bold text-ink">
              {formatINR(computeLineGst({ ...item, unitPrice: mode.price }).lineTotal)}
            </span>
          </p>
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" size="sm" className="flex-1" onClick={onClose}>
              Discard
            </Button>
            <Button ref={confirmRef} variant="primary" size="sm" className="flex-1" onClick={() => onSave(mode.price)}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-2"
        >
          <label htmlFor={inputId} className="block text-xs font-bold tracking-wide text-ink-muted uppercase">
            Price on this bill (incl. GST)
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg font-bold text-ink-muted" aria-hidden>
              ₹
            </span>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={problem !== null}
              aria-describedby={messageId}
              // 16px+ text: iOS would zoom the page for anything smaller.
              className={cx(fieldBase, "num h-11 w-full pr-3 pl-8 text-right text-lg font-bold")}
            />
          </div>
          <p id={messageId} aria-live="polite" className={cx("min-h-5 text-sm", problem ? "font-semibold text-danger" : "text-ink")}>
            {problem ?? (
              <>
                <span className="num">{item.qty}</span> × ={" "}
                <span className="num font-extrabold">{newAmount !== null ? formatINR(newAmount) : "—"}</span>
              </>
            )}
          </p>
          <p className="text-xs text-ink-muted">
            Original <span className="num">{formatINR(item.unitPrice)}</span>
            {item.mrp !== null && (
              <>
                {" · MRP "}
                <span className="num">{formatINR(item.mrp)}</span>
              </>
            )}
          </p>
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" size="sm" className="flex-1 px-2" disabled={!edited} onClick={() => onSave(null)}>
              Reset to original price
            </Button>
            <Button type="submit" variant="primary" size="sm" className="px-5" disabled={problem !== null}>
              Save
            </Button>
          </div>
        </form>
      )}
    </div>,
    document.body
  );
}
