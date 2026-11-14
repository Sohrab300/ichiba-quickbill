"use client";

import { HelpCircle, Loader2, Printer, RotateCcw, Plus, X } from "lucide-react";
import { formatINR } from "@/lib/format";
import type { Invoice } from "@/lib/invoice";
import type { PaymentMethod } from "@/lib/constants";
import { Alert, InlineAlert } from "@/components/ui/Alert";
import { Kbd } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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

export function SaleStatusPanel(props: SaleStatusPanelProps) {
  const { status } = props;

  switch (status.kind) {
    case "idle":
      return null;

    case "submitting":
      if (status.recheck) return <UnknownPanel {...props} detail={null} paymentMethod={status.paymentMethod} checking />;
      return (
        <Alert
          tone="info"
          role="status"
          raised
          icon={<Loader2 className="animate-spin" />}
          title={`Saving sale (${paymentLabel(status.paymentMethod)})…`}
        >
          <p>Scanning is paused. Don&apos;t close this page.</p>
        </Alert>
      );

    case "completed": {
      const { invoice } = status;
      return (
        <Alert
          tone="success"
          role="status"
          raised
          title={<span className="text-sm tracking-wide uppercase">Completed</span>}
          footer={
            <>
              {props.reprint.error && (
                <InlineAlert tone="danger" className="mb-2">
                  {props.reprint.error}
                </InlineAlert>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={props.onReprint} disabled={props.reprint.busy}>
                  {props.reprint.busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Printer className="h-5 w-5" aria-hidden />}
                  {props.printLabel ?? "Reprint"}
                </Button>
                <Button variant="primary" onClick={props.onNewBill}>
                  <Plus className="h-5 w-5" aria-hidden />
                  New bill
                </Button>
              </div>
            </>
          }
        >
          <p className="mt-0.5 font-mono text-xl font-bold break-all tabular-nums lg:text-2xl">{invoice.invoiceNo}</p>
          <p className="text-base">
            <span className="num font-bold">{formatINR(invoice.grandTotal)}</span> · {paymentLabel(invoice.paymentMethod)} ·{" "}
            <span className="num">{invoice.totalQty}</span> {invoice.totalQty === 1 ? "item" : "items"}
          </p>
        </Alert>
      );
    }

    case "error":
      return (
        <Alert
          tone="danger"
          role="alert"
          raised
          title="Sale not saved"
          action={
            <Button variant="ghost" size="sm" square onClick={props.onDismissError} aria-label="Dismiss error" className="-mt-1 -mr-1">
              <X className="h-5 w-5" />
            </Button>
          }
          footer={
            <Button variant="primary" block onClick={props.onRetry}>
              <RotateCcw className="h-5 w-5" aria-hidden />
              Try again ({paymentLabel(status.paymentMethod)})
              <Kbd className="hidden lg:inline">Ctrl+Enter</Kbd>
            </Button>
          }
        >
          <p>{status.message}</p>
        </Alert>
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
    <Alert
      tone="warning"
      role="alert"
      raised
      icon={<HelpCircle />}
      title={<span className="text-lg">Sale status unknown</span>}
      footer={
        <>
          <Button variant="primary" size="lg" block onClick={onCheckStatus} disabled={checking}>
            {checking ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <RotateCcw className="h-5 w-5" aria-hidden />}
            {checking ? "Checking…" : "Check status"}
            {!checking && <Kbd className="hidden lg:inline">Ctrl+Enter</Kbd>}
          </Button>
          <Button
            variant="ghost-danger"
            size="sm"
            block
            onClick={onDiscard}
            disabled={checking}
            className="mt-2 underline-offset-2 enabled:hover:underline"
          >
            Discard and start over…
          </Button>
        </>
      }
    >
      <p>
        This sale (<span className="num">{formatINR(cartTotal)}</span>, {paymentLabel(paymentMethod)}) was sent but
        no answer came back. It may already be saved. The cart is locked — check before doing anything else.
      </p>
      {detail && <p className="mt-1 text-sm text-ink-muted">{detail}</p>}
    </Alert>
  );
}
