"use client";

export default function ExportColumns({ columns, hidden, onChange }: { columns: string[]; hidden: string[]; onChange: (hidden: string[]) => void }) {
  return <details className="rounded-lg border border-ink/20 p-3"><summary className="cursor-pointer font-semibold">Export columns ({columns.filter(column => !hidden.includes(column)).length} selected)</summary><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">{columns.filter(Boolean).map(column => <label key={column} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!hidden.includes(column)} onChange={e => onChange(e.target.checked ? hidden.filter(value => value !== column) : [...hidden, column])} />{column}</label>)}</div><p className="mt-2 text-sm text-ink-muted">Select at least one column to download.</p></details>;
}
