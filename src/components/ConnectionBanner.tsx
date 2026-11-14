"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import { getConnectivity, getServerConnectivity, subscribeConnectivity, type Connectivity } from "@/lib/connectivity";

export function useConnectivity(): Connectivity {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, getServerConnectivity);
}

/**
 * Full-width banner under the navbar while the device is offline or our server can't be reached.
 * There is no offline billing: a sale can only be completed once this banner is gone.
 *
 * Its id is used in globals.css to shrink the desktop billing screen by the banner's height, so
 * the payment buttons never drop below the fold.
 */
export function ConnectionBanner() {
  const state = useConnectivity();
  if (state === "online") return null;

  return (
    <div
      id="connection-banner"
      role="alert"
      className="flex w-full items-center justify-center gap-3 bg-red-700 px-4 py-2 text-white lg:h-12 lg:py-0"
    >
      <WifiOff className="h-5 w-5 shrink-0" aria-hidden />
      <p className="min-w-0 text-sm leading-tight lg:truncate">
        <strong className="text-base">You&apos;re offline — sale can&apos;t be completed.</strong>{" "}
        {state === "offline"
          ? "This device has no network. Check Wi-Fi or mobile data; the cart is kept."
          : "The server isn't answering. Check the internet connection; the cart is kept and this clears by itself."}
      </p>
    </div>
  );
}
