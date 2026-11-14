"use client";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, History, Loader2, Trash2 } from "lucide-react";
import { lookupProduct } from "@/lib/actions";
import { completeSale, getInvoiceForReprint, type CompleteSaleResult } from "@/lib/invoice-actions";
import { addBlockedReason, cartReducer, newIdempotencyKey, saveCart, toSaleItems, type CartProduct } from "@/lib/cart";
import { computeInvoiceTotals } from "@/lib/gst";
import { formatINR } from "@/lib/format";
import { playScanErrorTone, playScanSuccessBeep } from "@/lib/audio";
import { printInvoice } from "@/components/print/print";
import { resolvePrintWidth, type PrintWidth } from "@/lib/print-settings";
import type { Invoice } from "@/lib/invoice";
import type { PaymentMethod } from "@/lib/constants";
import type { Product } from "@/lib/supabase/mappers";
import CameraScanner from "@/components/CameraScanner";
import AddProductModal from "@/components/AddProductModal";
import { useCart } from "./useCart";
import { ScanBar, type ScanStatus } from "./ScanBar";
import { CartTable } from "./CartTable";
import { CheckoutPanel } from "./CheckoutPanel";
import { PaymentButtons, PAYMENT_OPTIONS } from "./PaymentButtons";
import { SaleStatusPanel, type SaleStatus } from "./SaleStatusPanel";
import { UnknownCodeDialog } from "./UnknownCodeDialog";
import { ConfirmDialog } from "./Modal";
import { PreviousInvoiceDialog } from "./PreviousInvoiceDialog";
import { MobileActionsMenu } from "./MobileActionsMenu";

interface BillingScreenProps {
  /** Auth user id: the saved cart is per login on this device. */
  userId: string;
  /** Admins may link an unknown code to a product or create one; cashiers just see "Not found". */
  isAdmin: boolean;
  /** null: this login has no counter and cannot complete sales. */
  counterCode: string | null;
  /** counters.print_width_mm; this device may override it (Printer settings). */
  printWidthMm: PrintWidth | null;
}

/** Longer than completeSale's own 20 s database timeout, so the server normally answers first. */
const CLIENT_TIMEOUT_MS = 35_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for the server")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function toCartProduct(p: Product): CartProduct {
  return {
    productId: p.id,
    itemCode: p.itemCode,
    name: p.name,
    unitPrice: p.sellingPrice,
    gstRate: p.gstRate,
    mrp: p.mrp,
    hsnCode: p.hsnCode,
  };
}

/** Codes an admin may link as a barcode alias: product_barcodes format, and looks like a barcode. */
function isLinkableCode(code: string): boolean {
  return /^[!-~]{4,64}$/.test(code) && /\d/.test(code);
}

