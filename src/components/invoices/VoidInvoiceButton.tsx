"use client";

import { useState } from "react";
import { Ban } from "lucide-react";
import { voidInvoice } from "@/lib/invoice-void-actions";
import { Button } from "@/components/ui/Button";

export function VoidInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button variant="danger" onClick={() => setOpen(true)}><Ban className="h-4 w-4" aria-hidden />Void invoice</Button>;
  return (
    <form className="w-full max-w-sm space-y-2" onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await voidInvoice({ invoiceId, reason });
        if (!result.success) setError(result.error ?? "Could not void invoice.");
      } catch {
        setError("Connection failed. Check the invoice status and try again.");
      } finally {
        setBusy(false);
      }
    }}>
      <p className="text-sm">Voiding is permanent. This invoice will be excluded from day totals and CSV exports.</p>
      <label className="block text-sm font-bold" htmlFor="void-reason">Reason for voiding</label>
      <textarea id="void-reason" required maxLength={500} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} className="w-full rounded-control border border-ink bg-surface p-2" />
      <div className="flex gap-2">
        <Button variant="danger" type="submit" disabled={busy || !reason.trim()}><Ban className="h-4 w-4" aria-hidden />{busy ? "Voiding…" : "Confirm void"}</Button>
        <Button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  );
}
