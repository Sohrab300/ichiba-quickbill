"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/Button";
import { fieldClasses, labelClasses } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";

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
  /** Admins only: the "Edited only" filter (bills with a per-bill price edit). */
  showEditedFilter: boolean;
  editedOnly: boolean;
}

/**
 * The /invoices filters as a plain GET form, so the URL is the state (shareable, back button
 * works) and the list is rendered on the server. Date and counter apply as soon as they change.
 */
export function InvoiceFiltersForm({
  date,
  counterCode,
  search,
  counterCodes,
  locked,
  today,
  showEditedFilter,
  editedOnly,
}: InvoiceFiltersFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  const fieldClass = fieldClasses({ className: "w-auto" });
  const labelClass = cx("flex flex-col gap-1.5", labelClasses);

  return (
    <form ref={formRef} method="get" action="/invoices" className="flex flex-wrap items-end gap-3">
      {locked ? (
        <p className="flex h-11 items-center rounded-control border border-ink bg-paper-2 px-3 text-sm font-bold text-ink">
          {counterCode ? `Counter ${counterCode}` : "No counter"} · Today
        </p>
      ) : (
        <>
          <label className={labelClass}>
            Date (IST)
            <input
              type="date"
              name="date"
              defaultValue={date}
              max={today}
              required
              onChange={(e) => e.target.value && submit()}
              className={cx(fieldClass, "num")}
            />
          </label>
          <label className={labelClass}>
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
      {showEditedFilter && (
        <label className="flex h-11 cursor-pointer items-center gap-2 rounded-control border border-ink bg-surface px-3 text-sm font-bold select-none">
          <input
            type="checkbox"
            name="edited"
            value="1"
            defaultChecked={editedOnly}
            onChange={submit}
            className="h-5 w-5 accent-brand"
          />
          Edited only
        </label>
      )}

      <label className={cx(labelClass, "min-w-56 flex-1")}>
        Invoice number
        <span className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input
            type="text"
            name="q"
            defaultValue={search}
            placeholder="e.g. 000123 or CL1/26-27/000123"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            className={fieldClasses({ withIcon: true })}
          />
        </span>
      </label>

      <Button type="submit" variant="primary" size="sm" className="px-5">
        Search
      </Button>
      {search && (
        <Link
          href={
            locked
              ? "/invoices"
              : `/invoices?date=${date}${counterCode ? `&counter=${counterCode}` : ""}${editedOnly ? "&edited=1" : ""}`
          }
          className={buttonClasses({ variant: "ghost", size: "sm", link: true, className: "gap-1" })}
        >
          <X className="h-4 w-4" aria-hidden />
          Clear search
        </Link>
      )}
      {!locked && (
        <p className="basis-full text-sm text-ink-muted">
          A number search covers all dates; the counter filter still applies.
        </p>
      )}
    </form>
  );
}
