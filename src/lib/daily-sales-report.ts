export type SaleLine = Record<string, string>;

/** RFC-style CSV fields, including escaped quotes and embedded newlines. */
export function parseSalesCsv(text: string, kind: "lines" | "summary" = "lines"): SaleLine[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(field); field = "";
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        rows.push(row); row = [];
      }
    } else field += c;
  }
  if (quoted) throw new Error("Incomplete CSV received. Please retry.");
  if (field || row.length) rows.push([...row, field]);
  const headers = rows.shift() ?? [];
  for (const required of kind === "summary" ? ["Invoice No", "Payment Method", "Taxable Value", "CGST", "SGST", "Round Off", "Total"] : ["Invoice No", "HSN", "GST Rate %", "Taxable Value", "CGST", "SGST", "Line Total"]) {
    if (!headers.includes(required)) throw new Error("Unexpected export format. Please sign in again and retry.");
  }
  return rows.filter(r => r.some(Boolean)).map(r => {
    if (r.length !== headers.length) throw new Error("Incomplete CSV received. Please retry.");
    return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
  });
}

export type ReportMode = "hsn" | "gst" | "item" | "payment";

export interface SaleGroup {
  key: string; itemCode: string; names: Set<string>; barcodes: Set<string>; payment: string;
  hsn: string; gst: string; rates: Set<string>; invoices: Set<string>; lines: number;
  quantities: Record<string, number>; taxable: number; cgst: number; sgst: number; total: number;
}
export function groupSales(lines: SaleLine[], mode: ReportMode): SaleGroup[] {
  const groups = new Map<string, SaleGroup>();
  for (const line of lines) {
    const hsn = line.HSN || "Unspecified", gst = line["GST Rate %"];
    const itemCode = line["Item Code"] || "Unspecified", payment = line["Payment Method"] || "Unspecified";
    const key = JSON.stringify(mode === "hsn" ? [hsn, gst] : mode === "item" ? [itemCode, gst] : mode === "payment" ? [payment, itemCode] : [gst]);
    let group = groups.get(key);
    if (!group) {
      group = { key, itemCode, names: new Set(), barcodes: new Set(), payment, hsn, gst, rates: new Set(), invoices: new Set(), lines: 0, quantities: {}, taxable: 0, cgst: 0, sgst: 0, total: 0 };
      groups.set(key, group);
    }
    group.rates.add(gst);
    group.gst = [...group.rates].sort((a, b) => Number(a) - Number(b)).join(" / ");
    if (line["Barcode (current catalog)"]) group.barcodes.add(line["Barcode (current catalog)"]);
    group.names.add(line["Item Name"] || "Unspecified");
    group.invoices.add(line["Invoice No"]); group.lines++;
    const unit = line.Unit || line.UOM || "Units";
    const qty = Number(line.Qty);
    if (!Number.isFinite(qty)) throw new Error("Invalid quantity in export.");
    group.quantities[unit] = (group.quantities[unit] ?? 0) + qty;
    for (const [column, property] of [["Taxable Value", "taxable"], ["CGST", "cgst"], ["SGST", "sgst"], ["Line Total", "total"]] as const) {
      const amount = Number(line[column]);
      if (!Number.isFinite(amount)) throw new Error("Invalid amount in export.");
      group[property] += Math.round(amount * 100);
    }
  }
  return [...groups.values()].sort((a, b) => (mode === "payment" ? a.payment.localeCompare(b.payment) : 0) || (mode === "item" || mode === "payment" ? a.itemCode.localeCompare(b.itemCode) : mode === "hsn" ? a.hsn.localeCompare(b.hsn) : 0) || Number(a.gst) - Number(b.gst));
}
