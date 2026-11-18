import type { ComponentProps } from "react";
import { fieldClasses } from "@/components/ui/Field";

/** "All counters" (value "") plus one option per counter code. Used by /invoices and /reports. */
export function CounterSelect({
  counterCodes,
  className,
  ...props
}: Omit<ComponentProps<"select">, "children"> & { counterCodes: string[] }) {
  return (
    <select className={fieldClasses({ className: className ?? "w-auto" })} {...props}>
      <option value="">All counters</option>
      {counterCodes.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}
