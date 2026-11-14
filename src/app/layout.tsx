import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Navbar from "@/components/Navbar";
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
  title: "Ichiba POS - Retail Billing & Barcode Scanner",
  description: "Fast barcode-scanning billing web application for retail store Ichiba",
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
        <Suspense fallback={<Navbar staff={null} />}>
          <SessionNavbar />
        </Suspense>
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
