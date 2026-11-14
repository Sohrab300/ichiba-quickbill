"use client";

import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Dialog";

// The dialog shell lives in components/ui/Dialog; re-exported for the billing components.
export { Modal };

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Destructive confirmation. Cancel has focus, so a stray Enter from a scanner is harmless. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <div className="space-y-5">
        <div className="text-base leading-relaxed text-ink">{children}</div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" autoFocus onClick={onCancel} className="px-5">
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} className="px-5">
            <Trash2 className="h-5 w-5" aria-hidden />
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
