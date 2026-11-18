import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireStaffForPage } from "@/lib/auth";
import { listCounters } from "@/lib/invoice-history";
import { todayIst } from "@/lib/ist-date";
import type { SalesReport as Report } from "@/lib/sales-report";
import { fetchSalesReport } from "@/lib/sales-report-data";
import PageLoading from "@/components/PageLoading";
import SalesReport from "./sales-report";

export default function ReportsPage() {
  return <Suspense fallback={<PageLoading />}><Reports /></Suspense>;
}

async function Reports() {
  const staff = await requireStaffForPage();
  if (staff.role !== "admin") redirect("/invoices");

  const today = todayIst();
  let counterCodes: string[] = [];
  let initial: Report | null = null;
  let error: string | null = null;
  try {
    // Today, all counters, by HSN: the default view, rendered with the page.
    const [counters, report] = await Promise.all([
      listCounters(),
      fetchSalesReport({ from: today, to: today, counter: null, group: "hsn" }),
    ]);
    counterCodes = counters.map((c) => c.code);
    initial = report;
  } catch (err: unknown) {
    console.error("Reports page failed", err);
    error = err instanceof Error ? err.message : "Could not load the sales report.";
  }

  return <SalesReport today={today} counterCodes={counterCodes} initial={initial} initialError={error} />;
}
