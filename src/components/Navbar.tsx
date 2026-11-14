"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ShoppingCart, Package, LogOut, Printer, ReceiptText, Settings } from "lucide-react";
import { signOut } from "@/lib/auth-actions";
import type { PrintWidth } from "@/lib/print-settings";
import { PrintSettingsDialog } from "@/components/print/PrintSettingsDialog";

/** What the Navbar shows about the signed-in staff member (no ids or secrets). */
export interface NavbarStaff {
  displayName: string;
  role: "admin" | "cashier";
  counterCode: string | null;
  /** The counter's receipt width (counters.print_width_mm); null without a counter. */
  printWidthMm: PrintWidth | null;
}

export function Navbar({ staff }: { staff: NavbarStaff | null }) {
  const pathname = usePathname();
  const showNav = pathname !== "/login";
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);

  const isAdmin = staff?.role === "admin";
  const navItems = [
    { href: "/", label: "Billing", icon: ShoppingCart },
    { href: "/invoices", label: "Invoices", icon: ReceiptText },
    ...(isAdmin
      ? [
          { href: "/products", label: "Products", icon: Package },
          { href: "/settings", label: "Settings", icon: Settings },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-40 h-16 w-full border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/" className="flex items-center group" aria-label="Sekai Ichiba — Billing">
            <Image
              src="/ichiba-logo.png"
              alt="Sekai Ichiba"
              width={762}
              height={346}
              priority
              className="h-10 w-auto select-none transition-transform group-hover:scale-105"
            />
          </Link>
        </div>

        {showNav && (
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <nav className="flex items-center gap-1 sm:gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden md:inline">{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <Clock />

            {staff && (
              <button
                type="button"
                onClick={() => setPrintSettingsOpen(true)}
                className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                title="Printer settings"
                aria-label="Printer settings"
              >
                <Printer className="h-4 w-4" />
                <span className="hidden xl:inline">Printer</span>
              </button>
            )}

            {staff && (
              <div className="flex min-w-0 items-center gap-2 border-l border-zinc-200 pl-2 sm:pl-4 dark:border-zinc-800">
                <div className="min-w-0 text-right leading-tight">
                  <p className="truncate text-xs font-semibold text-zinc-900 sm:text-sm dark:text-zinc-100">
                    {staff.counterCode ? `Counter ${staff.counterCode}` : "Admin"} · {staff.displayName}
                  </p>
                  {staff.role === "admin" && staff.counterCode && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                      Admin
                    </p>
                  )}
                </div>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    title="Sign out"
                    aria-label="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="hidden md:inline">Sign out</span>
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
      {staff && (
        <PrintSettingsDialog
          open={printSettingsOpen}
          onClose={() => setPrintSettingsOpen(false)}
          counterWidth={staff.printWidthMm}
          counterCode={staff.counterCode}
        />
      )}
    </header>
  );
}
export default Navbar;

/**
 * Static header shown while the session loads (root layout Suspense fallback). It must not read
 * the URL (usePathname): on routes with dynamic params that would block prerendering.
 */
export function NavbarSkeleton() {
  return (
    <header className="sticky top-0 z-40 h-16 w-full border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex h-full max-w-7xl items-center px-4 sm:px-6">
        <Image
          src="/ichiba-logo.png"
          alt="Sekai Ichiba"
          width={762}
          height={346}
          priority
          className="h-10 w-auto select-none"
        />
      </div>
    </header>
  );
}

const clockFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

function subscribeToMinutes(onChange: () => void): () => void {
  const timer = setInterval(onChange, 10_000);
  return () => clearInterval(timer);
}

/** Current minute as a stable number (so the snapshot only changes once a minute). */
const currentMinute = () => Math.floor(Date.now() / 60_000);

/** Date and time (IST). Rendered only in the browser: the server snapshot is null. */
function Clock() {
  const minute = useSyncExternalStore(subscribeToMinutes, currentMinute, () => null);
  if (minute === null) return null;
  return (
    <time
      dateTime={new Date(minute * 60_000).toISOString()}
      className="hidden whitespace-nowrap text-sm font-medium tabular-nums text-zinc-600 lg:block dark:text-zinc-400"
    >
      {clockFormat.format(minute * 60_000)}
    </time>
  );
}
