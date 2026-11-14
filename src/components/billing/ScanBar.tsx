"use client";

import { useId, useState, type RefObject } from "react";
import { AlertTriangle, Barcode, Camera, CheckCircle2, Info, Loader2, Lock, X } from "lucide-react";
import { formatINR } from "@/lib/format";
import type { Product } from "@/lib/supabase/mappers";
import { ALERT_TONES } from "@/components/ui/Alert";
import { PlainNumbers } from "@/components/ui/PlainNumbers";
import { cx } from "@/components/ui/cx";
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
              className={cx(
                "pointer-events-none absolute inset-0 z-10 animate-scan-flash rounded-control ring-4",
                flash.tone === "success" ? "ring-success" : "ring-danger"
              )}
            />
          )}
          {lockedReason ? (
            <Lock className="pointer-events-none absolute top-1/2 left-4 h-6 w-6 -translate-y-1/2 text-ink" aria-hidden />
          ) : (
            <Barcode className="pointer-events-none absolute top-1/2 left-4 h-6 w-6 -translate-y-1/2 text-ink-muted" aria-hidden />
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
            className={cx(
              "h-14 w-full rounded-control border border-ink pr-12 pl-13 font-mono text-lg text-ink shadow-hard-sm",
              "placeholder:font-sans placeholder:text-base focus:border-brand focus:ring-2 focus:ring-brand focus:outline-none",
              lockedReason ? "bg-warning-soft placeholder:font-semibold placeholder:text-ink" : "bg-surface placeholder:text-ink-muted"
            )}
          />
          {busy && (
            <Loader2
              className="absolute top-1/2 right-4 h-6 w-6 -translate-y-1/2 animate-spin text-brand"
              aria-label="Looking up"
            />
          )}

          {listOpen && (
            <ul
              id={listId}
              role="listbox"
              className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-[min(60dvh,24rem)] overflow-y-auto rounded-card border border-ink bg-surface shadow-hard"
            >
              {search.loading && suggestions.length === 0 && (
                <li className="flex items-center gap-2 px-4 py-3 text-sm text-ink-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </li>
              )}
              {!search.loading && suggestions.length === 0 && (
                <li className="px-4 py-3 text-sm text-ink-muted">
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
                  className={cx(
                    "flex min-h-14 cursor-pointer items-center justify-between gap-3 border-b-hairline border-ink/15 px-4 py-2 last:border-b-0",
                    i === activeIndex && "bg-brand-soft"
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-ink">{p.name}</p>
                    <p className="text-sm text-ink-muted">
                      <span className="font-mono">{p.itemCode}</span>
                      {p.hsnCode && (
                        <>
                          {" · HSN "}
                          <span className="font-mono">{p.hsnCode}</span>
                        </>
                      )}
                      {" · GST "}
                      <span className="num">{p.gstRate}%</span>
                    </p>
                  </div>
                  <span className="num shrink-0 font-bold">{formatINR(p.sellingPrice)}</span>
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
          className={cx(
            "order-first flex h-14 min-w-14 shrink-0 items-center justify-center gap-2 rounded-control px-5 text-lg font-bold disabled:cursor-not-allowed disabled:opacity-50",
            // Phones: brand button. Desktop: white secondary button.
            "border-strong border-ink bg-brand text-paper shadow-hard enabled:active:translate-x-[3px] enabled:active:translate-y-[3px] enabled:active:shadow-none",
            "lg:order-none lg:border lg:bg-surface lg:px-4 lg:text-base lg:text-ink lg:shadow-hard-sm lg:enabled:hover:bg-paper-2"
          )}
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
            className={cx(
              "flex min-h-11 items-center gap-2 rounded-control border border-ink px-3 text-sm font-semibold text-ink",
              ALERT_TONES[status.tone === "error" ? "danger" : status.tone].box
            )}
          >
            {status.tone === "success" ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
            ) : status.tone === "error" ? (
              <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden />
            ) : (
              <Info className="h-5 w-5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">
              <PlainNumbers text={status.text} />
            </span>
            {status.action && (
              <button
                type="button"
                onClick={status.action.onClick}
                className="h-9 shrink-0 rounded-control border border-ink bg-ink px-3 text-sm font-bold text-paper hover:bg-brand"
              >
                {status.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={onDismissStatus}
              aria-label="Dismiss message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control hover:bg-ink/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
