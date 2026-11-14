"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

export interface MobileAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/**
 * Phones: the left pane's bottom-bar actions (Clear Cart, Print Previous Invoice) behind one
 * button in the sticky checkout bar (REQUIREMENTS.md section 12). Opens upwards.
 */
export function MobileActionsMenu({ actions }: { actions: MobileAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={buttonClasses({ variant: "secondary", size: "md", square: true })}
      >
        <MoreVertical className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          className="absolute right-0 bottom-full z-30 mb-2 w-64 divide-y divide-ink/15 overflow-hidden rounded-card border border-ink bg-surface shadow-hard"
        >
          {actions.map((a) => (
            <li key={a.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={a.disabled}
                onClick={() => {
                  setOpen(false);
                  a.onSelect();
                }}
                className={cx(
                  "flex h-12 w-full items-center gap-3 px-4 text-left text-base font-bold disabled:cursor-not-allowed disabled:text-ink-muted disabled:opacity-60",
                  a.destructive ? "text-danger enabled:hover:bg-danger-soft" : "text-ink enabled:hover:bg-paper-2"
                )}
              >
                {a.icon}
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
