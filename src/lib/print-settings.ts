/**
 * Receipt paper width (REQUIREMENTS.md section 7): set per counter in the database
 * (counters.print_width_mm), optionally overridden on this device in localStorage.
 * Safe to import from client components.
 */

export const PRINT_WIDTHS = [58, 80] as const;
export type PrintWidth = (typeof PRINT_WIDTHS)[number];

/** store_settings.default_print_width_mm default; used when the login has no counter. */
export const DEFAULT_PRINT_WIDTH: PrintWidth = 80;

const STORAGE_KEY = "ichiba.printWidthOverride";
/** `storage` only fires in other tabs; this tells the current tab. */
const CHANGE_EVENT = "ichiba:print-width-change";

function parseWidth(value: unknown): PrintWidth | null {
  const n = Number(value);
  return n === 58 || n === 80 ? n : null;
}

/** This device's override, or null when it follows the counter setting. */
export function getPrintWidthOverride(): PrintWidth | null {
  try {
    return parseWidth(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null; // storage disabled (private mode, policy): follow the counter
  }
}

export function setPrintWidthOverride(width: PrintWidth | null): void {
  try {
    if (width === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Not persisted; nothing else to do.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore. */
export function subscribePrintWidthOverride(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** The width to print at: device override, else the counter's, else the store default. */
export function resolvePrintWidth(counterWidth: PrintWidth | null): PrintWidth {
  return getPrintWidthOverride() ?? counterWidth ?? DEFAULT_PRINT_WIDTH;
}