/** Phones/tablets: focusing the scan box would pop up the on-screen keyboard after every tap. */
function isTouchOnly(): boolean {
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

const PRINT_FAILED_HINT = "The sale is saved — use Reprint to try again.";

export default function BillingScreen({ userId, isAdmin, counterCode, printWidthMm }: BillingScreenProps) {
  const canBill = counterCode !== null;
  const { cart, dispatch, cartRef, hydrated } = useCart(userId);
  const totals = useMemo(() => computeInvoiceTotals(cart.items).totals, [cart.items]);

  // Checkout
  const [submitting, setSubmitting] = useState<{ paymentMethod: PaymentMethod; recheck: boolean } | null>(null);
  const submittingRef = useRef(false); // synchronous guard: no double submit, no scans mid-sale
  const [saleError, setSaleError] = useState<string | null>(null);
  const [unknownDetail, setUnknownDetail] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Invoice | null>(null);
  const [reprint, setReprint] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  // Scanning
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "error"; seq: number } | null>(null);
  const [highlight, setHighlight] = useState<{ productId: string; seq: number } | null>(null);
  const [lookups, setLookups] = useState(0);
  const seqRef = useRef(0);
  const scanQueue = useRef<Promise<void>>(Promise.resolve());

  // Overlays
  const [cameraOpen, setCameraOpen] = useState(false);
  const [continuousScan, setContinuousScan] = useState(true);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [newProductCode, setNewProductCode] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"clear" | "discard" | null>(null);
  const [previousOpen, setPreviousOpen] = useState(false);

  const overlayOpen = cameraOpen || linkCode !== null || newProductCode !== null || confirm !== null || previousOpen;
  const overlayOpenRef = useRef(overlayOpen);
  useLayoutEffect(() => {
    overlayOpenRef.current = overlayOpen;
  }, [overlayOpen]);

  /* ---------------------------------------------------------------------------------------- */
  /* Focus: the scan box gets focus back after every action (keyboard-wedge scanners type     */
  /* into whatever is focused).                                                               */
  /* ---------------------------------------------------------------------------------------- */

  const scanInputRef = useRef<HTMLInputElement>(null);
  const focusScan = useCallback(() => {
    requestAnimationFrame(() => {
      if (overlayOpenRef.current || isTouchOnly()) return;
      const active = document.activeElement;
      // Never pull focus out of a quantity box or other field the cashier is typing in.
      if (active instanceof HTMLInputElement && active !== scanInputRef.current) return;
      scanInputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (hydrated && !overlayOpen) focusScan();
  }, [hydrated, overlayOpen, focusScan]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest("input, textarea, select, dialog, [role=listbox]")) return;
      if (window.getSelection()?.toString()) return;
      focusScan();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [focusScan]);

  /* ---------------------------------------------------------------------------------------- */
  /* Scanning                                                                                 */
  /* ---------------------------------------------------------------------------------------- */

  const feedback = (tone: "success" | "error") => {
    if (tone === "success") playScanSuccessBeep();
    else playScanErrorTone();
    seqRef.current += 1;
    setFlash({ tone, seq: seqRef.current });
  };

  const rejectScan = (text: string) => {
    feedback("error");
    setScanStatus({ tone: "error", text });
  };

  const addToCart = (product: Product, verb: string) => {
    if (!product.isActive) {
      rejectScan(`${product.itemCode} · ${product.name} is inactive and cannot be billed.`);
      return;
    }
    const item = toCartProduct(product);
    const blocked = submittingRef.current
      ? "Saving the sale — scan this item again after it finishes."
      : addBlockedReason(cartRef.current, item.productId);
    if (blocked) {
      rejectScan(blocked);
      return;
    }
    dispatch({ type: "add", product: item });
    feedback("success");
    setHighlight({ productId: item.productId, seq: seqRef.current });
    // The Completed panel stays until the next item is scanned.
    setCompleted(null);
    setScanStatus({ tone: "success", text: `${verb}: ${product.name} · ${formatINR(product.sellingPrice)}` });
  };

  const notFound = (code: string) => {
    feedback("error");
    setScanStatus(
      isAdmin && isLinkableCode(code)
        ? { tone: "error", text: `Not found: ${code}`, action: { label: "Link or add…", onClick: () => setLinkCode(code) } }
        : { tone: "error", text: `Not found: ${code}` }
    );
  };

  const processScan = async (code: string) => {
    if (submittingRef.current) return rejectScan("Saving the sale — scan this item again after it finishes.");
    if (cartRef.current.pendingSale) return rejectScan("Cart is locked until the sale status is known. Use Check status.");

    setLookups((n) => n + 1);
    let res: Awaited<ReturnType<typeof lookupProduct>> | null = null;
    try {
      res = await lookupProduct(code);
    } catch {
      res = null;
    } finally {
      setLookups((n) => n - 1);
    }

    if (!res?.success) return rejectScan(res?.error ?? "Lookup failed — check the connection and scan again.");
    if (!res.data) return notFound(code);
    addToCart(res.data, "Added");
  };

  /** Scans are processed strictly in order, even when the scanner is faster than lookups. */
  const enqueueScan = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    scanQueue.current = scanQueue.current.then(() => processScan(trimmed));
  };

  /* ---------------------------------------------------------------------------------------- */
  /* Completing the sale (REQUIREMENTS.md section 6)                                          */
  /* ---------------------------------------------------------------------------------------- */

  const submitSale = async (requested: PaymentMethod) => {
    if (submittingRef.current || !hydrated || !canBill) return;
    const current = cartRef.current;
    if (current.items.length === 0) return;

    // Re-sending the key of a sale whose outcome is unknown ("Check status"): same key, same
    // items, same payment method. Never a new key, never automatically.
    const recheck = current.pendingSale;
    const paymentMethod = recheck ? (current.paymentMethod ?? requested) : requested;
    const sent = cartReducer(current, { type: "saleSent", paymentMethod });

    // Persist the lock before the request leaves: a reload mid-request restores "status unknown".
    saveCart(userId, sent);
    dispatch({ type: "saleSent", paymentMethod });
    submittingRef.current = true;
    setSubmitting({ paymentMethod, recheck });
    setSaleError(null);
    setCompleted(null);
    setScanStatus(null);

    let result: CompleteSaleResult | null;
    try {
      result = await withTimeout(
        completeSale({ idempotencyKey: sent.idempotencyKey, items: toSaleItems(sent), paymentMethod }),
        CLIENT_TIMEOUT_MS
      );
    } catch {
      result = null; // network error / timeout: we cannot know whether it was saved
    }
    submittingRef.current = false;
    setSubmitting(null);

    if (result?.success && result.data) {
      const invoice = result.data;
      dispatch({ type: "saleCompleted", idempotencyKey: sent.idempotencyKey, nextKey: newIdempotencyKey() });
      setUnknownDetail(null);
      setCompleted(invoice);
      setReprint({ busy: false, error: null });
      playScanSuccessBeep();
      // After the Completed panel paints. Printing never affects the sale: a cancelled or failed
      // print leaves the invoice as it is, and Reprint prints it again.
      void printInvoice(invoice, { widthMm: resolvePrintWidth(printWidthMm) }).then((printed) => {
        if (!printed.ok) setReprint({ busy: false, error: `${printed.error} ${PRINT_FAILED_HINT}` });
      });
    } else if (!result || result.statusUnknown) {
      setUnknownDetail(result?.error ?? "No answer from the server (connection lost or timed out).");
      playScanErrorTone();
    } else if (recheck) {
      // A failure while re-checking does not prove the first request failed (it may still be
      // running, or the check was refused before reaching the sale), so the cart stays locked.
      setUnknownDetail(`Check failed: ${result.error ?? "unknown error"}. Try Check status again.`);
      playScanErrorTone();
    } else {
      // The server definitely did not save it: unlock, keep items and the same key.
      dispatch({ type: "saleRejected" });
      setSaleError(result.error ?? "The sale was not saved.");
      playScanErrorTone();
    }
    focusScan();
  };

  const reprintCompleted = async () => {
    if (!completed) return;
    setReprint({ busy: true, error: null });
    try {
      const res = await getInvoiceForReprint(completed.id);
      if (res.success && res.data) {
        // Always the copy stored in Supabase, never the one held in memory.
        const printed = await printInvoice(res.data, { widthMm: resolvePrintWidth(printWidthMm), reprint: true });
        setReprint({ busy: false, error: printed.ok ? null : `${printed.error} ${PRINT_FAILED_HINT}` });
      } else {
        setReprint({ busy: false, error: res.error ?? "Could not load the invoice for reprint." });
      }
    } catch {
      setReprint({ busy: false, error: "Could not load the invoice. Check the connection and try again." });
    }
    focusScan();
  };

  /* ---------------------------------------------------------------------------------------- */
  /* Derived state, shortcuts                                                                 */
  /* ---------------------------------------------------------------------------------------- */

  const saleStatus: SaleStatus = submitting
    ? { kind: "submitting", paymentMethod: submitting.paymentMethod, recheck: submitting.recheck }
    : cart.pendingSale
      ? { kind: "unknown", detail: unknownDetail, paymentMethod: cart.paymentMethod }
      : saleError
        ? { kind: "error", message: saleError, paymentMethod: cart.paymentMethod }
        : completed
          ? { kind: "completed", invoice: completed }
          : { kind: "idle" };

  const locked = submitting !== null || cart.pendingSale;
  const payDisabled = !hydrated || !canBill || cart.items.length === 0 || locked;
  const lockedReason = !hydrated
    ? "Loading…"
    : submitting
      ? "Saving sale — scanning paused"
      : cart.pendingSale
        ? "Cart locked — check the sale status first"
        : null;

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (overlayOpenRef.current || e.repeat) return;
    const option = PAYMENT_OPTIONS.find((o) => o.shortcut === e.key);
    if (option && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault(); // F7 would otherwise toggle caret browsing
      if (!payDisabled) void submitSale(option.method);
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (submitting || !cart.paymentMethod) return;
      if (saleStatus.kind === "unknown" || saleStatus.kind === "error") void submitSale(cart.paymentMethod);
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Leaving the page mid-request is what turns a sale into "status unknown"; warn first.
  useEffect(() => {
    if (!submitting) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [submitting]);

  /* ---------------------------------------------------------------------------------------- */

  const clearDisabled = locked || cart.items.length === 0;
  // Not while a sale is being saved or its outcome is unknown: that sale must be settled first.
  const previousDisabled = !hydrated || locked;
  const barButton =
    "flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-zinc-300 bg-white px-4 font-semibold text-zinc-800 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 lg:h-[calc(100dvh-4rem)] lg:flex-none lg:flex-row lg:overflow-hidden dark:bg-zinc-950">
      {/* Left: scan + items */}
      <section aria-label="Items" className="flex flex-1 flex-col lg:min-h-0 lg:min-w-0">
        <div className="sticky top-16 z-20 border-b-2 border-zinc-200 bg-zinc-50 px-3 pt-3 lg:static dark:border-zinc-800 dark:bg-zinc-950">
          <ScanBar
            inputRef={scanInputRef}
            onScan={enqueueScan}
            onPickProduct={(p) => {
              addToCart(p, "Added");
              focusScan();
            }}
            onOpenCamera={() => setCameraOpen(true)}
            busy={lookups > 0}
            lockedReason={lockedReason}
            status={scanStatus}
            onDismissStatus={() => {
              setScanStatus(null);
              focusScan();
            }}
            flash={flash}
          />
        </div>

        <div className="flex flex-1 flex-col bg-white lg:min-h-0 dark:bg-zinc-950">
          {hydrated ? (
            <CartTable items={cart.items} highlight={highlight} locked={locked} dispatch={dispatch} onDone={focusScan} />
          ) : (
            <div className="flex flex-1 items-center justify-center py-16" role="status">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-500" aria-hidden />
              <span className="sr-only">Loading cart…</span>
            </div>
          )}
        </div>

        <div className="hidden items-center gap-3 border-t-2 border-zinc-200 bg-zinc-50 px-3 py-2 lg:flex dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={() => setConfirm("clear")}
            disabled={clearDisabled}
            className={`${barButton} hover:border-red-600 hover:text-red-700`}
          >
            <Trash2 className="h-5 w-5" aria-hidden />
            Clear cart
          </button>
          <button
            type="button"
            onClick={() => setPreviousOpen(true)}
            disabled={previousDisabled}
            className={`${barButton} hover:border-emerald-700 hover:text-emerald-800 dark:hover:text-emerald-300`}
          >
            <History className="h-5 w-5" aria-hidden />
            Print Previous Invoice
          </button>
          <p className="ml-auto text-sm font-medium tabular-nums text-zinc-600 dark:text-zinc-400">
            {totals.itemCount} {totals.itemCount === 1 ? "line" : "lines"} · {totals.totalQty} qty
          </p>
        </div>
      </section>

      {/* Right: totals, sale status, payment */}
      <CheckoutPanel
        totals={totals}
        notice={
          !canBill && (
            <p className="flex items-start gap-2 rounded-xl border-2 border-amber-500 bg-amber-50 p-3 text-sm font-medium text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              This login has no counter, so it can&apos;t complete sales. Scanning still works for price checks.
            </p>
          )
        }
        status={
          <SaleStatusPanel
            status={saleStatus}
            cartTotal={totals.grandTotal}
            onCheckStatus={() => void submitSale(cart.paymentMethod ?? "cash")}
            onRetry={() => cart.paymentMethod && void submitSale(cart.paymentMethod)}
            onDismissError={() => {
              setSaleError(null);
              focusScan();
            }}
            onDiscard={() => setConfirm("discard")}
            onReprint={() => void reprintCompleted()}
            reprint={reprint}
            onNewBill={() => {
              setCompleted(null);
              setScanStatus(null);
              focusScan();
            }}
          />
        }
        payment={
          <PaymentButtons
            disabled={payDisabled}
            busyMethod={submitting && !submitting.recheck ? submitting.paymentMethod : null}
            onPay={(method) => void submitSale(method)}
          />
        }
        mobileActions={
          <MobileActionsMenu
            actions={[
              {
                label: "Print Previous Invoice",
                icon: <History className="h-5 w-5" aria-hidden />,
                onSelect: () => setPreviousOpen(true),
                disabled: previousDisabled,
              },
              {
                label: "Clear cart",
                icon: <Trash2 className="h-5 w-5" aria-hidden />,
                onSelect: () => setConfirm("clear"),
                disabled: clearDisabled,
                destructive: true,
              },
            ]}
          />
        }
      />

      {previousOpen && (
        <PreviousInvoiceDialog
          onClose={() => setPreviousOpen(false)}
          isAdmin={isAdmin}
          counterCode={counterCode}
          printWidthMm={printWidthMm}
        />
      )}

      {cameraOpen && (
        <CameraScanner
          isOpen
          onClose={() => setCameraOpen(false)}
          onScan={enqueueScan}
          continuous={continuousScan}
          onToggleContinuous={setContinuousScan}
        />
      )}

      <UnknownCodeDialog
        code={linkCode}
        onClose={() => setLinkCode(null)}
        onLinked={(product) => {
          setLinkCode(null);
          addToCart(product, "Linked and added");
        }}
        onCreateNew={(code) => {
          setLinkCode(null);
          setNewProductCode(code);
        }}
      />

      {newProductCode !== null && (
        <AddProductModal
          key={newProductCode}
          isOpen
          initialBarcode={newProductCode}
          onClose={() => setNewProductCode(null)}
          onProductCreated={(product) => addToCart(product, "Created and added")}
        />
      )}

      <ConfirmDialog
        open={confirm === "clear"}
        title="Clear this cart?"
        confirmLabel="Clear cart"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          dispatch({ type: "clear", nextKey: newIdempotencyKey() });
          setSaleError(null);
          setScanStatus({ tone: "info", text: "Cart cleared." });
        }}
      >
        All {totals.itemCount} {totals.itemCount === 1 ? "line" : "lines"} ({formatINR(totals.grandTotal)}) will be removed.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "discard"}
        title="Discard this sale?"
        confirmLabel="Discard and start over"
        cancelLabel="Keep checking"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          dispatch({ type: "discard", nextKey: newIdempotencyKey() });
          setUnknownDetail(null);
          setScanStatus({
            tone: "info",
            text: "Cart discarded. If that sale was saved, it is in the invoice history — don't bill it twice.",
          });
        }}
      >
        <p>
          <strong>The sale may already be saved</strong> as an invoice, even though no answer came back. If you discard
          it and bill the items again, the customer could be billed twice.
        </p>
        <p className="mt-2">Use <strong>Check status</strong> first if the connection is back.</p>
      </ConfirmDialog>
    </div>
  );
}
