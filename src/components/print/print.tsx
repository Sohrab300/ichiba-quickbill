import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { Invoice } from "@/lib/invoice";
import type { PrintWidth } from "@/lib/print-settings";
import { InvoiceReceipt } from "./InvoiceReceipt";
import { TestReceipt } from "./TestReceipt";

/**
 * Browser printing (REQUIREMENTS.md section 7, docs/PRINTER_SETUP.md). Browser-only module.
 *
 * The receipt is rendered into a hidden #print-root at the end of <body>; while a receipt is
 * printing, <html> has the "printing-receipt" class and src/app/print.css hides everything else
 * on the page. Then window.print() opens the normal print dialog — no silent printing, no
 * ESC/POS. Printing never touches the server: if the dialog is cancelled or fails, the invoice
 * is unaffected and Reprint prints it again.
 */

export type PrintResult = { ok: true } | { ok: false; error: string };

const ROOT_ID = "print-root";
const PAGE_STYLE_ID = "print-page-style";
const PRINTING_CLASS = "printing-receipt";
const PX_PER_MM = 96 / 25.4;
/** Added to the measured copy height so rounding never spills a copy onto a second page. */
const PAGE_SLACK_MM = 1;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function getRoot(): { root: Root; container: HTMLDivElement } {
  if (!root || !container?.isConnected) {
    root?.unmount();
    container = document.createElement("div");
    container.id = ROOT_ID;
    container.setAttribute("aria-hidden", "true");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  return { root, container };
}

/**
 * Page size: `<w>mm auto` is what we want (one page per copy, as long as its content), but
 * `auto` is not a valid page height in the CSS spec, so browsers that drop it keep the measured
 * height declared before it instead of falling back to the driver's (often 3 m long) paper.
 */
function setPageStyle(widthMm: PrintWidth, heightMm: number): void {
  let style = document.getElementById(PAGE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = PAGE_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; size: ${widthMm}mm auto; margin: 0; }`;
}

function cleanup(): void {
  document.documentElement.classList.remove(PRINTING_CLASS);
  document.getElementById(PAGE_STYLE_ID)?.remove();
  root?.render(null);
}

/** Lets React paint the screen first (e.g. the Completed panel) — Chrome's dialog blocks it. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/**
 * Renders `content` (one or more .receipt-copy sections) and opens the print dialog.
 * Never throws. `ok: true` means the dialog was opened, not that paper came out.
 *
 * `immediate`: called straight from a tap/click. Skips waiting for a paint so window.print()
 * runs while the tap still counts as a user gesture — phone browsers (iOS Safari in particular)
 * may ignore a print() that isn't. On a phone the system dialog offers its printers and
 * "Save as PDF" / Share.
 */
async function printReceipt(content: ReactNode, widthMm: PrintWidth, immediate = false): Promise<PrintResult> {
  try {
    if (typeof window.print !== "function") {
      return { ok: false, error: "This browser cannot print." };
    }
    if (!immediate) await afterPaint();
    cleanup(); // a previous print whose afterprint never fired

    const { root, container } = getRoot();
    flushSync(() => root.render(content));

    // #print-root is laid out off screen at the receipt width, so the copies can be measured.
    const heights = Array.from(container.querySelectorAll(".receipt-copy"), (el) => el.getBoundingClientRect().height);
    const tallestPx = Math.max(0, ...heights);
    if (tallestPx === 0) throw new Error("Receipt rendered empty");
    setPageStyle(widthMm, Math.ceil(tallestPx / PX_PER_MM + PAGE_SLACK_MM));

    document.documentElement.classList.add(PRINTING_CLASS);
    // Chrome/Edge: window.print() blocks until the dialog closes. Safari/Firefox return at once
    // and print later, so the receipt must stay in place until afterprint.
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    return { ok: true };
  } catch (err) {
    console.error("Printing failed", err);
    try {
      cleanup();
    } catch {
      // ignore
    }
    return { ok: false, error: "Could not open the print dialog." };
  }
}

/** Prints an invoice as returned by the server: one CUSTOMER COPY. */
export function printInvoice(
  invoice: Invoice,
  options: { widthMm: PrintWidth; reprint?: boolean; immediate?: boolean }
): Promise<PrintResult> {
  return printReceipt(
    <InvoiceReceipt invoice={invoice} width={options.widthMm} reprint={options.reprint ?? false} />,
    options.widthMm,
    options.immediate ?? false
  );
}

/** Two-page printer test (Settings → Print test page). */
export function printTestPage(widthMm: PrintWidth): Promise<PrintResult> {
  return printReceipt(<TestReceipt width={widthMm} printedAt={new Date()} />, widthMm);
}
