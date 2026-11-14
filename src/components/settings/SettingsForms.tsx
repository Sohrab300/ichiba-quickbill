"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { updateCounter, updateStoreSettings } from "@/lib/settings-actions";
import { Alert, InlineAlert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";

export interface StoreSettings {
  legalName: string;
  address: string;
  phone: string;
  gstin: string;
  stateCode: string;
  stateName: string;
  fyLabel: string;
  invoiceFooter: string;
  defaultPrintWidthMm: 58 | 80;
}

export interface CounterSettings {
  id: string;
  code: string;
  kind: "desk" | "mobile";
  invoicePrefix: string;
  printWidthMm: 58 | 80;
  isActive: boolean;
}

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "saved") {
    return (
      <span role="status" className="flex items-center gap-1 text-sm font-bold text-success">
        <Check className="h-4 w-4" aria-hidden /> Saved
      </span>
    );
  }
  if (status.kind === "error") {
    return (
      <InlineAlert tone="danger" role="alert">
        {status.message}
      </InlineAlert>
    );
  }
  return null;
}

function SaveButton({ pending, disabled, children = "Save" }: { pending: boolean; disabled?: boolean; children?: ReactNode }) {
  return (
    <Button type="submit" variant="primary" size="sm" disabled={pending || disabled} className="px-5">
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

export function SettingsForms({ store, counters }: { store: StoreSettings; counters: CounterSettings[] }) {
  return (
    <>
      <Alert tone="warning" size="sm">
        Changes apply to invoices issued from now on. Issued invoices never change: each one keeps the number, FY,
        counter and store details it was printed with.
      </Alert>
      <StoreForm initial={store} counters={counters} />
      <CountersSection counters={counters} fyLabel={store.fyLabel} />
    </>
  );
}

function StoreForm({ initial, counters }: { initial: StoreSettings; counters: CounterSettings[] }) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus({ kind: "idle" });
  };

  const dirty = (Object.keys(form) as (keyof StoreSettings)[]).some((k) => form[k] !== saved[k]);
  const fy = form.fyLabel.trim();
  const fyChanged = fy !== saved.fyLabel;
  const example = counters.find((c) => c.isActive)?.invoicePrefix ?? "CL1";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (
      fyChanged &&
      !window.confirm(
        `Change the financial year from ${saved.fyLabel} to ${fy}?\n\n` +
          `New invoices on every counter will be numbered ${example}/${fy}/000001 onwards ` +
          `(or continue where ${fy} left off, if it was used before). Issued invoices keep their numbers.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await updateStoreSettings({
          legalName: form.legalName,
          address: form.address,
          phone: form.phone,
          gstin: form.gstin,
          stateName: form.stateName,
          fyLabel: form.fyLabel,
          invoiceFooter: form.invoiceFooter,
          defaultPrintWidthMm: form.defaultPrintWidthMm,
        });
        if (res.success) {
          const next = { ...form, gstin: form.gstin.trim().toUpperCase(), stateCode: form.gstin.trim().slice(0, 2), fyLabel: fy };
          setForm(next);
          setSaved(next);
          setStatus({ kind: "saved" });
        } else {
          setStatus({ kind: "error", message: res.error ?? "Could not save." });
        }
      } catch {
        setStatus({ kind: "error", message: "Could not save. Check the connection and try again." });
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className={cardClasses({ className: "space-y-4 p-4 sm:p-5" })}>
      <h2 className="font-display text-2xl leading-tight font-bold">Store details</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Legal name">
            <Input value={form.legalName} onChange={(e) => set("legalName", e.target.value)} required maxLength={200} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Address">
            <Textarea
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              required
              maxLength={500}
              rows={2}
            />
          </Field>
        </div>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" maxLength={20} />
        </Field>
        <Field label="GSTIN" hint={`State code ${form.gstin.trim().slice(0, 2) || "—"} is taken from the GSTIN.`}>
          <Input
            className="font-mono uppercase"
            value={form.gstin}
            onChange={(e) => set("gstin", e.target.value)}
            required
            maxLength={15}
            spellCheck={false}
          />
        </Field>
        <Field label="State">
          <Input value={form.stateName} onChange={(e) => set("stateName", e.target.value)} required maxLength={50} />
        </Field>
        <Field
          label="Financial year"
          hint={
            fyChanged ? (
              <>
                New invoices will use <span className="font-mono">{`${example}/${fy || "??-??"}/000001`}</span> onwards.
              </>
            ) : (
              <>
                e.g. <span className="num">26-27</span> for <span className="num">1 Apr 2026 – 31 Mar 2027</span>
              </>
            )
          }
        >
          <Input
            className="num"
            value={form.fyLabel}
            onChange={(e) => set("fyLabel", e.target.value)}
            required
            pattern="\d{2}-\d{2}"
            maxLength={5}
            inputMode="numeric"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Invoice footer" hint="Printed at the bottom of every receipt. Optional.">
            <Textarea
              value={form.invoiceFooter}
              onChange={(e) => set("invoiceFooter", e.target.value)}
              maxLength={500}
              rows={2}
            />
          </Field>
        </div>
        <Field label="Default print width" hint="Used by logins without a counter.">
          <Select
            className="num"
            value={form.defaultPrintWidthMm}
            onChange={(e) => set("defaultPrintWidthMm", e.target.value === "58" ? 58 : 80)}
          >
            <option value={80}>80 mm</option>
            <option value={58}>58 mm</option>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} disabled={!dirty}>
          Save store details
        </SaveButton>
        <StatusLine status={status} />
      </div>
    </form>
  );
}

function CountersSection({ counters, fyLabel }: { counters: CounterSettings[]; fyLabel: string }) {
  return (
    <section className={cardClasses({ className: "space-y-3 p-4 sm:p-5" })}>
      <div>
        <h2 className="font-display text-2xl leading-tight font-bold">Counters</h2>
        <p className="text-sm text-ink-muted">
          Invoice numbers are <span className="font-mono">PREFIX/{fyLabel}/000001</span>. Each counter keeps its own
          sequence; a prefix another counter has already issued invoices under can&apos;t be reused. A device can still
          override the print width under Printer settings.
        </p>
      </div>
      <ul className="divide-y divide-ink/15">
        {counters.map((c) => (
          <CounterRow key={c.id} counter={c} fyLabel={fyLabel} />
        ))}
      </ul>
    </section>
  );
}

function CounterRow({ counter, fyLabel }: { counter: CounterSettings; fyLabel: string }) {
  const [prefix, setPrefix] = useState(counter.invoicePrefix);
  const [width, setWidth] = useState<58 | 80>(counter.printWidthMm);
  const [saved, setSaved] = useState({ prefix: counter.invoicePrefix, width: counter.printWidthMm });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const cleanPrefix = prefix.trim().toUpperCase();
  const dirty = cleanPrefix !== saved.prefix || width !== saved.width;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (
      cleanPrefix !== saved.prefix &&
      !window.confirm(
        `Change counter ${counter.code}'s prefix from ${saved.prefix} to ${cleanPrefix}?\n\n` +
          `Its next invoice will be ${cleanPrefix}/${fyLabel}/… (the number sequence continues). Issued invoices keep their numbers.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await updateCounter({ id: counter.id, invoicePrefix: cleanPrefix, printWidthMm: width });
        if (res.success) {
          setPrefix(cleanPrefix);
          setSaved({ prefix: cleanPrefix, width });
          setStatus({ kind: "saved" });
        } else {
          setStatus({ kind: "error", message: res.error ?? "Could not save." });
        }
      } catch {
        setStatus({ kind: "error", message: "Could not save. Check the connection and try again." });
      }
    });
  };

  return (
    <li className="py-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="w-28">
          <p className="font-mono text-lg font-bold">{counter.code}</p>
          <p className="text-sm text-ink-muted">
            {counter.kind === "mobile" ? "Mobile" : "Desk"}
            {!counter.isActive && " · disabled"}
          </p>
        </div>
        <div className="w-36">
          <Field label="Prefix">
            <Input
              className="font-mono uppercase"
              value={prefix}
              onChange={(e) => {
                setPrefix(e.target.value);
                setStatus({ kind: "idle" });
              }}
              required
              pattern="[A-Za-z0-9]{1,8}"
              maxLength={8}
              spellCheck={false}
              aria-label={`${counter.code} invoice prefix`}
            />
          </Field>
        </div>
        <div className="w-32">
          <Field label="Print width">
            <Select
              className="num"
              value={width}
              onChange={(e) => {
                setWidth(e.target.value === "58" ? 58 : 80);
                setStatus({ kind: "idle" });
              }}
              aria-label={`${counter.code} print width`}
            >
              <option value={80}>80 mm</option>
              <option value={58}>58 mm</option>
            </Select>
          </Field>
        </div>
        <SaveButton pending={pending} disabled={!dirty} />
        <div className="basis-full sm:basis-auto">
          <StatusLine status={status} />
        </div>
      </form>
    </li>
  );
}
