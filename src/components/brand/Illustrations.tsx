import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * Original line illustrations in the Sekai Ichiba style (docs/ichiba-brand.png): ink strokes,
 * red fills, white bodies. Decorative only — always aria-hidden. Use sparingly (login
 * background, empty cart).
 */
export interface IllustrationProps {
  className?: string;
}

function Svg({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={cx("stroke-ink", className)}
    >
      {children}
    </svg>
  );
}

/** Market basket with an arched handle, a red rim and an apple peeking out. */
export function Basket({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <path d="M17 29C17 13 47 13 47 29" />
      <circle cx="40" cy="23" r="6.5" className="fill-brand-bright" />
      <path d="M40 16.5c0-2 1-3.5 2.5-4.5" />
      <rect x="7" y="27" width="50" height="8" rx="4" className="fill-brand-bright" />
      <path d="M11.5 35 15.6 53a3.5 3.5 0 0 0 3.4 2.7h26a3.5 3.5 0 0 0 3.4-2.7L52.5 35Z" className="fill-surface" />
      <path d="M14 45h36M24 36l1.5 19M32 36v19.5M40 36l-1.5 19" />
    </Svg>
  );
}

/** Red bowl with a wave band, a naruto slice, a sheet of nori and steam. */
export function NoodleBowl({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <path d="M29 17c-3-3 3-5 0-8M37 17c-3-3 3-5 0-8" />
      <rect x="39" y="17" width="9" height="16" rx="1.5" transform="rotate(12 43.5 25)" className="fill-ink" />
      <circle cx="23" cy="29" r="6" className="fill-surface" />
      <path d="M21 29a2 2 0 1 1 2 2" className="stroke-brand-bright" strokeWidth={2.5} />
      <path d="M24 54.5 26 59h12l2-4.5" className="fill-surface" />
      <path d="M7 33h50c0 12.5-10.5 21.5-25 21.5S7 45.5 7 33Z" className="fill-brand-bright" />
      <path d="M13 40.5q3.3-3 6.6 0t6.6 0 6.6 0 6.6 0 6.6 0 4 0" className="stroke-surface" strokeWidth={2.5} />
    </Svg>
  );
}

/** Bubble tea with a dome lid, red band and red pearls. */
export function BubbleTea({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <path d="M38 3 33.5 17" strokeWidth={4} />
      <path d="M17.5 30 21.4 56a3 3 0 0 0 3 2.5h15.2a3 3 0 0 0 3-2.5L46.5 30Z" className="fill-surface" />
      <path d="M20 38q2.7-2 5.3 0t5.3 0 5.3 0 5.3 0 2.8 0" />
      <path d="M19 23c0-8.5 5.8-12 13-12s13 3.5 13 12Z" className="fill-surface" />
      <rect x="14" y="23" width="36" height="7" rx="3.5" className="fill-brand-bright" />
      <g className="fill-brand-bright" strokeWidth={2}>
        <circle cx="26.5" cy="51" r="2.6" />
        <circle cx="32" cy="53" r="2.6" />
        <circle cx="37.5" cy="51" r="2.6" />
        <circle cx="29.2" cy="46" r="2.6" />
        <circle cx="34.8" cy="46" r="2.6" />
      </g>
    </Svg>
  );
}

/** A pair of chopsticks with red tips, resting on a red chopstick rest. */
export function Chopsticks({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <rect x="20" y="41" width="24" height="10" rx="5" className="fill-brand-bright" />
      <path d="M26 46h12" className="stroke-surface" strokeWidth={2.5} />
      <path d="M5 46.5 57 24.5l1.6 3.6-52 22.4Z" className="fill-surface" strokeWidth={2.5} />
      <path d="M48 28.3 57 24.5l1.6 3.6-9 3.9Z" className="fill-brand-bright" strokeWidth={2.5} />
      <path d="M8 55.5 59.5 33l1.6 3.6L9.6 59.2Z" className="fill-surface" strokeWidth={2.5} />
      <path d="M50.5 37 59.5 33l1.6 3.6-9 4Z" className="fill-brand-bright" strokeWidth={2.5} />
    </Svg>
  );
}

/** Rice sack tied with red string, with a red label of rice grains. */
export function RiceBag({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <path d="M22 14 24.5 8l3.8 4 3.7-5 3.7 5 3.8-4 2.5 6" />
      <path d="M21 24 23.5 14h17L43 24" className="fill-surface" />
      <path d="M17 24c-4.5 10-4.5 24 0 34h30c4.5-10 4.5-24 0-34Z" className="fill-surface" />
      <path d="M20 22.5h24" className="stroke-brand-bright" strokeWidth={4} />
      <rect x="21" y="33" width="22" height="17" rx="3" className="fill-brand-bright" />
      <g className="fill-surface" strokeWidth={1.5}>
        <ellipse cx="27.5" cy="42" rx="2" ry="3.4" transform="rotate(-25 27.5 42)" />
        <ellipse cx="32" cy="40.5" rx="2" ry="3.4" />
        <ellipse cx="36.5" cy="42" rx="2" ry="3.4" transform="rotate(25 36.5 42)" />
      </g>
    </Svg>
  );
}

/** Onigiri: rice triangle, nori wrap and a red umeboshi. */
export function Onigiri({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <path
        d="M32 7c4.5 0 22 30 22 37.5C54 52.5 45 57 32 57S10 52.5 10 44.5C10 37 27.5 7 32 7Z"
        className="fill-surface"
      />
      <path d="M23 40h18v16.6c-2.8.3-5.8.4-9 .4s-6.2-.1-9-.4Z" className="fill-ink" />
      <circle cx="32" cy="27" r="4.8" className="fill-brand-bright" />
      <path d="M17 37.5l1.5-1M44 30l1.5 1" strokeWidth={2.5} />
    </Svg>
  );
}
