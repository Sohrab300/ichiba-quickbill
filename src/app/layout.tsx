import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Navbar, { NavbarSkeleton } from "@/components/Navbar";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { tryGetStaffContext } from "@/lib/auth";
import "./globals.css";
import "./print.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  themeColor: "#059669",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
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
