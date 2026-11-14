import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Inputs, selects and textareas: white, 2px ink outline, brand focus ring.
 * The select chevron is drawn by the unlayered rule in app/globals.css.
 */
export const fieldBase =
  "rounded-control border border-ink bg-surface text-ink placeholder:text-ink-muted " +
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand " +
  "disabled:cursor-not-allowed disabled:border-ink-muted disabled:bg-paper-2 disabled:text-ink-muted";

/** md 44px · lg 48px · xl 56px tall. */
export type FieldSize = "md" | "lg" | "xl";

const HEIGHTS: Record<FieldSize, string> = { md: "h-11", lg: "h-12", xl: "h-14" };

export interface FieldStyleOptions {
  fieldSize?: FieldSize;
  /** Leaves room for an icon absolutely positioned on the left. */
  withIcon?: boolean;
  className?: string;
}

export function fieldClasses({ fieldSize = "md", withIcon = false, className }: FieldStyleOptions = {}): string {
  return cx(fieldBase, "w-full text-base font-medium", HEIGHTS[fieldSize], withIcon ? "pl-10 pr-3" : "px-3", className);
}

export function Input({ fieldSize, withIcon, className, ...props }: ComponentProps<"input"> & FieldStyleOptions) {
  return <input className={fieldClasses({ fieldSize, withIcon, className })} {...props} />;
}

export function Select({ fieldSize, className, ...props }: ComponentProps<"select"> & Omit<FieldStyleOptions, "withIcon">) {
  return <select className={fieldClasses({ fieldSize, className })} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(fieldBase, "min-h-20 w-full px-3 py-2 text-base font-medium", className)} {...props} />;
}

/** Label text above a field. */
export const labelClasses = "text-sm font-bold text-ink";
/** Helper text under a field. */
export const hintClasses = "text-sm font-normal text-ink-muted";

/** A <label> wrapping its text, control and optional hint. */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1.5", labelClasses, className)}>
      {label}
      {children}
      {hint && <span className={hintClasses}>{hint}</span>}
    </label>
  );
}
