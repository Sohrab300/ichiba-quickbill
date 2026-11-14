"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import Link from "next/link";

interface InvoiceFiltersFormProps {
  date: string;
  /** null = all counters. */
  counterCode: string | null;
  search: string;
  /** Counter codes an admin can pick from; empty for cashiers. */
  counterCodes: string[];
  /** Cashier: date and counter are fixed (today, own counter). */
  locked: boolean;
  today: string;
}

/**
 * The /invoices filters as a plain GET form, so the URL is the state (shareable, back button
 * works) and the list is rendered on the server. Date and counter apply as soon as they change.
 */
export function InvoiceFiltersForm({ date, counterCode, search, counterCodes, locked, today }: InvoiceFiltersFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  const fieldClass =
    "h-11 rounded-lg border-2 border-zinc-300 bg-white px-3 text-base font-medium focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <form ref={formRef} method="get" action="/invoices" className="flex flex-wrap items-end gap-3">
      {locked ? (
        <p className="flex h-11 items-center rounded-lg bg-zinc-100 px-3 text-sm font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {counterCode ? `Counter ${counterCode}` : "No counter"} · Today
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Date (IST)
            <input
              type="date"
              name="date"
              defaultValue={date}
              max={today}
              required
              onChange={(e) => e.target.value && submit()}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Counter
            <select name="counter" defaultValue={counterCode ?? ""} onChange={submit} className={fieldClass}>
              <option value="">All counters</option>
              {counterCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        Invoice number
        <span className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
          <input
            type="text"
            name="q"
            defaultValue={search}
            placeholder="e.g. 000123 or CL1/26-27/000123"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            className={`${fieldClass} w-full pl-9`}
          />
        </span>
      </label>

      <button
        type="submit"
        className="h-11 rounded-lg bg-emerald-700 px-5 text-sm font-bold text-white hover:bg-emerald-800"
      >
        Search
      </button>
      {search && (
        <Link
          href={locked ? "/invoices" : `/invoices?date=${date}${counterCode ? `&counter=${counterCode}` : ""}`}
          className="flex h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" aria-hidden />
          Clear search
        </Link>
      )}
      {!locked && (
        <p className="basis-full text-xs text-zinc-500 dark:text-zinc-400">
          A number search covers all dates; the counter filter still applies.
        </p>
      )}
    </form>
  );
}
