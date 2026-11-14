"use client";

import { useState, useReducer, useRef, useEffect, useCallback } from "react";
import {
  Barcode,
  Camera,
  Trash2,
  Plus,
  Minus,
  CheckCircle2,
  ShoppingCart,
  Loader2,
  Sparkles,
} from "lucide-react";
import { lookupProduct } from "@/lib/actions";
import { formatINR } from "@/lib/format";
import { playScanSuccessBeep, playScanErrorTone } from "@/lib/audio";
import type { Product } from "@/lib/supabase/mappers";
import CameraScanner from "@/components/CameraScanner";
import AddProductModal from "@/components/AddProductModal";

export interface BillItem {
  productId: string;
  itemCode: string;
  name: string;
  unitPrice: number; // in paise
  quantity: number;
}

type BillAction =
  | { type: "ADD_PRODUCT"; product: Product }
  | { type: "UPDATE_QTY"; productId: string; quantity: number }
  | { type: "INCREMENT_QTY"; productId: string }
  | { type: "DECREMENT_QTY"; productId: string }
  | { type: "REMOVE_ITEM"; productId: string }
  | { type: "CLEAR_BILL" };

function billReducer(state: BillItem[], action: BillAction): BillItem[] {
  switch (action.type) {
    case "ADD_PRODUCT": {
      const existingIndex = state.findIndex(
        (item) => item.productId === action.product.id
      );
      if (existingIndex > -1) {
        return state.map((item, idx) =>
          idx === existingIndex
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [
        {
          productId: action.product.id,
          itemCode: action.product.itemCode,
          name: action.product.name,
          unitPrice: action.product.sellingPrice,
          quantity: 1,
        },
        ...state,
      ];
    }
    case "UPDATE_QTY": {
      if (action.quantity <= 0) {
        return state.filter((item) => item.productId !== action.productId);
      }
      return state.map((item) =>
        item.productId === action.productId
          ? { ...item, quantity: action.quantity }
          : item
      );
    }
    case "INCREMENT_QTY": {
      return state.map((item) =>
        item.productId === action.productId
          ? { ...item, quantity: item.quantity + 1 }
          : item
      );
    }
    case "DECREMENT_QTY": {
      return state
        .map((item) => {
          if (item.productId === action.productId) {
            return { ...item, quantity: item.quantity - 1 };
          }
          return item;
        })
        .filter((item) => item.quantity > 0);
    }
    case "REMOVE_ITEM": {
      return state.filter((item) => item.productId !== action.productId);
    }
    case "CLEAR_BILL": {
      return [];
    }
    default:
      return state;
  }
}

export default function BillingScreen({
  canAddProducts,
}: {
  /** Admins may add an unknown scanned code as a new product; cashiers just see "not found". */
  canAddProducts: boolean;
}) {
  const [bill, dispatch] = useReducer(billReducer, []);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const isCompletingSale = false;

  // Modals & Camera state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [continuousScan, setContinuousScan] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState("");
  const [completedSaleModal, setCompletedSaleModal] = useState<{
    saleId: string;
    subtotal: number;
    itemCount: number;
  } | null>(null);

  // Visual cues
  const [scanFlash, setScanFlash] = useState<"success" | "error" | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: "info" | "error" | "success";
    text: string;
  } | null>(null);

  const scanInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus helper
  const focusInput = useCallback(() => {
    if (isCameraOpen || isAddModalOpen || completedSaleModal) return;
    scanInputRef.current?.focus();
  }, [isCameraOpen, isAddModalOpen, completedSaleModal]);

  // Initial focus and refocus after modals close
  useEffect(() => {
    focusInput();
  }, [focusInput]);

  // Global click refocus for POS barcode guns
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (isCameraOpen || isAddModalOpen || completedSaleModal) return;
      const target = e.target as HTMLElement;
      // Do not steal focus if clicking inside another button or input
      if (
        target.tagName === "INPUT" ||
        target.tagName === "BUTTON" ||
        target.closest("button") ||
        target.closest("input")
      ) {
        return;
      }
      scanInputRef.current?.focus();
    };

    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, [isCameraOpen, isAddModalOpen, completedSaleModal]);

  // Handle barcode scan (from physical scanner or camera)
  const handleProcessBarcode = async (rawCode: string) => {
    const barcode = rawCode.trim();
    if (!barcode) return;

    setIsLookingUp(true);
    setStatusMessage(null);

    try {
      const result = await lookupProduct(barcode);

      if (!result.success) {
        // Lookup itself failed (network / database): do not treat it as an unknown code.
        playScanErrorTone();
        setScanFlash("error");
        setTimeout(() => setScanFlash(null), 1000);
        setStatusMessage({
          type: "error",
          text: result.error || "Error looking up code. Please try again.",
        });
      } else if (result.data && !result.data.isActive) {
        playScanErrorTone();
        setScanFlash("error");
        setTimeout(() => setScanFlash(null), 1000);
        setStatusMessage({
          type: "error",
          text: `${result.data.itemCode} · ${result.data.name} is inactive and cannot be billed.`,
        });
      } else if (result.data) {
        // Product Found
        playScanSuccessBeep();
        dispatch({ type: "ADD_PRODUCT", product: result.data });

        setScanFlash("success");
        setTimeout(() => setScanFlash(null), 800);

        setStatusMessage({
          type: "success",
          text: `Added: ${result.data.name}`,
        });
      } else {
        // Product NOT Found
        playScanErrorTone();
        setScanFlash("error");
        setTimeout(() => setScanFlash(null), 1000);

        if (canAddProducts) {
          setStatusMessage({
            type: "error",
            text: `Code ${barcode} not in catalog. Add it below.`,
          });
          // Open quick add modal prefilled
          setUnknownBarcode(barcode);
          setIsAddModalOpen(true);
        } else {
          setStatusMessage({ type: "error", text: `Not found: ${barcode}` });
        }
      }
    } catch {
      playScanErrorTone();
      setScanFlash("error");
      setTimeout(() => setScanFlash(null), 1000);
      setStatusMessage({
        type: "error",
        text: "Error looking up barcode. Please try again.",
      });
    } finally {
      setIsLookingUp(false);
      setBarcodeInput("");
      setTimeout(focusInput, 100);
    }
  };

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (barcodeInput.trim()) {
      handleProcessBarcode(barcodeInput);
    }
  };

  // Called when a product is created from the quick-add modal
  const handleProductCreated = (product: Product) => {
    playScanSuccessBeep();
    dispatch({ type: "ADD_PRODUCT", product });
    setStatusMessage({
      type: "success",
      text: `Created and added: ${product.name}`,
    });
    setTimeout(focusInput, 100);
  };

  // Subtotal in paise
  const subtotalPaise = bill.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );
  const totalItemsCount = bill.reduce((sum, item) => sum + item.quantity, 0);

  // The server side of checkout is ready (completeSale() in src/lib/invoice-actions.ts). The
  // checkout UI — Cash/UPI/Card buttons, one idempotency key per cart, the "status unknown" and
  // retry states — comes with the billing screen rework (REQUIREMENTS.md sections 6 and 12), so
  // this button stays disabled rather than recording every sale as cash.
  const handleCompleteSale = () => {
    if (bill.length === 0) return;
    playScanErrorTone();
    setStatusMessage({
      type: "error",
      text: "Checkout is not enabled on this screen yet (payment buttons come with the billing screen update).",
    });
  };

  return (
    <div className="flex flex-col flex-1 pb-32">
      {/* Top Scanner Bar */}
      <section className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-4 sticky top-[61px] z-30 shadow-xs">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center gap-3">
          {/* Always-focused Barcode Input Form */}
          <form
            onSubmit={handleInputSubmit}
            className={`relative flex-1 w-full transition-all duration-300 rounded-2xl ${
              scanFlash === "success"
                ? "ring-4 ring-emerald-500/50"
                : scanFlash === "error"
                ? "ring-4 ring-red-500/50 animate-shake"
                : ""
            }`}
          >
            <div className="relative flex items-center">
              <Barcode className="absolute left-4 h-6 w-6 text-zinc-400 dark:text-zinc-500 shrink-0 pointer-events-none" />
              <input
                ref={scanInputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="Scan barcode or type & press Enter..."
                autoComplete="off"
                disabled={isLookingUp}
                className="w-full h-14 pl-13 pr-28 text-base sm:text-lg font-mono rounded-2xl border-2 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500 focus:bg-white dark:focus:bg-zinc-900 transition-all shadow-inner"
              />
              <div className="absolute right-3 flex items-center gap-1.5">
                {isLookingUp ? (
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                ) : (
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-xs"
                  >
                    Enter
                  </button>
                )}
              </div>
            </div>
          </form>

          {/* Camera Scanner Trigger */}
          <button
            type="button"
            onClick={() => setIsCameraOpen(true)}
            className="w-full sm:w-auto h-14 px-5 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-medium text-sm flex items-center justify-center gap-2.5 transition-colors shrink-0 shadow-sm active:scale-98"
          >
            <Camera className="h-5 w-5 text-emerald-400" />
            <span>Scan with Camera</span>
          </button>
        </div>

        {/* Status Toast / Alert */}
        {statusMessage && (
          <div className="max-w-4xl mx-auto mt-2">
            <div
              className={`flex items-center justify-between text-xs px-3.5 py-2 rounded-xl transition-all ${
                statusMessage.type === "success"
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                  : statusMessage.type === "error"
                  ? "bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800"
                  : "bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
              }`}
            >
              <span>{statusMessage.text}</span>
              <button
                onClick={() => setStatusMessage(null)}
                className="opacity-60 hover:opacity-100 text-xs ml-2 font-bold"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Main Bill Container */}
      <div className="max-w-4xl w-full mx-auto p-4 flex-1 flex flex-col">
        {bill.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl my-6 bg-white/50 dark:bg-zinc-900/40">
            <div className="h-16 w-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 mb-4">
              <ShoppingCart className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
              The bill is empty
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mt-1">
              Scan items using a USB/Bluetooth barcode reader, or click &ldquo;Scan with Camera&rdquo; to start billing.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              <span>Items ({totalItemsCount})</span>
              <span>Price & Subtotal</span>
            </div>

            {/* List of scanned bill items */}
            {bill.map((item) => {
              const lineTotal = item.unitPrice * item.quantity;

              return (
                <div
                  key={item.productId}
                  className="flex items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
                >
                  {/* Left: Product Info */}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm sm:text-base text-zinc-900 dark:text-zinc-100 truncate">
                      {item.name}
                    </h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                        {item.itemCode}
                      </span>
                      <span className="text-xs text-zinc-500">
                        • {formatINR(item.unitPrice)} each
                      </span>
                    </div>
                  </div>

                  {/* Center: Quantity Controls */}
                  <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "DECREMENT_QTY",
                          productId: item.productId,
                        })
                      }
                      className="h-8 w-8 flex items-center justify-center rounded-lg bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600 active:scale-95 transition-all shadow-xs"
                      title="Decrease quantity"
                    >
                      <Minus className="h-4 w-4" />
                    </button>

                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) {
                          dispatch({
                            type: "UPDATE_QTY",
                            productId: item.productId,
                            quantity: val,
                          });
                        }
                      }}
                      className="w-12 text-center font-bold text-sm bg-transparent border-none text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "INCREMENT_QTY",
                          productId: item.productId,
                        })
                      }
                      className="h-8 w-8 flex items-center justify-center rounded-lg bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600 active:scale-95 transition-all shadow-xs"
                      title="Increase quantity"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Right: Line total & Remove */}
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="font-extrabold text-sm sm:text-base text-zinc-900 dark:text-zinc-100">
                        {formatINR(lineTotal)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "REMOVE_ITEM",
                          productId: item.productId,
                        })
                      }
                      className="h-8 w-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                      title="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky Bottom Bar with Live Subtotal & Actions */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-zinc-200 dark:border-zinc-800 shadow-xl px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          {/* Subtotal Display */}
          <div>
            <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
              Live Subtotal ({totalItemsCount} items)
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400">
              {formatINR(subtotalPaise)}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                if (bill.length > 0 && confirm("Are you sure you want to clear this entire bill?")) {
                  dispatch({ type: "CLEAR_BILL" });
                  setStatusMessage({ type: "info", text: "Bill cleared." });
                  setTimeout(focusInput, 100);
                }
              }}
              disabled={bill.length === 0 || isCompletingSale}
              className="px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium text-xs sm:text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-all flex items-center gap-1.5"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Clear Bill</span>
            </button>

            <button
              type="button"
              onClick={handleCompleteSale}
              disabled={bill.length === 0 || isCompletingSale}
              className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm sm:text-base disabled:opacity-40 shadow-lg shadow-emerald-600/20 active:scale-98 transition-all flex items-center gap-2"
            >
              {isCompletingSale ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5" />
                  <span>Complete Sale</span>
                </>
              )}
            </button>
          </div>
        </div>
      </footer>

      {/* Camera Scanner Modal */}
      {isCameraOpen && (
        <CameraScanner
          isOpen={isCameraOpen}
          onClose={() => {
            setIsCameraOpen(false);
            setTimeout(focusInput, 100);
          }}
          onScan={(scannedBarcode) => {
            handleProcessBarcode(scannedBarcode);
          }}
          continuous={continuousScan}
          onToggleContinuous={setContinuousScan}
        />
      )}

      {/* Quick Add Product Modal */}
      {isAddModalOpen && (
        <AddProductModal
          key={unknownBarcode}
          isOpen={isAddModalOpen}
          initialBarcode={unknownBarcode}
          onClose={() => {
            setIsAddModalOpen(false);
            setTimeout(focusInput, 100);
          }}
          onProductCreated={handleProductCreated}
        />
      )}

      {/* Completed Sale Receipt Modal */}
      {completedSaleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-sm rounded-3xl bg-white dark:bg-zinc-900 p-6 shadow-2xl border border-zinc-200 dark:border-zinc-800 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 mb-4">
              <Sparkles className="h-8 w-8" />
            </div>

            <h3 className="text-xl font-extrabold text-zinc-900 dark:text-zinc-100">
              Sale Completed!
            </h3>
            <p className="text-xs text-zinc-500 mt-1">
              Sale record stored with snapshot pricing.
            </p>

            <div className="my-5 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 text-left space-y-2">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Sale ID:</span>
                <span className="font-mono text-zinc-800 dark:text-zinc-200">
                  {completedSaleModal.saleId.slice(0, 8)}...
                </span>
              </div>
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Total Items:</span>
                <span className="font-bold text-zinc-800 dark:text-zinc-200">
                  {completedSaleModal.itemCount}
                </span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-zinc-900 dark:text-zinc-100 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                <span>Total Paid:</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {formatINR(completedSaleModal.subtotal)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setCompletedSaleModal(null);
                  setTimeout(focusInput, 100);
                }}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors shadow-sm"
              >
                Start Next Sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
