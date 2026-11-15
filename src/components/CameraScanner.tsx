"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Camera, X, RefreshCw, AlertCircle, Check } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { ALERT_TONES, AlertIcon } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { DialogOverlay, dialogPanelClasses } from "@/components/ui/Dialog";
import { PlainNumbers } from "@/components/ui/PlainNumbers";
import { cx } from "@/components/ui/cx";

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
  /** Running bill total, e.g. "₹1,240.00 · 3 lines · 6 pcs". */
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
    <DialogOverlay className="bg-ink/80">
      <div className={cx("relative w-full max-w-md overflow-hidden", dialogPanelClasses)}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink bg-surface px-4 py-2">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-brand" />
            <span className="font-display text-xl font-bold">Scan Barcode</span>
          </div>

          {summary && <span className="num mr-2 ml-auto text-sm font-bold text-ink">{summary}</span>}
          <Button variant="ghost" size="sm" square onClick={onClose} title="Close camera" aria-label="Close camera">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Viewfinder Area */}
        <div className="relative flex min-h-[300px] flex-col items-center justify-center bg-ink">
          <div
            id={containerId}
            className="w-full overflow-hidden [&_video]:w-full [&_video]:object-cover"
          />

          {isInitializing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/85">
              <RefreshCw className="h-8 w-8 animate-spin text-paper" />
              <p className="text-sm font-semibold text-paper">Starting camera...</p>
            </div>
          )}

          {errorMessage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-paper p-6 text-center text-ink">
              <AlertIcon tone="danger" icon={<AlertCircle />} />
              <p className="text-base font-bold">Camera Access Error</p>
              <p className="max-w-xs text-sm leading-relaxed text-ink-muted">{errorMessage}</p>
              <p className="text-sm text-ink-muted">
                Note: Mobile browsers require HTTPS or localhost to access the camera.
              </p>
              <Button variant="secondary" size="sm" onClick={onClose} className="mt-2">
                Close Scanner
              </Button>
            </div>
          )}

          {lastScanned && continuous && (
            <div
              role="status"
              className={cx(
                "absolute right-4 bottom-3 left-4 flex items-center gap-2 rounded-control border border-ink px-3 py-2 text-sm font-semibold text-ink shadow-hard-sm",
                ALERT_TONES[feedback?.tone === "error" ? "danger" : "success"].box
              )}
            >
              {feedback?.tone === "error" ? (
                <AlertCircle className="h-5 w-5 shrink-0 text-danger" />
              ) : (
                <Check className="h-5 w-5 shrink-0 text-success" />
              )}
              <span className="truncate">{feedback ? <PlainNumbers text={feedback.text} /> : `Scanned: ${lastScanned}`}</span>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="flex items-center justify-between gap-3 border-t border-ink bg-paper-2 px-4 py-3 text-sm">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={continuous}
              onChange={(e) => onToggleContinuous(e.target.checked)}
              className="h-5 w-5 accent-brand"
            />
            <span className="font-bold text-ink">Continuous scanning</span>
          </label>

          <span className="text-right text-ink-muted">
            {continuous ? "Keep camera open" : "Closes after 1 scan"}
          </span>
        </div>
      </div>
    </DialogOverlay>
  );
}
export default CameraScanner;
