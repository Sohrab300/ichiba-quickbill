"use client";

import { Banknote, Check, CheckCircle2, CreditCard, Loader2, QrCode, WifiOff, type LucideIcon } from "lucide-react";
import { paymentLabel, type PaymentMethod } from "@/lib/constants";
import { formatINR } from "@/lib/format";
import { Kbd } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export interface PaymentOption {
  method: PaymentMethod;
  label: string;
  /** KeyboardEvent.key that completes the sale with this method. */
  shortcut: "F7" | "F8" | "F9";
  icon: LucideIcon;
}

// REQUIREMENTS.md section 12: each payment button is "Complete & Print with this method".
export const PAYMENT_OPTIONS: readonly PaymentOption[] = [
  { method: "cash", label: "Cash", shortcut: "F7", icon: Banknote },
  { method: "upi", label: "UPI", shortcut: "F8", icon: QrCode },
  { method: "card", label: "Card", shortcut: "F9", icon: CreditCard },
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
      <p className="mb-2 hidden text-xs font-bold tracking-wide text-ink-muted uppercase lg:block">
        Complete &amp; print with
      </p>
      <div className="grid grid-cols-3 gap-3">
        {PAYMENT_OPTIONS.map(({ method, label, shortcut, icon: Icon }) => {
          const busy = busyMethod === method;
          return (
            <Button
              key={method}
              variant="primary"
              size="xl"
              disabled={disabled}
              onClick={() => onPay(method)}
              aria-keyshortcuts={shortcut}
              aria-label={`Complete and print, paid by ${label} (${shortcut})`}
              className="relative flex-col gap-1 px-2 lg:h-20"
            >
              <span className="flex items-center gap-2 font-display text-2xl leading-none">
                {busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Icon className="h-6 w-6" aria-hidden />}
                {label}
              </span>
              <Kbd>{shortcut}</Kbd>
            </Button>
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
            <Button
              key={method}
              role="radio"
              aria-checked={on}
              variant={on ? "ink" : "secondary"}
              size="lg"
              disabled={disabled}
              onClick={() => onSelect(method)}
              className="px-2"
            >
              {on ? <Check className="h-5 w-5" aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
              {methodLabel}
            </Button>
          );
        })}
      </div>
      <Button
        variant="primary"
        size="xl"
        block
        onClick={onComplete}
        disabled={disabled || empty || busy || offline || selected === null}
        className="px-3 font-display"
      >
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        ) : offline ? (
          <WifiOff className="h-6 w-6" aria-hidden />
        ) : (
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        )}
        <span className="truncate tabular-nums">{label}</span>
      </Button>
    </div>
  );
}
