import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireStaffForPage } from "@/lib/auth";
import { todayIst } from "@/lib/ist-date";
import PageLoading from "@/components/PageLoading";
import SalesReport from "./sales-report";

export default function ReportsPage() {
  return <Suspense fallback={<PageLoading />}><Reports /></Suspense>;
}
async function Reports() {
  const staff = await requireStaffForPage();
  if (staff.role !== "admin") redirect("/invoices");
  return <SalesReport today={todayIst()} />;
}
