"use client";

import { useState, useSyncExternalStore } from "react";
import { Loader2, Printer } from "lucide-react";
import { Modal } from "@/components/billing/Modal";
import {
  DEFAULT_PRINT_WIDTH,
  getPrintWidthOverride,
  setPrintWidthOverride,
  subscribePrintWidthOverride,
  type PrintWidth,
} from "@/lib/print-settings";
import { Alert, InlineAlert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { PlainNumbers } from "@/components/ui/PlainNumbers";
import { printTestPage } from "./print";

interface PrintSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** counters.print_width_mm of this login's counter; null when it has none. */
  counterWidth: PrintWidth | null;
  counterCode: string | null;
}

type Choice = "counter" | "58" | "80";

/** Paper width for this device (stored in localStorage) and a test print. */
export function PrintSettingsDialog({ open, onClose, counterWidth, counterCode }: PrintSettingsDialogProps) {
  const override = useSyncExternalStore(subscribePrintWidthOverride, getPrintWidthOverride, () => null);
  const baseWidth = counterWidth ?? DEFAULT_PRINT_WIDTH;
  const effective = override ?? baseWidth;
  const choice: Choice = override === null ? "counter" : override === 58 ? "58" : "80";

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: { value: Choice; label: string; hint: string }[] = [
    {
      value: "counter",
      label: `Counter setting (${baseWidth} mm)`,
      hint: counterCode ? `Set for counter ${counterCode} by an admin.` : "Store default (this login has no counter).",
    },
    { value: "58", label: "58 mm on this device", hint: "Small roll, about 48 mm printed." },
    { value: "80", label: "80 mm on this device", hint: "Standard roll, about 72 mm printed." },
  ];

  const printTest = async () => {
    setTesting(true);
    setError(null);
    const result = await printTestPage(effective);
    setTesting(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <Modal open={open} title="Printer settings" onClose={onClose}>
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-sm font-bold tracking-wide text-ink-muted uppercase">
            Receipt paper width
          </legend>
          <div className="space-y-2">
            {options.map((o) => (
              <label
                key={o.value}
                className={cx(
                  "flex cursor-pointer items-start gap-3 rounded-card border p-3",
                  choice === o.value ? "border-ink bg-brand-soft shadow-hard-sm" : "border-ink/30 bg-surface hover:border-ink"
                )}
              >
                <input
                  type="radio"
                  name="print-width"
                  value={o.value}
                  checked={choice === o.value}
                  onChange={() => setPrintWidthOverride(o.value === "counter" ? null : o.value === "58" ? 58 : 80)}
                  className="mt-0.5 h-5 w-5 accent-brand"
                />
                <span>
                  <span className="block text-base font-bold">
                    <PlainNumbers text={o.label} />
                  </span>
                  <span className="block text-sm text-ink-muted">
                    <PlainNumbers text={o.hint} />
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            Saved in this browser only. Bills print at <strong className="num text-ink">{effective} mm</strong>.
          </p>
        </fieldset>

        <Alert tone="info" size="sm">
          In the print dialog choose the receipt printer, set <strong>Margins: None</strong> and turn off{" "}
          <strong>Headers and footers</strong>. The test prints two pages — the printer should cut between them.
        </Alert>

        {error && <InlineAlert tone="danger">{error}</InlineAlert>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} className="px-5">
            Done
          </Button>
          <Button variant="primary" onClick={() => void printTest()} disabled={testing} className="px-5">
            {testing ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Printer className="h-5 w-5" aria-hidden />}
            Print test page
          </Button>
        </div>
      </div>
    </Modal>
  );
}
