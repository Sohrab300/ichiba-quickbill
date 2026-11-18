import { connection, type NextRequest } from "next/server";
import { AuthError, getStaffContext } from "@/lib/auth";
import { jsonError } from "@/lib/exports";
import { parseSalesReportInput, salesReportCsv, salesReportFilename } from "@/lib/sales-report";
import { SalesReportInputError, fetchSalesReport } from "@/lib/sales-report-data";

/**
 * The Reports page table as CSV: ?from=YYYY-MM-DD&to=YYYY-MM-DD&group=hsn|gst[&counter=CL1].
 * Same query as the page (sales_report()), same rows and order, then a Total row. Admin only.
 */
export async function GET(request: NextRequest): Promise<Response> {
  // Request-time only; outside the try so the prerender bail-out during `next build` is not caught.
  await connection();
  try {
    await getStaffContext("admin");
  } catch (err: unknown) {
    if (err instanceof AuthError) return jsonError(err.message, err.status);
    console.error("Sales report CSV: could not check the login", err);
    return jsonError("Could not check your login.", 500);
  }

  const params = request.nextUrl.searchParams;
  const parsed = parseSalesReportInput({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    counter: params.get("counter"),
    group: params.get("group") ?? undefined,
  });
  if (!parsed.ok) return jsonError(parsed.error, 400);

  try {
    const report = await fetchSalesReport(parsed.query);
    return new Response(salesReportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${salesReportFilename(report)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: unknown) {
    if (err instanceof SalesReportInputError) return jsonError(err.message, 400);
    console.error("Sales report CSV failed", err);
    return jsonError(err instanceof Error ? err.message : "Export failed.", 500);
  }
}
