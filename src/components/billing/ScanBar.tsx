"use client";

import { useId, useState, type RefObject } from "react";
import { AlertTriangle, Barcode, Camera, CheckCircle2, Info, Loader2, Lock, X } from "lucide-react";
import { formatINR } from "@/lib/format";
import type { Product } from "@/lib/supabase/mappers";
import { useProductSearch } from "./useProductSearch";

export interface ScanStatus {
  tone: "success" | "error" | "info";
  text: string;
  action?: { label: string; onClick: () => void };
}

interface ScanBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  /** A scanned or typed code (barcode / item code), already trimmed. */
  onScan: (code: string) => void;
  /** A product picked from the name search dropdown. */
  onPickProduct: (product: Product) => void;
  onOpenCamera: () => void;
  /** A lookup is in flight. */
  busy: boolean;
  /** Why scanning is paused right now (submitting, status unknown), or null. */
  lockedReason: string | null;
  status: ScanStatus | null;
  onDismissStatus: () => void;
  /** Changes on every scan result, to replay the flash animation. */
  flash: { tone: "success" | "error"; seq: number } | null;
}

/**
 * Text a person is typing (has a letter or a space) gets a product dropdown. Pure digit strings
 * are codes from a scanner or keypad and go straight to lookup, so scans never wait on a search.
 */
function isSearchText(value: string): boolean {
  return /[\p{L}\s]/u.test(value.trim()) && value.trim().length >= 2;
}

export function ScanBar({
  inputRef,
  onScan,
  onPickProduct,
  onOpenCamera,
  busy,
  lockedReason,
  status,
  onDismissStatus,
  flash,
}: ScanBarProps) {
  const listId = useId();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [dismissedTerm, setDismissedTerm] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<{ term: string; index: number }>({ term: "", index: 0 });

  const term = value.trim();
  const search = useProductSearch(value, { enabled: isSearchText(value) && !lockedReason });
  const suggestions = search.products.filter((p) => p.isActive);
  const listOpen = focused && search.active && dismissedTerm !== term;
  const activeIndex = highlight.term === term ? Math.min(highlight.index, Math.max(suggestions.length - 1, 0)) : 0;

  const reset = () => {
    setValue("");
    setDismissedTerm(null);
  };

  const pick = (product: Product) => {
    reset();
    onPickProduct(product);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Ctrl/⌘+Enter is the Check status / retry shortcut, handled by the billing screen.
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (!term) return;
      if (listOpen && suggestions.length > 0) {
        pick(suggestions[activeIndex]);
      } else {
        reset();
        onScan(term);
      }
      return;
    }
    if (!listOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const index = (activeIndex + delta + suggestions.length) % suggestions.length;
      setHighlight({ term, index });
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissedTerm(term);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          {flash && (
            // Re-mounted per scan (key) so the fade-out replays; the input itself is never re-mounted.
            <span
              key={flash.seq}
              aria-hidden
              className={`pointer-events-none absolute inset-0 z-10 rounded-xl ring-4 animate-scan-flash ${
                flash.tone === "success" ? "ring-emerald-500" : "ring-red-600"
              }`}
            />
          )}
          {lockedReason ? (
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-amber-600" aria-hidden />
          ) : (
            <Barcode className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-zinc-500" aria-hidden />
          )}
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            role="combobox"
            aria-label="Scan barcode or search products"
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-activedescendant={listOpen && suggestions.length > 0 ? `${listId}-${activeIndex}` : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={lockedReason ?? "Scan barcode, or type item code / name"}
            className={`h-14 w-full rounded-xl border-2 bg-white pl-13 pr-12 font-mono text-lg text-zinc-950 placeholder:font-sans placeholder:text-base placeholder:text-zinc-500 focus:outline-none dark:bg-zinc-900 dark:text-zinc-50 ${
              lockedReason
                ? "border-amber-500 placeholder:text-amber-700 dark:placeholder:text-amber-400"
                : "border-zinc-400 focus:border-emerald-600 dark:border-zinc-600"
            }`}
          />
          {busy && (
            <Loader2
              className="absolute right-4 top-1/2 h-6 w-6 -translate-y-1/2 animate-spin text-emerald-700"
              aria-label="Looking up"
            />
          )}

          {listOpen && (
            <ul
              id={listId}
              role="listbox"
              className="absolute inset-x-0 top-full z-30 mt-1 max-h-[min(60dvh,24rem)] overflow-y-auto rounded-xl border-2 border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            >
              {search.loading && suggestions.length === 0 && (
                <li className="flex items-center gap-2 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </li>
              )}
              {!search.loading && suggestions.length === 0 && (
                <li className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                  {search.error ?? `No active product matches “${term}”.`}
                </li>
              )}
              {suggestions.map((p, i) => (
                <li
                  key={p.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                  onMouseEnter={() => setHighlight({ term, index: i })}
                  className={`flex min-h-14 cursor-pointer items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2 last:border-b-0 dark:border-zinc-800 ${
                    i === activeIndex ? "bg-emerald-50 dark:bg-emerald-950/50" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-950 dark:text-zinc-50">{p.name}</p>
                    <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {p.itemCode}
                      {p.hsnCode ? ` · HSN ${p.hsnCode}` : ""} · GST {p.gstRate}%
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">{formatINR(p.sellingPrice)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenCamera}
          disabled={!!lockedReason}
          aria-label="Scan with camera"
          // Phones: the camera is the main way to scan, so it comes first and stands out.
          // Desktop: keyboard-wedge scanners type into the box; the camera is a fallback.
          className="order-first flex h-14 min-w-14 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-lg font-bold text-white active:bg-emerald-900 disabled:opacity-40 lg:order-none lg:bg-zinc-900 lg:px-4 lg:text-base lg:font-semibold lg:hover:bg-zinc-800 dark:lg:bg-zinc-700 dark:lg:hover:bg-zinc-600"
        >
          <Camera className="h-6 w-6" aria-hidden />
          <span className="lg:hidden xl:inline">
            <span className="lg:hidden">Scan</span>
            <span className="hidden xl:inline">Camera</span>
          </span>
        </button>
      </div>

      <div aria-live="polite" className="min-h-11">
        {status && (
          <div
            className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium ${
              status.tone === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                : status.tone === "error"
                  ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
                  : "border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            }`}
          >
            {status.tone === "success" ? (
              <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            ) : status.tone === "error" ? (
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
            ) : (
              <Info className="h-5 w-5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">{status.text}</span>
            {status.action && (
              <button
                type="button"
                onClick={status.action.onClick}
                className="h-9 shrink-0 rounded-lg bg-zinc-900 px-3 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {status.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={onDismissStatus}
              aria-label="Dismiss message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
