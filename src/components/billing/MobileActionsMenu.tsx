"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";

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
        className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-zinc-300 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        <MoreVertical className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          className="absolute right-0 bottom-full z-30 mb-2 w-64 overflow-hidden rounded-xl border-2 border-zinc-300 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
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
                className={`flex h-12 w-full items-center gap-3 px-4 text-left text-base font-semibold disabled:opacity-40 ${
                  a.destructive
                    ? "text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                    : "text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                }`}
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
