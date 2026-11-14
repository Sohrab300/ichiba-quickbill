"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Printer, Search } from "lucide-react";
import { getInvoiceForReprint, getRecentInvoices, type RecentInvoice } from "@/lib/invoice-actions";
import { resolvePrintWidth, type PrintWidth } from "@/lib/print-settings";
import { formatINR } from "@/lib/format";
import { printInvoice } from "@/components/print/print";
import { Modal } from "./Modal";
import { paymentLabel } from "./PaymentButtons";

interface PreviousInvoiceDialogProps {
  onClose: () => void;
  isAdmin: boolean;
  /** This login's counter; null for an admin without one. */
  counterCode: string | null;
  printWidthMm: PrintWidth | null;
}

interface Results {
  /** The search text these results are for ("" = today's invoices on this counter). */
  term: string;
  invoices: RecentInvoice[];
  error: string | null;
}

const SEARCH_DELAY_MS = 250;

const istDate = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" });
const istShortDate = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
const istTime = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

/**
 * Print Previous Invoice (REQUIREMENTS.md section 12). Mount it only while open: every opening
 * starts fresh with today's invoices on this counter, the latest one selected.
 *
 * Read-only: Reprint loads the invoice with getInvoiceForReprint() and prints it with the normal
 * receipt (marked REPRINT). Nothing here can create an invoice.
 */
