/**
 * Table styles: white card with an ink outline and hard shadow, ink header row with cream
 * labels, cream stripes. Use on plain <table> markup.
 */
export const tableStyles = {
  /** Scroll container + card frame around the <table>. */
  wrap: "overflow-x-auto rounded-card border border-ink bg-surface shadow-hard",
  table: "w-full text-sm",
  thead: "bg-ink text-left text-xs font-bold tracking-wide text-paper uppercase",
  th: "px-3 py-2.5",
  tbody: "divide-y divide-ink/15",
  /** Striped row; add `hover` for rows that are links. */
  tr: "even:bg-paper-2/50",
  trHover: "hover:bg-brand-soft",
  td: "px-3 py-2.5",
  tfoot: "border-t border-ink bg-paper-2 font-bold",
} as const;
