import "server-only";

// Daily CSV exports (REQUIREMENTS.md section 9), streamed from the server page by page.
// Admin only. Dates are IST days; amounts are rupees with 2 decimals. The price-edit columns
// (REQUIREMENTS.md section 16), then Unit and Fraction (section 17) are appended at the end so
// existing spreadsheets keep their columns.

import { connection, type NextRequest } from "next/server";
import { AuthError, getStaffContext } from "./auth";
import { createServerClient } from "./supabase/server";
import type { Database } from "./supabase/database.types";
import { paymentLabel } from "./constants";
import { CSV_BOM, csvRow, csvText, paiseToRupees, quoted, type CsvValue } from "./csv";
import { exportPiecesCell, exportQtyCells } from "./qty";
import { istDateOf, istDayRange, istTimeOf, parseIstDate, todayIst } from "./ist-date";

export type ExportKind = "summary" | "lines";

type Fns = Database["public"]["Functions"];
type SummaryRow = Fns["invoice_export_summary"]["Returns"][number];
type LineRow = Fns["invoice_export_lines"]["Returns"][number];

/** Rows per database round trip (the RPCs cap it at 1000). */
const PAGE_SIZE = 1000;

interface Range {
  from: string;
  to: string;
  counterId: string | null;
}

interface Exporter<Row> {
  filename: string;
  header: string[];
  /** The page after `after` (null = first page), in export order. */
  fetchPage(after: Row | null): Promise<Row[]>;
  toCsv(row: Row): CsvValue[];
}

function rpcError(name: string, error: { code?: string; message: string }): Error {
  if (error.code === "PGRST202") return new Error(`${name}() is missing — apply the invoice history migration.`);
  return new Error(`${name} failed: ${error.message}`);
}

function summaryExporter(range: Range, filename: string): Exporter<SummaryRow> {
  return {
    filename,
    header: [
      "Invoice No", "Date", "Time (IST)", "Counter", "Cashier", "Payment Method", "Items", "Pieces",
      "Taxable Value", "CGST", "SGST", "Round Off", "Total", "Edited (Y/N)", "Fraction (Y/N)",
    ],
    async fetchPage(after) {
      const { data, error } = await createServerClient().rpc("invoice_export_summary", {
        p_from: range.from,
        p_to: range.to,
        ...(range.counterId ? { p_counter_id: range.counterId } : {}),
        ...(after ? { p_after_created_at: after.created_at, p_after_invoice_no: after.invoice_no } : {}),
        p_limit: PAGE_SIZE,
      });
      if (error) throw rpcError("invoice_export_summary", error);
      return data;
    },
    toCsv: (r) => [
      r.invoice_no,
      istDateOf(r.created_at),
      istTimeOf(r.created_at),
      r.counter_code,
      csvText(r.cashier_name),
      paymentLabel(r.payment_method),
      r.item_count,
      exportPiecesCell(Number(r.total_qty)),
      paiseToRupees(r.taxable_total),
      paiseToRupees(r.cgst_total),
      paiseToRupees(r.sgst_total),
      paiseToRupees(r.round_off),
      paiseToRupees(r.grand_total),
      r.has_price_edit ? "Y" : "N",
      r.has_fractional_qty ? "Y" : "N",
    ],
  };
}

