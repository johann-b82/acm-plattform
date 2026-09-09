"use client";

import { cn } from "@/lib/cn";
import type { ComponentProps, ReactNode } from "react";

/**
 * Kleine, abhängigkeitsfreie Bedienelemente (Tailwind + native Elemente).
 * Bewusst kein Radix/shadcn-Paket: das Altprojekt hing an `@base-ui/react` und
 * `shadcn/tailwind.css`; hier reichen native `<dialog>`, `<select>` und
 * `<input type=checkbox>`. Farbtokens kommen aus globals.css.
 */

// --- Button ---------------------------------------------------------------

type ButtonVariant = "default" | "outline" | "ghost" | "destructive";
type ButtonSize = "default" | "sm" | "icon";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] " +
  "disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: "bg-[var(--fg)] text-[var(--bg)] hover:opacity-90",
  outline: "border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--muted)]",
  ghost: "hover:bg-[var(--muted)]",
  destructive: "bg-[var(--danger)] text-white hover:opacity-90",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: "h-9 px-4",
  sm: "h-8 px-3 text-xs",
  icon: "h-8 w-8",
};

export function Button({
  variant = "default",
  size = "default",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type="button"
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

// --- Formularelemente -----------------------------------------------------

const FIELD =
  "h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm " +
  "placeholder:text-[var(--fg-muted)] focus-visible:outline-2 focus-visible:outline-offset-0 " +
  "focus-visible:outline-[var(--ring)] disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(FIELD, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(FIELD, "h-auto min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(FIELD, "pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}

/** Schalter auf Basis einer Checkbox — role="switch" für Screenreader. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "relative h-5 w-9 rounded-full border border-[var(--border)] transition-colors",
          checked ? "bg-[var(--fg)]" : "bg-[var(--muted)]",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ring)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-[var(--surface)] transition-all",
            checked ? "left-[1.15rem]" : "left-0.5",
          )}
        />
      </span>
    </label>
  );
}

// --- Anzeige --------------------------------------------------------------

export function Badge({
  className,
  variant = "default",
  ...props
}: ComponentProps<"span"> & { variant?: "default" | "outline" | "secondary" }) {
  const variants = {
    default: "bg-[var(--fg)] text-[var(--bg)]",
    outline: "border border-[var(--border)]",
    secondary: "bg-[var(--muted)] text-[var(--fg)]",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-lg border border-[var(--border)] bg-[var(--surface)]", className)}
      {...props}
    />
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Card className="p-10 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--fg-muted)]">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  );
}

// --- Tabelle --------------------------------------------------------------

export function TableWrap({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]",
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("w-full text-sm", className)} {...props} />;
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-left font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return (
    <td className={cn("border-b border-[var(--border)] px-3 py-2 align-middle", className)} {...props} />
  );
}
