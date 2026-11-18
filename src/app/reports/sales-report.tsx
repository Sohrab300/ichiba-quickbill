"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { groupSales, parseSalesCsv, type SaleLine } from "@/lib/sales-report";
import { CSV_BOM, csvRow, csvText, paiseToRupees } from "@/lib/csv";
import { formatINR } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { tableStyles as tbl } from "@/components/ui/Table";

export default function SalesReport({ today }: { today: string }) {
  const [date, setDate] = useState(today), [counter, setCounter] = useState("");
  const [mode, setMode] = useState<"hsn" | "gst">("hsn");
  const [lines, setLines] = useState<SaleLine[] | null>(null);
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const groups = useMemo(() => groupSales(lines ?? [], mode), [lines, mode]);
  const totals = groups.reduce((a, g) => ({ taxable: a.taxable + g.taxable, cgst: a.cgst + g.cgst, sgst: a.sgst + g.sgst, total: a.total + g.total }), { taxable: 0, cgst: 0, sgst: 0, total: 0 });
  const quantities = (q: Record<string, number>) => Object.entries(q).map(([unit, n]) => `${Number(n.toFixed(3)).toLocaleString("en-IN")} ${unit}`).join(" · ");
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
      setLines(parsed); setScope(`${date} · ${counter.trim().toUpperCase() || "All counters"}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load sales."); }
    finally { setBusy(false); }
  }
  function download() {
    const content = CSV_BOM + csvRow([...(mode === "hsn" ? ["HSN"] : []), "GST Rate %", "Invoices", "Lines", "Quantity by unit", "Taxable Value", "CGST", "SGST", "Total GST", "Sales before round-off"]) + groups.map(g => csvRow([...(mode === "hsn" ? [csvText(g.hsn)] : []), g.gst, g.invoices.size, g.lines, csvText(quantities(g.quantities)), ...[g.taxable, g.cgst, g.sgst, g.cgst + g.sgst, g.total].map(paiseToRupees)])).join("");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `sales-${mode}-${scope.split(" · ")[0]}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const input = "rounded-lg border border-ink/30 bg-surface px-3 py-2 text-ink";
  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-brand">SALES ANALYSIS</p><h1 className="font-display text-4xl font-extrabold">Sales reports</h1><p className="text-ink-muted">Daily HSN and GST summaries from saved invoice lines.</p></div><Link href="/invoices" className={buttonClasses({ variant: "secondary" })}>View invoices</Link></div>
    <form onSubmit={load} className={cardClasses({ raised: false, className: "flex flex-wrap items-end gap-4 p-4" })}>
      <label className="flex flex-col gap-1 text-sm font-semibold">Sale date (IST)<input className={input} type="date" required value={date} max={today} onChange={e => setDate(e.target.value)} disabled={busy} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Counter code<input className={input} placeholder="All counters" value={counter} maxLength={8} pattern="[A-Za-z0-9]*" onChange={e => setCounter(e.target.value)} disabled={busy} /></label>
      <button disabled={busy} className={buttonClasses({ variant: "primary" })}>{busy ? "Loading sales…" : "Generate report"}</button>
    </form>
    {error && <p role="alert" className="rounded-lg border border-red-400 bg-red-50 p-4 text-red-800">{error}</p>}
    {lines !== null ? <>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">{scope}</h2><p className="text-sm text-ink-muted">{new Set(lines.map(l => l["Invoice No"])).size} invoices · {lines.length} sale lines</p></div><div className="flex flex-wrap gap-2"><label className="flex items-center gap-2 font-semibold">Group by<select className={input} value={mode} onChange={e => setMode(e.target.value as "hsn" | "gst")}><option value="hsn">HSN + GST rate</option><option value="gst">GST rate</option></select></label><button onClick={download} disabled={!groups.length} className={buttonClasses({ variant: "secondary" })}>Download CSV</button></div></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Taxable sales", totals.taxable], ["CGST", totals.cgst], ["SGST", totals.sgst], ["Sales before round-off", totals.total]].map(([label, value]) => <div key={label} className={cardClasses({ raised: false, className: "p-4" })}><p className="text-sm text-ink-muted">{label}</p><p className="num mt-2 text-xl font-bold">{formatINR(Number(value))}</p></div>)}</div>
      {groups.length ? <div className={tbl.wrap}><table className={`${tbl.table} min-w-[1000px]`}><thead className={tbl.thead}><tr>{[...(mode === "hsn" ? ["HSN"] : []), "GST %", "Invoices", "Lines", "Quantity", "Taxable value", "CGST", "SGST", "Total GST", "Sales before round-off"].map(h => <th key={h} className={tbl.th}>{h}</th>)}</tr></thead><tbody>{groups.map(g => <tr key={`${g.hsn}-${g.gst}`} className={tbl.tr}>{mode === "hsn" && <td className={tbl.td}>{g.hsn}</td>}<td className={tbl.td}>{g.gst}%</td><td className={tbl.td}>{g.invoices.size}</td><td className={tbl.td}>{g.lines}</td><td className={tbl.td}>{quantities(g.quantities)}</td>{[g.taxable, g.cgst, g.sgst, g.cgst + g.sgst, g.total].map((n, i) => <td key={i} className={`${tbl.td} num whitespace-nowrap`}>{formatINR(n)}</td>)}</tr>)}</tbody></table></div> : <p className="rounded-lg border border-dashed border-ink/30 p-10 text-center">No sales for this date and counter.</p>}
      <p className="text-sm text-ink-muted">Sales totals are the sum of invoice lines, before invoice round-off. Invoice counts within groups overlap. Missing HSN codes appear as Unspecified. Change grouping without reloading sales.</p>
    </> : !busy && <div className="rounded-lg border border-dashed border-ink/30 p-12 text-center text-ink-muted">Choose a date and generate a report to view sales by HSN or GST rate.</div>}
  </div>;
}
