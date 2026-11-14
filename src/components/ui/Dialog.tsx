"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { cx } from "./cx";

/** The dialog box itself: cream, 3px ink outline, big hard shadow. */
export const dialogPanelClasses = "rounded-card border-strong border-ink bg-paper text-ink shadow-hard-lg";

/** Title bar shared by every dialog: display-font title + Close. */
export function DialogHeader({
  title,
  icon,
  onClose,
  as: Heading = "h2",
  closeDisabled,
}: {
  title: ReactNode;
  /** Optional icon shown in a red sticker chip before the title. */
  icon?: ReactNode;
  onClose: () => void;
  as?: "h2" | "h3";
  closeDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink bg-surface px-5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && (
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-ink bg-brand text-paper [&_svg]:h-5 [&_svg]:w-5"
          >
            {icon}
          </span>
        )}
        <Heading className="font-display text-2xl leading-tight font-bold">{title}</Heading>
      </div>
      <Button variant="ghost" size="sm" square onClick={onClose} aria-label="Close" disabled={closeDisabled}>
        <X className="h-5 w-5" />
      </Button>
    </div>
  );
}

/** Backdrop for dialogs that are plain fixed overlays (not a native <dialog>). */
export function DialogOverlay({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4", className)}>{children}</div>;
}

interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Tailwind max-width class. */
  size?: string;
}

/**
 * Native <dialog> shown with showModal(): focus is trapped inside and Esc closes it, so a
 * barcode scanner's keystrokes never reach the billing screen behind it.
 */
export function Modal({ open, title, onClose, children, size = "max-w-md" }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, outside its content box).
        if (e.target === e.currentTarget) onClose();
      }}
      className={cx("m-auto w-[calc(100%-2rem)] overflow-hidden p-0 backdrop:bg-ink/60", size, dialogPanelClasses)}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <DialogHeader title={title} onClose={onClose} />
          <div className="overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