function linesExporter(range: Range, filename: string): Exporter<LineRow> {
  return {
    filename,
    header: [
      "Invoice No", "Date", "Time (IST)", "Counter", "Cashier", "Payment Method", "Line", "Item Code",
      "Item Name", "HSN", "UOM", "Qty", "Rate", "MRP", "GST Rate %", "Taxable Value", "CGST", "SGST",
      "Line Total", "Catalog Price", "Charged Price", "Edited (Y/N)", "Unit",
    ],
    async fetchPage(after) {
      const { data, error } = await createServerClient().rpc("invoice_export_lines", {
        p_from: range.from,
        p_to: range.to,
        ...(range.counterId ? { p_counter_id: range.counterId } : {}),
        ...(after
          ? { p_after_created_at: after.created_at, p_after_invoice_no: after.invoice_no, p_after_line_no: after.line_no }
          : {}),
        p_limit: PAGE_SIZE,
      });
      if (error) throw rpcError("invoice_export_lines", error);
      return data;
    },
    toCsv: (r) => {
      const q = exportQtyCells(Number(r.qty), r.sold_by_weight ?? false);
      return [
        r.invoice_no,
        istDateOf(r.created_at),
        istTimeOf(r.created_at),
        r.counter_code,
        csvText(r.cashier_name),
        paymentLabel(r.payment_method),
        r.line_no,
        quoted(csvText(r.item_code)),
        csvText(r.name),
        quoted(r.hsn_code),
        csvText(r.uom),
        q.qty,
        paiseToRupees(r.unit_price),
        r.mrp === null ? "" : paiseToRupees(r.mrp),
        r.gst_rate,
        paiseToRupees(r.taxable_value),
        paiseToRupees(r.cgst),
        paiseToRupees(r.sgst),
        paiseToRupees(r.line_total),
        paiseToRupees(r.catalog_price),
        paiseToRupees(r.unit_price),
        r.price_edited ? "Y" : "N",
        q.unit,
      ];
    },
  };
}

function jsonError(error: string, status: number): Response {
  return Response.json({ success: false, error, statusCode: status }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Streams the CSV. The first page is read before the response starts, so a bad request or a
 * database outage gets a proper error status; a failure later aborts the download (the browser
 * reports it as failed rather than saving a silently truncated file).
 */
async function streamCsv<Row>(exporter: Exporter<Row>): Promise<Response> {
  const encoder = new TextEncoder();
  let pending: Row[] | null = await exporter.fetchPage(null);
  let last: Row | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(CSV_BOM + csvRow(exporter.header)));
    },
    async pull(controller) {
      try {
        const rows: Row[] = pending ?? (await exporter.fetchPage(last));
        pending = null;
        if (rows.length > 0) {
          controller.enqueue(encoder.encode(rows.map((r) => csvRow(exporter.toCsv(r))).join("")));
          last = rows[rows.length - 1];
        }
        if (rows.length < PAGE_SIZE) controller.close();
      } catch (err: unknown) {
        console.error(`CSV export ${exporter.filename} failed mid-stream`, err);
        controller.error(err);
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exporter.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** GET /api/exports/daily-summary and /api/exports/daily-lines: ?date=YYYY-MM-DD[&counter=CL1]. */
export async function exportDailyCsv(request: NextRequest, kind: ExportKind): Promise<Response> {
  // Request-time only. Outside the try below: during `next build` this is where prerendering
  // stops, and that signal must not be caught.
  await connection();
  try {
    await getStaffContext("admin");
  } catch (err: unknown) {
    if (err instanceof AuthError) return jsonError(err.message, err.status);
    console.error("Export: could not check the login", err);
    return jsonError("Could not check your login.", 500);
  }

  const params = request.nextUrl.searchParams;
  const rawDate = params.get("date");
  const date = rawDate === null || rawDate === "" ? todayIst() : parseIstDate(rawDate);
  if (!date) return jsonError("date must be a real date in YYYY-MM-DD form (IST).", 400);

  const counterCode = params.get("counter")?.trim().toUpperCase() || null;

  try {
    let counterId: string | null = null;
    if (counterCode) {
      if (!/^[A-Z0-9]{1,8}$/.test(counterCode)) return jsonError("Unknown counter.", 400);
      const { data, error } = await createServerClient().from("counters").select("id").eq("code", counterCode).maybeSingle();
      if (error) throw new Error(`Could not load the counter: ${error.message}`);
      if (!data) return jsonError(`Unknown counter ${counterCode}.`, 400);
      counterId = data.id;
    }

    const { from, to } = istDayRange(date);
    const range: Range = { from: from.toISOString(), to: to.toISOString(), counterId };
    const suffix = `${date}${counterCode ? `-${counterCode}` : ""}.csv`;
    return kind === "summary"
      ? await streamCsv(summaryExporter(range, `invoices-summary-${suffix}`))
      : await streamCsv(linesExporter(range, `invoice-lines-${suffix}`));
  } catch (err: unknown) {
    console.error(`Export ${kind} failed`, err);
    return jsonError(err instanceof Error ? err.message : "Export failed.", 500);
  }
}
