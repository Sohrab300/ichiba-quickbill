import type { MetadataRoute } from "next";

/**
 * Web app manifest (REQUIREMENTS.md section 10): makes QuickBill installable on phones and
 * desktops. Served at /manifest.webmanifest (excluded from the login redirect in src/proxy.ts).
 *
 * There is deliberately no service worker: nothing is cached for offline use, and a sale can
 * only be completed while the server is reachable (see ConnectionBanner).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Ichiba QuickBill",
    short_name: "QuickBill",
    description: "Billing for Ichiba counters and mobile billing.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fafafa",
    theme_color: "#059669",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
