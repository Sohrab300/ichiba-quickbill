import type { ComponentProps } from "react";
import { cx } from "./cx";

export interface CardStyleOptions {
  /** Hard offset shadow (default on). */
  raised?: boolean;
  /** 3px outline + bigger shadow, for the one card that matters on a page. */
  strong?: boolean;
  /** Background: white (default), cream, or the darker panel cream. */
  tone?: "surface" | "paper" | "paper-2";
  className?: string;
}

const TONES = { surface: "bg-surface", paper: "bg-paper", "paper-2": "bg-paper-2" } as const;

export function cardClasses({ raised = true, strong = false, tone = "surface", className }: CardStyleOptions = {}): string {
  return cx(
    "rounded-card border-ink text-ink",
    strong ? "border-strong" : "border",
    TONES[tone],
    raised && (strong ? "shadow-hard-lg" : "shadow-hard"),
    className
  );
}

export function Card({ raised, strong, tone, className, ...props }: ComponentProps<"div"> & CardStyleOptions) {
  return <div className={cardClasses({ raised, strong, tone, className })} {...props} />;
}
