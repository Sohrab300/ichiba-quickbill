export type SaleLine = Record<string, string>;

/** RFC-style CSV fields, including escaped quotes and embedded newlines. */
export function parseSalesCsv(text: string): SaleLine[] {
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
  for (const required of ["Invoice No", "HSN", "GST Rate %", "Taxable Value", "CGST", "SGST", "Line Total"]) {
    if (!headers.includes(required)) throw new Error("Unexpected export format. Please sign in again and retry.");
  }
  return rows.filter(r => r.some(Boolean)).map(r => {
    if (r.length !== headers.length) throw new Error("Incomplete CSV received. Please retry.");
    return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
  });
}

export interface SaleGroup {
  hsn: string; gst: string; invoices: Set<string>; lines: number;
  quantities: Record<string, number>; taxable: number; cgst: number; sgst: number; total: number;
}
export function groupSales(lines: SaleLine[], mode: "hsn" | "gst"): SaleGroup[] {
  const groups = new Map<string, SaleGroup>();
  for (const line of lines) {
    const hsn = line.HSN || "Unspecified", gst = line["GST Rate %"];
    const key = JSON.stringify(mode === "hsn" ? [hsn, gst] : [gst]);
    let group = groups.get(key);
    if (!group) {
      group = { hsn, gst, invoices: new Set(), lines: 0, quantities: {}, taxable: 0, cgst: 0, sgst: 0, total: 0 };
      groups.set(key, group);
    }
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
  return [...groups.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || Number(a.gst) - Number(b.gst));
}
