import type { ComponentProps } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "ink" | "brand" | "success" | "warning";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-paper-2 text-ink",
  ink: "bg-ink text-paper",
  brand: "bg-brand text-paper",
  success: "bg-success text-surface",
  warning: "bg-warning text-ink",
};

/** Small sticker label: ink outline, rounded, uppercase. */
export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border border-ink px-2 py-px text-xs font-bold tracking-wide uppercase",
        TONES[tone],
        className
      )}
      {...props}
    />
  );
}

/** Keyboard shortcut hint (F7, Enter…). Takes the text colour of its parent (works on red and white). */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cx("rounded-md border border-current px-1.5 font-mono text-xs leading-5 font-bold tabular-nums", className)}
      {...props}
    />
  );
}
