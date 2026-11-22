"use client";

import ExportColumns from "./export-columns";
import { Fragment, useEffect, useMemo, useState } from "react";
import { parseSalesCsv, type SaleLine } from "@/lib/daily-sales-report";
import { CSV_BOM, csvRow, csvText } from "@/lib/csv";
import { formatINR } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";
import { tableStyles as tbl } from "@/components/ui/Table";

const itemColumns = ["Line", "Item Code", "Barcode (current catalog)", "Item Name", "HSN", "Qty", "Unit", "Rate", "GST Rate %", "Taxable Value", "CGST", "SGST", "Line Total"];
const itemMoneyColumns = new Set(["Rate", "Taxable Value", "CGST", "SGST", "Line Total"]);
const moneyColumns = new Set(["Taxable Value", "CGST", "SGST", "Round Off", "Total"]);
function paise(value: string) {
  if (!value?.trim() || !Number.isFinite(Number(value))) throw new Error("Invalid bill amount in export.");
  return Math.round(Number(value) * 100);
}

export default function BillReport({ query, lines }: { query: string; lines: SaleLine[] }) {
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const exportHeaders = ["Invoice No", "Date", "Time (IST)", "Counter", "Cashier", "Payment Method", "", ...itemColumns, "Bill Taxable Value", "Bill CGST", "Bill SGST", "Bill Round Off", "Bill Total"];
  const [data, setData] = useState<{ rows: SaleLine[]; url: string } | null>(null);
  const billItems = useMemo(() => {
    const grouped = new Map<string, SaleLine[]>();
    for (const line of lines) {
      const key = line["Invoice No"];
      const items = grouped.get(key) ?? [];
      items.push(line); grouped.set(key, items);
    }
    return grouped;
  }, [lines]);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    async function load() {
      try {
        const response = await fetch(`/api/exports/daily-summary?${query}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Could not load bill report.");
        }
        const text = await response.text();
        const rows = parseSalesCsv(text, "summary");
        rows.forEach(row => moneyColumns.forEach(column => paise(row[column])));
        if (controller.signal.aborted) return;
        const headers = ["Invoice No", "Date", "Time (IST)", "Counter", "Cashier", "Payment Method", "", ...itemColumns, "Bill Taxable Value", "Bill CGST", "Bill SGST", "Bill Round Off", "Bill Total"];
        const selected = headers.map((header, index) => !header || hiddenColumns.includes(header) ? -1 : index).filter(index => index >= 0);
        const csv = CSV_BOM + csvRow(selected.map(index => headers[index])) + rows.map(row => {
          const items = billItems.get(row["Invoice No"]) ?? [];
          // Keep every exported row rectangular, with bill totals counted exactly once.
          const exportItems: (SaleLine | null)[] = items.length ? items : [null];
          return exportItems.map((item, index) => csvRow([
            ...[row["Invoice No"], row.Date, row["Time (IST)"], row.Counter, row.Cashier, row["Payment Method"]].map(csvText),
            "", // Spacer column visually indents the item details in the CSV.
            ...itemColumns.map(column => {
              const value = item?.[column] || (column === "Unit" ? item?.UOM : "") || "";
              return itemMoneyColumns.has(column) || column === "Qty" || column === "GST Rate %" || column === "Line" ? value : csvText(value);
            }),
            ...[...moneyColumns].map(column => index === 0 ? row[column] : ""),
          ].filter((_, index) => selected.includes(index)))).join("");
        }).join("");
        url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        setData({ rows, url });
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load bill report.");
      }
    }
    void load();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [query, billItems, hiddenColumns]);
  if (error) return <p role="alert" className="text-red-800">{error}</p>;
  if (!data) return <p role="status">Loading bill report…</p>;
  const totals = Object.fromEntries([...moneyColumns].map(column => [column, data.rows.reduce((sum, row) => sum + paise(row[column]), 0)]));
  return <section className="space-y-4" aria-label="Bill-wise report">
    <ExportColumns columns={exportHeaders} hidden={hiddenColumns} onChange={setHiddenColumns} />
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-bold">{data.rows.length} bills · Grand total {formatINR(totals.Total)} · Round off {formatINR(totals["Round Off"])}</p><a href={data.url} download={`sales-bills-${new URLSearchParams(query).get("date")}.csv`} className={buttonClasses({ variant: "secondary" })}>Download bill CSV</a></div>
    {data.rows.length ? <div className={tbl.wrap}><table className={tbl.table}><thead className={tbl.thead}><tr><th className={tbl.th}>Invoice number</th></tr></thead><tbody>{data.rows.map(row => {
      const items = billItems.get(row["Invoice No"]) ?? [];
      return <Fragment key={row["Invoice No"]}><tr className={`${tbl.tr} bg-paper`}><th scope="row" className={`${tbl.td} font-mono font-bold`}>{row["Invoice No"]}</th></tr><tr><td className="border-b-2 border-ink/30 p-3 pl-8">
        <div className={tbl.wrap}><table className={`${tbl.table} mb-3 min-w-[700px]`}><caption className="sr-only">Bill details for {row["Invoice No"]}</caption><thead className={tbl.thead}><tr>{["Date / Time (IST)", "Counter", "Cashier", "Payment mode", "Taxable", "CGST", "SGST", "Round off", "Bill total"].map(column => <th key={column} className={tbl.th}>{column}</th>)}</tr></thead><tbody><tr><td className={tbl.td}>{row.Date} {row["Time (IST)"]}</td><td className={tbl.td}>{row.Counter}</td><td className={tbl.td}>{row.Cashier}</td><td className={tbl.td}><strong className="font-extrabold">{row["Payment Method"]}</strong></td>{[...moneyColumns].map(column => <td key={column} className={`${tbl.td} num whitespace-nowrap`}>{formatINR(paise(row[column]))}</td>)}</tr></tbody></table></div>
        <div className={tbl.wrap}><table className={`${tbl.table} min-w-[1000px]`}><caption className="sr-only">Items billed on {row["Invoice No"]}</caption><thead className={tbl.thead}><tr>{itemColumns.map(column => <th key={column} className={tbl.th}>{column}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={`${item.Line}-${index}`} className={tbl.tr}>{itemColumns.map(column => <td key={column} className={`${tbl.td} ${column === "Item Name" ? "" : "whitespace-nowrap"}`}>{itemMoneyColumns.has(column) ? formatINR(paise(item[column])) : column === "Unit" ? item.Unit || item.UOM : item[column] || "—"}</td>)}</tr>)}</tbody></table></div>
        {!items.length && <p role="alert" className="p-4 text-red-800">Item details were not available in the loaded sales export. Generate the report again.</p>}
      </td></tr></Fragment>;
    })}</tbody></table></div> : <p>No bills for this date and counter.</p>}

    <p className="text-sm text-ink-muted">Each bill includes its billed item lines. Grand totals include invoice round-off. CSV has one row per billed item with invoice details on every row and a spacer column before item details. Bill totals appear only on the first item row of each bill, so totals can be summed without double counting.</p>
  </section>;
}
