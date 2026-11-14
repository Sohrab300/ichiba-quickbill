import { Fragment } from "react";

/**
 * ₹ amounts and values with a unit (80 mm, 18%, 4 qty) — not bare digit runs, so codes such as
 * barcodes or "CL1" inside the same text keep the body font's slashed zero.
 */
const AMOUNT_OR_QUANTITY = /(₹\s?[\d,]+(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:mm|%|qty)\b|\b\d[\d,]*(?:\.\d+)?%)/g;

/**
 * Renders a plain string with its amounts/quantities in the `num` face (plain 0, tabular).
 * For text built in code (scan messages, option labels); markup should use `num` directly.
 */
export function PlainNumbers({ text }: { text: string }) {
  const parts = text.split(AMOUNT_OR_QUANTITY);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="num">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}
