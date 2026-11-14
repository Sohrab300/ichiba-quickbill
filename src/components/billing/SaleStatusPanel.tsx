"use client";

import { AlertOctagon, CheckCircle2, HelpCircle, Loader2, Printer, RotateCcw, Plus, X } from "lucide-react";
import { formatINR } from "@/lib/format";
import type { Invoice } from "@/lib/invoice";
import type { PaymentMethod } from "@/lib/constants";
import { paymentLabel } from "./PaymentButtons";

export type SaleStatus =
  | { kind: "idle" }
  /** A request is in flight. `recheck`: re-sending the key of a sale whose outcome was unknown. */
  | { kind: "submitting"; paymentMethod: PaymentMethod | null; recheck: boolean }
  | { kind: "completed"; invoice: Invoice }
  /** The server definitely did not save the sale; the cart is unlocked, same key. */
  | { kind: "error"; message: string; paymentMethod: PaymentMethod | null }
  /** The outcome is unknown; the cart is locked until Check status succeeds or it is discarded. */
  | { kind: "unknown"; detail: string | null; paymentMethod: PaymentMethod | null };

interface SaleStatusPanelProps {
  status: SaleStatus;
  /** Preview total of the cart (for the unknown/error panels). */
  cartTotal: number;
  onCheckStatus: () => void;
  onRetry: () => void;
  onDismissError: () => void;
  onDiscard: () => void;
  onReprint: () => void;
  reprint: { busy: boolean; error: string | null };
  /** Label of the Completed panel's print button ("Reprint" unless the receipt is not printed yet). */
  printLabel?: string;
  onNewBill: () => void;
}

const btn = "flex h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-bold transition-colors";

export function SaleStatusPanel(props: SaleStatusPanelProps) {
  const { status } = props;

  switch (status.kind) {
    case "idle":
      return null;

    case "submitting":
      if (status.recheck) return <UnknownPanel {...props} detail={null} paymentMethod={status.paymentMethod} checking />;
      return (
        <div role="status" className="flex items-center gap-3 rounded-xl border-2 border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <Loader2 className="h-6 w-6 shrink-0 animate-spin text-zinc-700 dark:text-zinc-300" aria-hidden />
          <div>
            <p className="text-base font-bold">Saving sale ({paymentLabel(status.paymentMethod)})…</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Scanning is paused. Don&apos;t close this page.</p>
          </div>
        </div>
      );

    case "completed": {
      const { invoice } = status;
      return (
        <div role="status" className="rounded-xl border-2 border-emerald-600 bg-emerald-50 p-4 dark:bg-emerald-950/40">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
            <p className="text-sm font-bold uppercase tracking-wide">Completed</p>
          </div>
          <p className="mt-1 break-all font-mono text-xl font-bold text-zinc-950 lg:text-2xl dark:text-zinc-50">{invoice.invoiceNo}</p>
          <p className="text-base text-zinc-800 dark:text-zinc-200">
            <span className="font-bold tabular-nums">{formatINR(invoice.grandTotal)}</span> · {paymentLabel(invoice.paymentMethod)} ·{" "}
            {invoice.totalQty} {invoice.totalQty === 1 ? "item" : "items"}
          </p>
          {props.reprint.error && <p className="mt-2 text-sm font-medium text-red-800 dark:text-red-300">{props.reprint.error}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={props.onReprint}
              disabled={props.reprint.busy}
              className={`${btn} border-2 border-emerald-700 bg-white text-emerald-900 hover:bg-emerald-100 disabled:opacity-60 dark:bg-zinc-900 dark:text-emerald-200`}
            >
              {props.reprint.busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Printer className="h-5 w-5" aria-hidden />}
              {props.printLabel ?? "Reprint"}
            </button>
            <button type="button" onClick={props.onNewBill} className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`}>
              <Plus className="h-5 w-5" aria-hidden />
              New bill
            </button>
          </div>
        </div>
      );
    }

    case "error":
      return (
        <div role="alert" className="rounded-xl border-2 border-red-600 bg-red-50 p-4 dark:bg-red-950/40">
          <div className="flex items-start gap-2">
            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-red-900 dark:text-red-200">Sale not saved</p>
              <p className="text-sm text-red-900 dark:text-red-200">{status.message}</p>
            </div>
            <button
              type="button"
              onClick={props.onDismissError}
              aria-label="Dismiss error"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-800 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <button type="button" onClick={props.onRetry} className={`${btn} mt-3 w-full bg-red-700 text-white hover:bg-red-800`}>
            <RotateCcw className="h-5 w-5" aria-hidden />
            Try again ({paymentLabel(status.paymentMethod)})
            <kbd className="hidden rounded bg-black/20 px-1.5 font-mono text-[11px] lg:inline">Ctrl+Enter</kbd>
          </button>
        </div>
      );

    case "unknown":
      return <UnknownPanel {...props} detail={status.detail} paymentMethod={status.paymentMethod} checking={false} />;
  }
}

function UnknownPanel({
  detail,
  paymentMethod,
  checking,
  cartTotal,
  onCheckStatus,
  onDiscard,
}: SaleStatusPanelProps & { detail: string | null; paymentMethod: PaymentMethod | null; checking: boolean }) {
  return (
    <div role="alert" className="rounded-xl border-2 border-amber-500 bg-amber-50 p-4 dark:bg-amber-950/40">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-6 w-6 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-lg font-bold text-amber-950 dark:text-amber-100">Sale status unknown</p>
          <p className="text-sm text-amber-950 dark:text-amber-100">
            This sale ({formatINR(cartTotal)}, {paymentLabel(paymentMethod)}) was sent but no answer came back. It may
            already be saved. The cart is locked — check before doing anything else.
          </p>
          {detail && <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">{detail}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={onCheckStatus}
        disabled={checking}
        className={`${btn} mt-3 h-14 w-full bg-amber-600 text-lg text-white hover:bg-amber-700 disabled:opacity-70`}
      >
        {checking ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <RotateCcw className="h-5 w-5" aria-hidden />}
        {checking ? "Checking…" : "Check status"}
        {!checking && <kbd className="hidden rounded bg-black/20 px-1.5 font-mono text-[11px] lg:inline">Ctrl+Enter</kbd>}
      </button>
      <button
        type="button"
        onClick={onDiscard}
        disabled={checking}
        className="mt-2 h-11 w-full rounded-xl text-sm font-semibold text-red-800 underline-offset-2 hover:bg-red-50 hover:underline disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40"
      >
        Discard and start over…
      </button>
    </div>
  );
}
