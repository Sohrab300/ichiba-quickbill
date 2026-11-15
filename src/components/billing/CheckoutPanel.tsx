"use client";

import { useState, type ReactNode } from "react";
import { ChevronUp } from "lucide-react";
import { formatINR } from "@/lib/format";
import { formatLinesAndPieces } from "@/lib/qty";
import type { GstTotals } from "@/lib/gst";
import { Badge } from "@/components/ui/Badge";
import { cardClasses } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";

/** "+₹0.40" / "−₹0.49" / "₹0.00" */
function formatSigned(paise: number): string {
  if (paise === 0) return formatINR(0);
  return `${paise > 0 ? "+" : "−"}${formatINR(Math.abs(paise))}`;
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 py-0.5", strong && "font-bold")}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function BillSummary({ totals }: { totals: GstTotals }) {
  return (
    <section aria-label="Bill summary (preview)" className={cardClasses({ raised: false, className: "p-3 text-sm" })}>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-xs font-bold tracking-wide text-ink-muted uppercase">Bill summary</h2>
        <Badge title="Calculated on this device from the prices at scan time. The printed invoice uses the amounts saved on the server.">
          Preview
        </Badge>
      </div>
      <dl>
        {/* Weighed lines count as lines; their kg are not added to pieces. */}
        <Row label="Items" value={formatLinesAndPieces(totals.itemCount, totals.totalQty)} />
        <Row label="Sub total" value={formatINR(totals.subtotal)} strong />
        <Row label="Taxable value" value={formatINR(totals.taxableTotal)} />
        <Row label="CGST" value={formatINR(totals.cgstTotal)} />
        <Row label="SGST" value={formatINR(totals.sgstTotal)} />
        <Row label="Round off" value={formatSigned(totals.roundOff)} />
      </dl>
    </section>
  );
}

interface CheckoutPanelProps {
  totals: GstTotals;
  /** Shown above the payment buttons (completed / error / unknown / saving). */
  status: ReactNode;
  /** Shown when this login cannot bill at all. */
  notice: ReactNode;
  /** Desktop (≥ 1024px): one-press payment buttons. */
  payment: ReactNode;
  /** Phones: payment toggles + Complete button. */
  mobilePayment: ReactNode;
  /** Mobile-only secondary actions (e.g. Clear cart). */
  mobileActions?: ReactNode;
}

/**
 * The right pane on desktop; a sticky bottom sheet on phones (total + payment always visible,
 * breakdown behind a toggle).
 */
export function CheckoutPanel({ totals, status, notice, payment, mobilePayment, mobileActions }: CheckoutPanelProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <aside
      aria-label="Total and payment"
      className="sticky bottom-0 z-20 flex flex-col gap-3 border-t-strong border-ink bg-paper-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:static lg:z-auto lg:min-h-0 lg:w-[35%] lg:max-w-xl lg:min-w-[22rem] lg:border-t-0 lg:border-l-strong lg:p-4"
    >
      {/* Breakdown: always shown on desktop (shrinks and scrolls if space runs out), toggled on phones. */}
      <div
        className={`${showDetails ? "block" : "hidden"} order-1 max-h-[30dvh] overflow-y-auto lg:order-none lg:block lg:max-h-none lg:min-h-0 lg:shrink`}
      >
        <BillSummary totals={totals} />
      </div>

      <div className="hidden shrink-0 lg:block">
        <TotalDisplay totals={totals} />
      </div>

      {/* Sale status sits right above the payment buttons and never scrolls out of view on desktop. */}
      {(notice || status) && (
        <div className="order-2 flex max-h-[45dvh] shrink-0 flex-col gap-3 overflow-y-auto empty:hidden lg:order-none lg:max-h-none lg:overflow-visible">
          {notice}
          {status}
        </div>
      )}

      <div className="hidden lg:block lg:flex-1" aria-hidden />

      {/* Phones: compact total row with the breakdown toggle. */}
      <div className="order-3 flex items-center justify-between gap-3 lg:hidden">
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className="flex h-11 items-center gap-1 rounded-control px-1 text-left"
        >
          <span>
            <span className="block text-xs font-bold tracking-wide text-ink-muted uppercase">
              Total · <span className="num">{formatLinesAndPieces(totals.itemCount, totals.totalQty)}</span>
            </span>
            <span className="text-sm font-semibold text-ink underline decoration-ink/40 underline-offset-2">
              {showDetails ? "Hide" : "Show"} GST preview
            </span>
          </span>
          <ChevronUp className={`h-5 w-5 text-ink transition-transform ${showDetails ? "" : "rotate-180"}`} aria-hidden />
        </button>
        <div className="flex items-center gap-2">
          {mobileActions}
          <span className="font-display text-3xl leading-none font-extrabold text-ink tabular-nums">
            {formatINR(totals.grandTotal)}
          </span>
        </div>
      </div>

      <div className="order-4 shrink-0 lg:hidden">{mobilePayment}</div>
      <div className="hidden shrink-0 lg:block">{payment}</div>
    </aside>
  );
}

function TotalDisplay({ totals }: { totals: GstTotals }) {
  return (
    <div className="rounded-card border-strong border-ink bg-ink px-4 pt-2.5 pb-2 text-paper shadow-hard-brand">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-lg font-bold tracking-wide uppercase">Total</span>
        <span className="text-xs text-paper/85">preview · invoice uses server amounts</span>
      </div>
      <p className="text-right font-display text-6xl leading-none font-extrabold tabular-nums">{formatINR(totals.grandTotal)}</p>
    </div>
  );
}
