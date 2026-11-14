"use client";

import { useState, type ReactNode } from "react";
import { ChevronUp } from "lucide-react";
import { formatINR } from "@/lib/format";
import type { GstTotals } from "@/lib/gst";

/** "+₹0.40" / "−₹0.49" / "₹0.00" */
function formatSigned(paise: number): string {
  if (paise === 0) return formatINR(0);
  return `${paise > 0 ? "+" : "−"}${formatINR(Math.abs(paise))}`;
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-0.5 ${strong ? "font-semibold text-zinc-950 dark:text-zinc-50" : ""}`}>
      <dt className="text-zinc-700 dark:text-zinc-300">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function BillSummary({ totals }: { totals: GstTotals }) {
  return (
    <section aria-label="Bill summary (preview)" className="rounded-xl border-2 border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Bill summary</h2>
        <span
          className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          title="Calculated on this device from the prices at scan time. The printed invoice uses the amounts saved on the server."
        >
          Preview
        </span>
      </div>
      <dl>
        <Row label="Items" value={`${totals.itemCount} lines · ${totals.totalQty} qty`} />
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
  payment: ReactNode;
  /** Mobile-only secondary actions (e.g. Clear cart). */
  mobileActions?: ReactNode;
}

/**
 * The right pane on desktop; a sticky bottom sheet on phones (total + payment always visible,
 * breakdown behind a toggle).
 */
export function CheckoutPanel({ totals, status, notice, payment, mobileActions }: CheckoutPanelProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <aside
      aria-label="Total and payment"
      className="sticky bottom-0 z-20 flex flex-col gap-3 lg:min-h-0 border-t-2 border-zinc-300 bg-zinc-100 p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] lg:static lg:z-auto lg:w-[35%] lg:max-w-xl lg:min-w-[22rem] lg:border-t-0 lg:border-l-2 lg:p-4 lg:shadow-none dark:border-zinc-800 dark:bg-zinc-900"
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
          className="flex h-11 items-center gap-1 rounded-lg px-1 text-left"
        >
          <span>
            <span className="block text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              Total · {totals.totalQty} qty
            </span>
            <span className="text-[11px] text-zinc-500">{showDetails ? "Hide" : "Show"} GST preview</span>
          </span>
          <ChevronUp className={`h-5 w-5 text-zinc-600 transition-transform ${showDetails ? "" : "rotate-180"}`} aria-hidden />
        </button>
        <div className="flex items-center gap-2">
          {mobileActions}
          <span className="text-3xl font-black tabular-nums text-zinc-950 dark:text-zinc-50">{formatINR(totals.grandTotal)}</span>
        </div>
      </div>

      <div className="order-4 shrink-0 lg:order-none">{payment}</div>
    </aside>
  );
}

function TotalDisplay({ totals }: { totals: GstTotals }) {
  return (
    <div className="rounded-xl bg-zinc-950 px-4 py-3 text-white dark:bg-black">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-bold uppercase tracking-wide text-zinc-300">Total</span>
        <span className="text-xs text-zinc-400">preview · invoice uses server amounts</span>
      </div>
      <p className="text-right text-5xl font-black leading-tight tabular-nums">{formatINR(totals.grandTotal)}</p>
    </div>
  );
}