export function PreviousInvoiceDialog({ onClose, isAdmin, counterCode, printWidthMm }: PreviousInvoiceDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reprint, setReprint] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const busyRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [today] = useState(() => istDate.format(new Date()));

  const term = query.trim();

  useEffect(() => {
    // After Modal's showModal() (child effects run first), which focuses the Close button.
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        getRecentInvoices(term ? { search: term } : {})
          .then((res) => {
            if (cancelled) return;
            setResults(
              res.success && res.data
                ? { term, invoices: res.data, error: null }
                : { term, invoices: [], error: res.error ?? "Could not load invoices." }
            );
          })
          .catch(() => {
            if (!cancelled) setResults({ term, invoices: [], error: "Could not load invoices. Check the connection." });
          });
      },
      term ? SEARCH_DELAY_MS : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  // Only results for exactly the current text count: a stale list must never be reprinted.
  const current = results?.term === term ? results : null;
  const invoices = current?.invoices ?? [];
  const selected = invoices.find((i) => i.id === selectedId) ?? invoices[0] ?? null;

  const doReprint = async (invoice: RecentInvoice) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setReprint({ busy: true, error: null });
    let error: string | null = null;
    try {
      const res = await getInvoiceForReprint(invoice.id);
      if (res.success && res.data) {
        const printed = await printInvoice(res.data, { widthMm: resolvePrintWidth(printWidthMm), reprint: true });
        if (!printed.ok) error = printed.error;
      } else {
        error = res.error ?? "Could not load the invoice for reprint.";
      }
    } catch {
      error = "Could not load the invoice. Check the connection and try again.";
    }
    busyRef.current = false;
    if (error) {
      setReprint({ busy: false, error });
      return;
    }
    onClose();
  };

  const moveSelection = (delta: number) => {
    if (invoices.length === 0) return;
    const index = selected ? invoices.indexOf(selected) : -1;
    const next = invoices[Math.min(invoices.length - 1, Math.max(0, index + delta))];
    setSelectedId(next.id);
    listRef.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    // Buttons (Close, Reprint) handle their own Enter.
    if (e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    // While results for the typed text are loading, Enter does nothing (e.g. a barcode scanned
    // into the search box must not reprint the previously selected invoice).
    if (selected && !reprint.busy) void doReprint(selected);
  };

  const scopeHint = isAdmin
    ? "Admin: searches every counter and date."
    : `Counter ${counterCode ?? "—"}, today only.`;

  return (
    <Modal open title="Print previous invoice" onClose={onClose} size="max-w-lg">
      <div className="space-y-4" onKeyDown={onKeyDown}>
        {/* Selected invoice + Reprint */}
        <div className="rounded-xl border-2 border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-950">
          {selected ? (
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="break-all font-mono text-lg font-bold">{selected.invoiceNo}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {when(selected.createdAt, today)} · {paymentLabel(selected.paymentMethod)}
                  {selected.counterCode !== counterCode && ` · Counter ${selected.counterCode}`}
                </p>
              </div>
              <p className="shrink-0 text-xl font-bold tabular-nums">{formatINR(selected.grandTotal)}</p>
            </div>
          ) : (
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{current ? "Nothing selected." : "Loading…"}</p>
          )}
          <button
            type="button"
            onClick={() => selected && void doReprint(selected)}
            disabled={!selected || reprint.busy}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 text-lg font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {reprint.busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Printer className="h-5 w-5" aria-hidden />}
            Reprint
            <kbd className="hidden rounded bg-black/20 px-1.5 font-mono text-[11px] lg:inline">Enter</kbd>
          </button>
          {reprint.error && (
            <p role="alert" className="mt-2 text-sm font-medium text-red-800 dark:text-red-300">
              {reprint.error}
            </p>
          )}
        </div>

        {/* Search */}
        <div>
          <label htmlFor="previous-invoice-search" className="sr-only">
            Search by invoice number
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-zinc-500" aria-hidden />
            <input
              ref={searchRef}
              id="previous-invoice-search"
              // Not type="search": there Esc clears the text instead of closing the dialog.
              type="text"
              enterKeyHint="go"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedId(null);
                setReprint((r) => ({ ...r, error: null }));
              }}
              placeholder="Invoice number, e.g. 000123"
              aria-controls="previous-invoice-list"
              className="h-12 w-full rounded-xl border-2 border-zinc-300 bg-white pr-3 pl-10 text-base font-medium focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{scopeHint} ↑ ↓ to choose.</p>
        </div>

        {/* List */}
        <div className="min-h-24">
          {!current ? (
            <div className="flex items-center justify-center py-6 text-zinc-500" role="status">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
              <span className="sr-only">Loading invoices…</span>
            </div>
          ) : current.error ? (
            <p role="alert" className="py-4 text-sm font-medium text-red-800 dark:text-red-300">
              {current.error}
            </p>
          ) : invoices.length === 0 ? (
            <p className="py-6 text-center text-base text-zinc-600 dark:text-zinc-400">
              {term
                ? `No invoice number contains “${term}”${isAdmin ? "" : " today on this counter"}.`
                : counterCode
                  ? "No invoices yet today on this counter."
                  : "This login has no counter. Search by invoice number."}
            </p>
          ) : (
            <ul
              ref={listRef}
              id="previous-invoice-list"
              role="listbox"
              aria-label={term ? "Matching invoices" : "Today's invoices"}
              className="max-h-[min(18rem,40dvh)] divide-y divide-zinc-200 overflow-y-auto rounded-xl border-2 border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800"
            >
              {invoices.map((inv) => {
                const isSelected = inv.id === selected?.id;
                return (
                  <li
                    key={inv.id}
                    data-id={inv.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setSelectedId(inv.id);
                      searchRef.current?.focus();
                    }}
                    onDoubleClick={() => void doReprint(inv)}
                    className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 px-3 py-2 ${
                      isSelected
                        ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-50"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="break-all font-mono text-sm font-bold">{inv.invoiceNo}</p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        {when(inv.createdAt, today)} · {paymentLabel(inv.paymentMethod)}
                        {inv.counterCode !== counterCode && ` · ${inv.counterCode}`}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">{formatINR(inv.grandTotal)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** "06:32 pm" today, "13 Nov, 06:32 pm" on other days (IST). */
function when(iso: string, today: string): string {
  const d = new Date(iso);
  const time = istTime.format(d);
  return istDate.format(d) === today ? time : `${istShortDate.format(d)}, ${time}`;
}
