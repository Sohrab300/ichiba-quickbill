"use client";

import { Banknote, CreditCard, Loader2, QrCode, type LucideIcon } from "lucide-react";
import { paymentLabel, type PaymentMethod } from "@/lib/constants";

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
