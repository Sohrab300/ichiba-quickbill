"use client";

import { Banknote, Check, CheckCircle2, CreditCard, Loader2, QrCode, WifiOff, type LucideIcon } from "lucide-react";
import { paymentLabel, type PaymentMethod } from "@/lib/constants";
import { formatINR } from "@/lib/format";

export interface PaymentOption {
  method: PaymentMethod;
  label: string;
  /** KeyboardEvent.key that completes the sale with this method. */
  shortcut: "F7" | "F8" | "F9";
  icon: LucideIcon;
  className: string;
}

// REQUIREMENTS.md section 12: each payment button is "Complete & Print with this method".
export const PAYMENT_OPTIONS: readonly PaymentOption[] = [
  { method: "cash", label: "Cash", shortcut: "F7", icon: Banknote, className: "bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900" },
  { method: "upi", label: "UPI", shortcut: "F8", icon: QrCode, className: "bg-indigo-700 hover:bg-indigo-800 active:bg-indigo-900" },
  { method: "card", label: "Card", shortcut: "F9", icon: CreditCard, className: "bg-sky-800 hover:bg-sky-900 active:bg-sky-950" },
];

export { paymentLabel };

const MOBILE_SELECTED: Record<PaymentMethod, string> = {
  cash: "border-emerald-700 bg-emerald-700 text-white",
  upi: "border-indigo-700 bg-indigo-700 text-white",
  card: "border-sky-800 bg-sky-800 text-white",
};

interface PaymentButtonsProps {
  disabled: boolean;
  /** Method of the sale being submitted right now, if any. */
  busyMethod: PaymentMethod | null;
  onPay: (method: PaymentMethod) => void;
}

export function PaymentButtons({ disabled, busyMethod, onPay }: PaymentButtonsProps) {
  return (
    <div>
      <p className="mb-2 hidden text-xs font-bold uppercase tracking-wide text-zinc-600 lg:block dark:text-zinc-400">
        Complete &amp; print with
      </p>
      <div className="grid grid-cols-3 gap-2">
        {PAYMENT_OPTIONS.map(({ method, label, shortcut, icon: Icon, className }) => {
          const busy = busyMethod === method;
          return (
            <button
              key={method}
              type="button"
              disabled={disabled}
              onClick={() => onPay(method)}
              aria-keyshortcuts={shortcut}
              aria-label={`Complete and print, paid by ${label} (${shortcut})`}
              className={`relative flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 disabled:shadow-none lg:h-20 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 ${className}`}
            >
              <span className="flex items-center gap-2 text-lg font-bold lg:text-xl">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
                {label}
              </span>
              <kbd className="rounded bg-black/20 px-1.5 font-mono text-[11px] font-semibold">{shortcut}</kbd>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface MobilePaymentProps {
  /** The method toggled on, or null until the cashier picks one. */
  selected: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
  /** Completes the sale with `selected`. */
  onComplete: () => void;
  /** Sale in flight or status unknown, or this login cannot bill. */
  disabled: boolean;
  /** Nothing to bill yet (the method can still be picked). */
  empty: boolean;
  /** A sale is being saved right now. */
  busy: boolean;
  /** The device has no network: nothing can be sent. */
  offline: boolean;
  /** Preview grand total, paise. */
  total: number;
}

/**
 * Phones (< 1024px): payment method as three large toggles, then one Complete button. Two taps
 * instead of one, so the method is a deliberate choice; it resets after every sale. Desktop
 * keeps the one-press Cash/UPI/Card buttons with F7/F8/F9 (PaymentButtons).
 */
export function MobilePayment({ selected, onSelect, onComplete, disabled, empty, busy, offline, total }: MobilePaymentProps) {
  const label = busy
    ? "Saving sale…"
    : offline
      ? "Offline — can't complete"
      : empty
        ? "Scan items to bill"
        : selected
        ? `Complete · ${paymentLabel(selected)} · ${formatINR(total)}`
        : "Choose Cash, UPI or Card";

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-3 gap-2">
        {PAYMENT_OPTIONS.map(({ method, label: methodLabel, icon: Icon }) => {
          const on = selected === method;
          return (
            <button
              key={method}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onSelect(method)}
              className={`flex h-14 items-center justify-center gap-2 rounded-xl border-2 text-lg font-bold transition-colors disabled:opacity-50 ${
                on
                  ? MOBILE_SELECTED[method]
                  : "border-zinc-300 bg-white text-zinc-900 active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              }`}
            >
              {on ? <Check className="h-5 w-5" aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
              {methodLabel}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onComplete}
        disabled={disabled || empty || busy || offline || selected === null}
        className="flex h-16 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 text-lg font-extrabold text-white shadow-sm active:bg-emerald-900 disabled:bg-zinc-300 disabled:text-zinc-600 disabled:shadow-none dark:disabled:bg-zinc-800 dark:disabled:text-zinc-400"
      >
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        ) : offline ? (
          <WifiOff className="h-6 w-6" aria-hidden />
        ) : (
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        )}
        <span className="truncate tabular-nums">{label}</span>
      </button>
    </div>
  );
}
