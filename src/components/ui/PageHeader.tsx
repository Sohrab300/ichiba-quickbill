import type { ReactNode } from "react";

/** Page title in the display face, with an optional icon sticker, description and actions. */
export function PageHeader({
  title,
  icon,
  description,
  actions,
}: {
  title: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-3 font-display text-3xl leading-none font-extrabold sm:text-4xl">
          {icon && (
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-ink bg-brand text-paper shadow-hard-sm [&_svg]:h-6 [&_svg]:w-6"
            >
              {icon}
            </span>
          )}
          <span className="pt-1">{title}</span>
        </h1>
        {description && <p className="mt-1.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
