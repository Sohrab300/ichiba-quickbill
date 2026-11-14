/**
 * Connection state for the "You're offline" banner (REQUIREMENTS.md section 10). Browser-only
 * module, safe to import from client components; there is no offline mode, so the app only
 * needs to say clearly when a sale cannot be completed.
 *
 * Two signals:
 * - navigator.onLine === false: the device has no network at all (reliable when false).
 * - a request to our server failed at the network level (store Wi-Fi up, internet down;
 *   navigator.onLine stays true). Callers report this with reportRequestFailed(); a probe of
 *   a tiny static file then clears it as soon as the server answers again.
 */

export type Connectivity = "online" | "offline" | "unreachable";

/** Static, excluded from the login redirect in src/proxy.ts, never cached (no-store fetch). */
const PROBE_URL = "/manifest.webmanifest";
const PROBE_INTERVAL_MS = 5_000;
const PROBE_TIMEOUT_MS = 4_000;

let unreachable = false;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function setUnreachable(value: boolean): void {
  if (unreachable === value) return;
  unreachable = value;
  if (!value && probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  notify();
}

async function probe(): Promise<void> {
  probeTimer = null;
  if (!unreachable) return;
  try {
    const res = await fetch(PROBE_URL, { cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (res.ok) {
      setUnreachable(false);
      return;
    }
  } catch {
    // still unreachable
  }
  scheduleProbe();
}

function scheduleProbe(delayMs = PROBE_INTERVAL_MS): void {
  if (probeTimer || typeof window === "undefined") return;
  probeTimer = setTimeout(() => void probe(), delayMs);
}

/** A request to our server failed without an answer (network error or timeout). */
export function reportRequestFailed(): void {
  setUnreachable(true);
  scheduleProbe();
}

/** A request to our server got an answer (whatever its content): the server is reachable. */
export function reportRequestSucceeded(): void {
  setUnreachable(false);
}

/** true only when the browser knows it has no network. */
export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function getConnectivity(): Connectivity {
  if (isBrowserOffline()) return "offline";
  return unreachable ? "unreachable" : "online";
}

/** Server render / hydration: assume online (nothing is shown until the browser says otherwise). */
export function getServerConnectivity(): Connectivity {
  return "online";
}

/** For useSyncExternalStore. */
export function subscribeConnectivity(onChange: () => void): () => void {
  listeners.add(onChange);
  const onOnline = () => {
    onChange();
    // The network is back; check the server right away instead of waiting for the next probe.
    if (unreachable) {
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = null;
      scheduleProbe(0);
    }
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onChange);
  };
}

/** Test hook: back to the initial state. */
export function resetConnectivityForTests(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
  unreachable = false;
  listeners.clear();
}
