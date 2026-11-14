"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Camera, X, RefreshCw, AlertCircle, Check } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";

interface CameraScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
  continuous: boolean;
  onToggleContinuous: (enabled: boolean) => void;
  /**
   * Result of the last scan (added / not found), shown over the viewfinder: on a phone the
   * camera covers the scan bar where this message normally appears.
   */
  feedback?: { tone: "success" | "error" | "info"; text: string } | null;
  /** Running bill total, e.g. "₹1,240.00 · 6 qty". */
  summary?: string;
}

export function CameraScanner({
  isOpen,
  onClose,
  onScan,
  continuous,
  onToggleContinuous,
  feedback = null,
  summary,
}: CameraScannerProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = "ichiba-camera-reader";
  const lastScanTimeRef = useRef<number>(0);

  // Effect events always see the latest props, so a re-render of the parent (every scan
  // changes the cart) or toggling "continuous" never restarts the camera.
  const handleDecoded = useEffectEvent((decodedText: string, scanner: Html5Qrcode) => {
    const now = Date.now();
    // Debounce: the same frame decodes many times a second.
    if (now - lastScanTimeRef.current < 1200) return;
    lastScanTimeRef.current = now;
    setLastScanned(decodedText);
    onScan(decodedText);

    if (!continuous) {
      // Single-scan mode: close after the first code.
      scanner
        .stop()
        .catch(() => {})
        .finally(() => {
          scannerRef.current = null;
          onClose();
        });
    }
  });

  useEffect(() => {
    let isMounted = true;

    const startScanner = async () => {
      try {
        // Small delay to ensure DOM element is mounted
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (!isMounted) return;

        const html5QrCode = new Html5Qrcode(containerId);
        scannerRef.current = html5QrCode;

        const config = {
          fps: 10,
          qrbox: { width: 260, height: 180 },
          aspectRatio: 1.333333,
        };

        await html5QrCode.start(
          { facingMode: "environment" },
          config,
          (decodedText) => handleDecoded(decodedText, html5QrCode),
          () => {
            // Frame parse error ignored - standard during live scanning
          }
        );

        if (!isMounted) {
          // Closed (or StrictMode re-mount) while the camera was starting: the cleanup's stop()
          // ran before start() finished, so stop it now or the camera stays on.
          html5QrCode.stop().catch(() => {});
          return;
        }
        setIsInitializing(false);
      } catch (err: unknown) {
        console.error("Camera scanner error:", err);
        if (isMounted) {
          setIsInitializing(false);
          const msg =
            err instanceof Error
              ? err.message
              : "Unable to access camera. Please ensure camera permissions are granted and you are on HTTPS or localhost.";
          setErrorMessage(msg);
        }
      }
    };

    startScanner();

    return () => {
      isMounted = false;
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {})
          .finally(() => {
            scannerRef.current = null;
          });
      }
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-zinc-900 text-white shadow-2xl border border-zinc-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-emerald-400" />
            <span className="font-semibold text-sm">Scan Barcode</span>
          </div>

          {summary && <span className="ml-auto mr-2 text-sm font-bold tabular-nums text-zinc-100">{summary}</span>}
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            title="Close camera"
            aria-label="Close camera"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Viewfinder Area */}
        <div className="relative bg-black flex flex-col items-center justify-center min-h-[300px]">
          <div
            id={containerId}
            className="w-full overflow-hidden [&_video]:w-full [&_video]:object-cover"
          />

          {isInitializing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 gap-3">
              <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
              <p className="text-sm text-zinc-300">Starting camera...</p>
            </div>
          )}

          {errorMessage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/95 p-6 text-center gap-3">
              <AlertCircle className="h-10 w-10 text-red-400" />
              <p className="text-sm font-semibold text-red-200">Camera Access Error</p>
              <p className="text-xs text-zinc-400 leading-relaxed max-w-xs">{errorMessage}</p>
              <p className="text-[11px] text-zinc-500">
                Note: Mobile browsers require HTTPS or localhost to access the camera.
              </p>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
              >
                Close Scanner
              </button>
            </div>
          )}

          {lastScanned && continuous && (
            <div
              role="status"
              className={`absolute bottom-3 left-4 right-4 rounded-xl border px-3 py-2 flex items-center gap-2 text-sm font-medium shadow-lg ${
                feedback?.tone === "error"
                  ? "bg-red-950/90 border-red-500/60 text-red-100"
                  : "bg-emerald-900/90 border-emerald-500/50 text-emerald-100"
              }`}
            >
              {feedback?.tone === "error" ? (
                <AlertCircle className="h-4 w-4 text-red-300 shrink-0" />
              ) : (
                <Check className="h-4 w-4 text-emerald-400 shrink-0" />
              )}
              <span className="truncate">{feedback?.text ?? `Scanned: ${lastScanned}`}</span>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3 bg-zinc-900/90 text-xs">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={continuous}
              onChange={(e) => onToggleContinuous(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-zinc-300 font-medium">Continuous scanning</span>
          </label>

          <span className="text-zinc-500 text-[11px]">
            {continuous ? "Keep camera open" : "Closes after 1 scan"}
          </span>
        </div>
      </div>
    </div>
  );
}
export default CameraScanner;
