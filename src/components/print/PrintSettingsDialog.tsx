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
          <legend className="mb-2 text-sm font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Receipt paper width
          </legend>
          <div className="space-y-2">
            {options.map((o) => (
              <label
                key={o.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 ${
                  choice === o.value
                    ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
                    : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"
                }`}
              >
                <input
                  type="radio"
                  name="print-width"
                  value={o.value}
                  checked={choice === o.value}
                  onChange={() => setPrintWidthOverride(o.value === "counter" ? null : o.value === "58" ? 58 : 80)}
                  className="mt-1 h-4 w-4 accent-emerald-700"
                />
                <span>
                  <span className="block text-base font-semibold">{o.label}</span>
                  <span className="block text-sm text-zinc-600 dark:text-zinc-400">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Saved in this browser only. Bills print at <strong className="text-zinc-900 dark:text-zinc-100">{effective} mm</strong>.
          </p>
        </fieldset>

        <div className="rounded-xl bg-zinc-100 p-3 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          In the print dialog choose the receipt printer, set <strong>Margins: None</strong> and turn off{" "}
          <strong>Headers and footers</strong>. The test prints two pages — the printer should cut between them.
        </div>

        {error && <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-xl border-2 border-zinc-300 px-5 text-base font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => void printTest()}
            disabled={testing}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-base font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {testing ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Printer className="h-5 w-5" aria-hidden />}
            Print test page
          </button>
        </div>
      </div>
    </Modal>
  );
}
