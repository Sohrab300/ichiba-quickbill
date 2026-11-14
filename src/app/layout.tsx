import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Baloo_2 } from "next/font/google";
import Navbar, { NavbarSkeleton } from "@/components/Navbar";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { tryGetStaffContext } from "@/lib/auth";
import "./globals.css";
import "./print.css";

/*
 * Type (REQUIREMENTS.md section 15):
 * - Baloo 2: bold, rounded display face (titles, grand total, payment buttons, dialog titles).
 *   Chosen over Fredoka/Righteous because it has tabular figures (tnum) and the ₹ sign, so the
 *   grand total doesn't jitter while it changes.
 * - Atkinson Hyperlegible Next: body text, designed for legibility (0/O, 1/l/I differ), tnum.
 * - Atkinson Hyperlegible Mono: item codes, barcodes and invoice numbers.
 * latin-ext carries the ₹ glyph.
 */
const display = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin", "latin-ext"],
});

// next/font has no metric overrides for the two Atkinson families yet, so they fall back to
// plain system fonts while loading instead of a size-adjusted fallback.
const body = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin", "latin-ext"],
  adjustFontFallback: false,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const mono = Atkinson_Hyperlegible_Mono({
  variable: "--font-atkinson-mono",
  subsets: ["latin", "latin-ext"],
  adjustFontFallback: false,
  fallback: ["ui-monospace", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "Ichiba QuickBill",
  description: "Billing for Ichiba counters and mobile billing.",
  applicationName: "Ichiba QuickBill",
  // Installed on an iPhone home screen: full screen, with this name under the icon.
  // The manifest (app/manifest.ts) and icons (app/icon.svg, app/apple-icon.png) are linked automatically.
  appleWebApp: { capable: true, title: "QuickBill", statusBarStyle: "default" },
  // Invoice numbers and amounts must not turn into tap-to-call links.
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the sticky checkout bar sit above the iPhone home indicator (safe-area padding).
  viewportFit: "cover",
  themeColor: "#F7EDDF",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-paper font-sans text-ink">
        <Suspense fallback={<NavbarSkeleton />}>
          <SessionNavbar />
        </Suspense>
        <ConnectionBanner />
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}

/** Reads the session behind its own Suspense boundary so it never blocks the page shell. */
async function SessionNavbar() {
  const { staff } = await tryGetStaffContext();
  return (
    <Navbar
      staff={
        staff && {
          displayName: staff.displayName,
          role: staff.role,
          counterCode: staff.counter?.code ?? null,
          printWidthMm: staff.counter?.printWidthMm ?? null,
        }
      }
    />
  );
}
