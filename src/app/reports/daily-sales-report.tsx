"use client";

import { Fragment, useMemo, useState } from "react";
import ExportColumns from "./export-columns";
import BillReport from "./bill-report";
import { groupSales, parseSalesCsv, type SaleLine } from "@/lib/daily-sales-report";
import { CSV_BOM, csvRow, csvText, paiseToRupees } from "@/lib/csv";
import { formatINR } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { tableStyles as tbl } from "@/components/ui/Table";

export default function DailySalesReport({ today, mode }: { today: string; mode: "item" | "payment" | "bill" }) {
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [exportingGofrugal, setExportingGofrugal] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [date, setDate] = useState(today), [counter, setCounter] = useState("");
  const [lines, setLines] = useState<SaleLine[] | null>(null);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const groups = useMemo(() => groupSales(lines ?? [], mode === "bill" ? "item" : mode), [lines, mode]);
  const totals = groups.reduce((a, g) => ({ taxable: a.taxable + g.taxable, cgst: a.cgst + g.cgst, sgst: a.sgst + g.sgst, total: a.total + g.total }), { taxable: 0, cgst: 0, sgst: 0, total: 0 });
  const quantities = (q: Record<string, number>) => Object.values(q).map(n => Number(n.toFixed(3)).toLocaleString("en-IN")).join(" / ");
  const units = (q: Record<string, number>) => Object.keys(q).map(unit => unit.toLowerCase() === "kg" ? "kg" : "pcs").join(" / ");
  async function load(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setLines(null);
    try {
      const query = new URLSearchParams({ date });
      if (counter.trim()) query.set("counter", counter.trim());
      const response = await fetch(`/api/exports/daily-lines?${query}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Could not load sales. Please retry.");
      }
      const parsed = parseSalesCsv(await response.text());
      groupSales(parsed, "hsn");
      setLoadedQuery(query.toString()); setLines(parsed); setScope(`${date} · ${counter.trim().toUpperCase() || "All counters"}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load sales."); }
    finally { setBusy(false); }
  }
  const itemView = mode === "item" || mode === "payment";
  const extraHeaders = [...(mode === "payment" ? ["Payment method", "Bill numbers"] : []), ...(itemView ? ["Item code", "Barcode (current catalog)", "Item name"] : [])];
  const paymentSections = [...new Set(groups.map(g => g.payment))].map(payment => ({ payment, rows: groups.filter(g => g.payment === payment) }));
  const exportHeaders = [...extraHeaders, "GST Rate %", "Invoices", "Quantity", "Unit", "Taxable Value", "CGST", "SGST", "Total GST", "Sales before round-off"];
  const selected = exportHeaders.map((header, index) => hiddenColumns.includes(header) ? -1 : index).filter(index => index >= 0);
  async function exportGofrugal() {
    setExportingGofrugal(true); setExportNotice(""); setError("");
    try {
      const { downloadGofrugal } = await import("@/lib/gofrugal-export");
      const count = await downloadGofrugal(lines ?? [], `gofrugal-${scope.split(" · ")[0]}.xlsx`);
      setExportNotice(`Exported ${count} sheet(s), separated by payment mode, each at most ₹50,000. Amount includes GST, before invoice round-off.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Export failed."); }
    finally { setExportingGofrugal(false); }
  }
  function download() {
    const content = CSV_BOM + csvRow(selected.map(index => exportHeaders[index])) + groups.flatMap(g => Object.entries(g.quantities).map(([unit, quantity]) => {
      const unitGroup = groupSales((lines ?? []).filter(line => (line.Unit || line.UOM || "Units") === unit), mode === "bill" ? "item" : mode).find(group => group.key === g.key)!;
      return csvRow([...(mode === "payment" ? [csvText(g.payment), csvText([...g.invoices].sort().join(", "))] : []), ...(itemView ? [csvText(g.itemCode), csvText([...g.barcodes].sort().join(" / ")), csvText([...g.names].join(" / "))] : []), g.gst, g.invoices.size, Number(quantity.toFixed(3)), unit.toLowerCase() === "kg" ? "kg" : "pcs", ...[unitGroup.taxable, unitGroup.cgst, unitGroup.sgst, unitGroup.cgst + unitGroup.sgst, unitGroup.total].map(paiseToRupees)].filter((_, index) => selected.includes(index))); })).join("");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `sales-${mode}-${scope.split(" · ")[0]}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const input = "rounded-lg border border-ink/30 bg-surface px-3 py-2 text-ink";
  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <form onSubmit={load} className={cardClasses({ raised: false, className: "flex flex-wrap items-end gap-4 p-4" })}>
      <label className="flex flex-col gap-1 text-sm font-semibold">Sale date (IST)<input className={input} type="date" required value={date} max={today} onChange={e => setDate(e.target.value)} disabled={busy} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Counter code<input className={input} placeholder="All counters" value={counter} maxLength={8} pattern="[A-Za-z0-9]*" onChange={e => setCounter(e.target.value)} disabled={busy} /></label>
      <button disabled={busy} className={buttonClasses({ variant: "primary" })}>{busy ? "Loading sales…" : "Generate report"}</button>
    </form>
    {error && <p role="alert" className="rounded-lg border border-red-400 bg-red-50 p-4 text-red-800">{error}</p>}
    {lines !== null ? <>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">{scope}</h2><p className="text-sm text-ink-muted">{new Set(lines.map(l => l["Invoice No"])).size} invoices · {lines.length} sale lines</p></div><div className="flex flex-wrap gap-2"><button onClick={exportGofrugal} disabled={!lines.length || exportingGofrugal} className={buttonClasses({ variant: "secondary" })}>{exportingGofrugal ? "Preparing Excel…" : "Export for Gofrugal"}</button>{mode !== "bill" && <button onClick={download} disabled={!groups.length || !selected.length} className={buttonClasses({ variant: "secondary" })}>Download CSV</button>}</div></div>
      {exportNotice && <p role="status" className="text-sm">{exportNotice}</p>}
      {mode === "bill" ? <BillReport key={loadedQuery} query={loadedQuery} lines={lines} /> : <>
      <ExportColumns columns={exportHeaders} hidden={hiddenColumns} onChange={setHiddenColumns} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Taxable sales", totals.taxable], ["CGST", totals.cgst], ["SGST", totals.sgst], ["Sales before round-off", totals.total]].map(([label, value]) => <div key={label} className={cardClasses({ raised: false, className: "p-4" })}><p className="text-sm text-ink-muted">{label}</p><p className="num mt-2 text-xl font-bold">{formatINR(Number(value))}</p></div>)}</div>
      {mode === "payment" && <div className="grid gap-3 sm:grid-cols-3">{["Cash", "Card", "UPI"].map(payment => { const matches = groups.filter(g => g.payment === payment); return <div key={payment} className={cardClasses({ raised: false, className: "p-4" })}><h3 className="font-bold">{payment}</h3><p className="num text-xl font-bold">{formatINR(matches.reduce((sum, g) => sum + g.total, 0))}</p><p className="text-sm text-ink-muted">Sales before round-off · {new Set(matches.flatMap(g => [...g.invoices])).size} invoices</p></div>; })}</div>}
      {groups.length ? <div className={tbl.wrap}><table className={`${tbl.table} min-w-[1000px]`}><thead className={tbl.thead}><tr>{[...extraHeaders, "GST %", "Invoices", "Quantity", "Unit", "Taxable value", "CGST", "SGST", "Total GST", "Sales before round-off"].map(h => <th key={h} className={tbl.th}>{h}</th>)}</tr></thead><tbody>{(mode === "payment" ? paymentSections : [{ payment: "", rows: groups }]).map(section => <Fragment key={section.payment}>{mode === "payment" && <tr className="bg-paper"><th scope="rowgroup" colSpan={extraHeaders.length + 9} className={`${tbl.th} text-left text-lg`}>{section.payment} · {formatINR(section.rows.reduce((sum, g) => sum + g.total, 0))} before round-off</th></tr>}{section.rows.map(g => <tr key={g.key} className={tbl.tr}>{mode === "payment" && <><td className={tbl.td}>{g.payment}</td><td className={`${tbl.td} font-mono min-w-48`}>{[...g.invoices].sort().join(", ")}</td></>}{itemView && <><td className={`${tbl.td} font-mono`}>{g.itemCode}</td><td className={`${tbl.td} font-mono`}>{[...g.barcodes].sort().join(" / ") || "—"}</td><td className={tbl.td}>{[...g.names].join(" / ")}</td></>}<td className={tbl.td}>{g.gst}%</td><td className={tbl.td}>{g.invoices.size}</td><td className={tbl.td}>{quantities(g.quantities)}</td><td className={tbl.td}>{units(g.quantities)}</td>{[g.taxable, g.cgst, g.sgst, g.cgst + g.sgst, g.total].map((n, i) => <td key={i} className={`${tbl.td} num whitespace-nowrap`}>{formatINR(n)}</td>)}</tr>)}</Fragment>)}</tbody></table></div> : <p className="rounded-lg border border-dashed border-ink/30 p-10 text-center">No sales for this date and counter.</p>}
      <p className="text-sm text-ink-muted">Sales totals are the sum of invoice lines, before invoice round-off. Invoice counts within groups overlap. Payment sections combine each item code into one row, including all its GST rates. Other item reports separate GST rates. Missing codes appear as Unspecified. Change grouping without reloading sales.</p></>}
    </> : !busy && <div className="rounded-lg border border-dashed border-ink/30 p-12 text-center text-ink-muted">Choose a date and generate a report to tally item codes, payment methods, HSN or GST rates.</div>}
  </div>;
}
