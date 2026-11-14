"use client";

import { useRef, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { getInvoiceForReprint } from "@/lib/invoice-actions";
import { resolvePrintWidth, type PrintWidth } from "@/lib/print-settings";
import { printInvoice } from "@/components/print/print";

/**
 * Reprint from history: re-fetches the invoice from Supabase and prints the normal receipt
 * marked REPRINT (same path as Print Previous Invoice). Never creates an invoice.
 */
export function ReprintButton({ invoiceId, printWidthMm }: { invoiceId: string; printWidthMm: PrintWidth | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const reprint = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await getInvoiceForReprint(invoiceId);
      if (res.success && res.data) {
        const printed = await printInvoice(res.data, { widthMm: resolvePrintWidth(printWidthMm), reprint: true });
        if (!printed.ok) setError(printed.error);
      } else {
        setError(res.error ?? "Could not load the invoice for reprint.");
      }
    } catch {
      setError("Could not load the invoice. Check the connection and try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        onClick={() => void reprint()}
        disabled={busy}
        className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-base font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Printer className="h-5 w-5" aria-hidden />}
        Reprint
      </button>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
