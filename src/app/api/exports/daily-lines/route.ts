import type { NextRequest } from "next/server";
import { exportDailyCsv } from "@/lib/exports";

/** One CSV row per invoice line (HSN, GST rate, taxable, CGST, SGST): ?date=YYYY-MM-DD[&counter=CL1]. Admin only. */
export function GET(request: NextRequest) {
  return exportDailyCsv(request, "lines");
}
