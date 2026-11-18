"use server";

// Reports page actions. Server Actions are public POST endpoints: each one checks the login itself.

import { AuthError, getStaffContext } from "./auth";
import type { ActionResult } from "./actions";
import { parseSalesReportInput, type SalesReport, type SalesReportInput } from "./sales-report";
import { SalesReportInputError, fetchSalesReport } from "./sales-report-data";

/**
 * Sales per HSN + GST rate (or per GST rate) for IST days `from`..`to` (both included, at most
 * 92 days) and an optional counter code, plus the totals. Admin only. One database round trip.
 */
export async function getSalesReport(input: SalesReportInput): Promise<ActionResult<SalesReport>> {
  try {
    await getStaffContext("admin");
    const parsed = parseSalesReportInput(input);
    if (!parsed.ok) return { success: false, error: parsed.error, statusCode: 400 };
    return { success: true, data: await fetchSalesReport(parsed.query), statusCode: 200 };
  } catch (err: unknown) {
    if (err instanceof AuthError) return { success: false, error: err.message, statusCode: err.status };
    if (err instanceof SalesReportInputError) return { success: false, error: err.message, statusCode: 400 };
    console.error("getSalesReport failed", err);
    return { success: false, error: err instanceof Error ? err.message : "Could not load the sales report.", statusCode: 500 };
  }
}
