import type { AriaRole, ReactNode } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { cx } from "./cx";

export type AlertTone = "success" | "warning" | "danger" | "info";

/**
 * Status colours stay apart from brand red and never carry meaning alone (section 15): every
 * tone has its own icon in an outlined chip, and the text is always ink on a pale tint.
 */
export const ALERT_TONES: Record<AlertTone, { box: string; chip: string; icon: string; Icon: LucideIcon }> = {
  success: { box: "bg-success-soft", chip: "bg-success text-surface", icon: "text-success", Icon: CheckCircle2 },
  warning: { box: "bg-warning-soft", chip: "bg-warning text-ink", icon: "text-ink", Icon: AlertTriangle },
  danger: { box: "bg-danger-soft", chip: "bg-danger text-surface", icon: "text-danger", Icon: AlertOctagon },
  info: { box: "bg-surface", chip: "bg-ink text-paper", icon: "text-ink", Icon: Info },
};

/** Round outlined icon chip in the tone's colour. */
export function AlertIcon({ tone, icon, size = "md" }: { tone: AlertTone; icon?: ReactNode; size?: "sm" | "md" }) {
  const { chip, Icon } = ALERT_TONES[tone];
  return (
    <span
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full border border-ink",
        chip,
        size === "sm" ? "h-7 w-7 [&_svg]:h-4 [&_svg]:w-4" : "h-9 w-9 [&_svg]:h-5 [&_svg]:w-5"
      )}
    >
      {icon ?? <Icon />}
    </span>
  );
}

interface AlertProps {
  tone: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Replaces the tone's default icon (e.g. a spinner). */
  icon?: ReactNode;
  /** Top-right control, e.g. a dismiss button. */
  action?: ReactNode;
  /** Full-width content under the message, e.g. buttons. */
  footer?: ReactNode;
  size?: "sm" | "md";
  /** Small hard shadow (status panels). */
  raised?: boolean;
  role?: AriaRole;
  className?: string;
}

export function Alert({ tone, title, children, icon, action, footer, size = "md", raised = false, role, className }: AlertProps) {
  return (
    <div
      role={role}
      className={cx(
        "rounded-card border border-ink text-ink",
        ALERT_TONES[tone].box,
        size === "sm" ? "p-2.5 text-sm" : "p-3 text-sm",
        raised && "shadow-hard-sm",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <AlertIcon tone={tone} icon={icon} size={size} />
        <div className={cx("min-w-0 flex-1", size === "sm" ? "pt-0.5" : "pt-1")}>
          {title && <p className={cx("font-bold leading-snug", size === "sm" ? "text-sm" : "text-base")}>{title}</p>}
          {children}
        </div>
        {action}
      </div>
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

/** One-line message without a box (form errors under a button): tone icon + ink text. */
export function InlineAlert({
  tone,
  children,
  role,
  className,
}: {
  tone: AlertTone;
  children: ReactNode;
  role?: AriaRole;
  className?: string;
}) {
  const { icon, Icon } = ALERT_TONES[tone];
  return (
    <p role={role} className={cx("flex items-start gap-1.5 text-sm font-semibold text-ink", className)}>
      <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", icon)} aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
