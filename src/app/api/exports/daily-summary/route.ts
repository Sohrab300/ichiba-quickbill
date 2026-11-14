import type { NextRequest } from "next/server";
import { exportDailyCsv } from "@/lib/exports";

/** One CSV row per invoice: ?date=YYYY-MM-DD (IST, default today)[&counter=CL1]. Admin only. */
export function GET(request: NextRequest) {
  return exportDailyCsv(request, "summary");
}
