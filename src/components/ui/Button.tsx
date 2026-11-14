import type { ComponentProps } from "react";
import { cx } from "./cx";

/**
 * primary   — brand red fill, cream text, 3px ink outline, hard shadow that "presses" on click.
 * secondary — white, ink outline, small hard shadow.
 * ghost     — no outline until hovered (toolbar/icon buttons).
 * danger    — destructive: red outline + red text on white (always pass an icon and a label),
 *             so it never looks like a payment button.
 * ghost-danger — quiet destructive action (row remove, "Discard…").
 * ink       — ink fill, cream text (selected toggle).
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ghost-danger" | "ink";
/** sm 44px · md 48px · lg 56px · xl 64px tall (all ≥ 44px touch targets). */
export type ButtonSize = "sm" | "md" | "lg" | "xl";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-bold leading-tight select-none " +
  "transition-[background-color,color,border-color,box-shadow,translate] duration-75 " +
  "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-strong border-ink bg-brand text-paper shadow-hard " +
    "disabled:border-ink-muted disabled:bg-paper-2 disabled:text-ink-muted disabled:shadow-none",
  secondary:
    "border border-ink bg-surface text-ink shadow-hard-sm " +
    "disabled:border-ink-muted disabled:text-ink-muted disabled:shadow-none",
  ghost: "border border-transparent bg-transparent text-ink disabled:text-ink-muted disabled:opacity-60",
  danger:
    "border border-danger bg-surface text-danger shadow-hard-sm " +
    "disabled:border-ink-muted disabled:text-ink-muted disabled:shadow-none",
  "ghost-danger": "border border-transparent bg-transparent text-danger disabled:text-ink-muted disabled:opacity-60",
  ink:
    "border border-ink bg-ink text-paper shadow-hard-sm " +
    "disabled:border-ink-muted disabled:bg-paper-2 disabled:text-ink-muted disabled:shadow-none",
};

/** Hover and the "pressed sticker" offset — only while enabled (buttons) or always (links). */
const INTERACTION: Record<ButtonVariant, { button: string; link: string }> = {
  primary: {
    button: "enabled:hover:bg-brand-hover enabled:active:translate-x-[3px] enabled:active:translate-y-[3px] enabled:active:shadow-none",
    link: "hover:bg-brand-hover active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
  },
  secondary: {
    button: "enabled:hover:bg-paper-2 enabled:active:translate-x-[2px] enabled:active:translate-y-[2px] enabled:active:shadow-none",
    link: "hover:bg-paper-2 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
  },
  ghost: { button: "enabled:hover:bg-paper-2 enabled:hover:border-ink", link: "hover:bg-paper-2 hover:border-ink" },
  danger: {
    button:
      "enabled:hover:bg-danger enabled:hover:text-surface enabled:active:translate-x-[2px] enabled:active:translate-y-[2px] enabled:active:shadow-none",
    link: "hover:bg-danger hover:text-surface active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
  },
  "ghost-danger": { button: "enabled:hover:bg-danger-soft enabled:hover:border-danger", link: "hover:bg-danger-soft hover:border-danger" },
  ink: {
    button: "enabled:active:translate-x-[2px] enabled:active:translate-y-[2px] enabled:active:shadow-none",
    link: "active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
  },
};

const SIZES: Record<ButtonSize, { box: string; square: string }> = {
  sm: { box: "h-11 px-3 text-sm", square: "h-11 w-11" },
  md: { box: "h-12 px-4 text-base", square: "h-12 w-12" },
  lg: { box: "h-14 px-5 text-lg", square: "h-14 w-14" },
  xl: { box: "h-16 px-5 text-xl", square: "h-16 w-16" },
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width. */
  block?: boolean;
  /** Icon-only square button (give it an aria-label). */
  square?: boolean;
  /** Styling an <a>/<Link>: hover/press without the :enabled guard. */
  link?: boolean;
  /** Extra layout classes (margins, flex, width). Don't pass colours or heights. */
  className?: string;
}

export function buttonClasses({
  variant = "secondary",
  size = "md",
  block = false,
  square = false,
  link = false,
  className,
}: ButtonStyleOptions = {}): string {
  const s = SIZES[size];
  return cx(
    BASE,
    VARIANTS[variant],
    link ? INTERACTION[variant].link : INTERACTION[variant].button,
    square ? s.square : s.box,
    block && "w-full",
    className
  );
}

export interface ButtonProps extends ComponentProps<"button">, Omit<ButtonStyleOptions, "link" | "className"> {}

export function Button({ variant, size, block, square, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, block, square, className })} {...props} />;
}
