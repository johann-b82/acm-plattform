"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Modal auf Basis des nativen `<dialog>`-Elements: Fokusfalle, Escape und
 * Backdrop kommen vom Browser, kein Portal-Paket nötig.
 * `onOpenChange(false)` wird bei Escape und Klick auf den Backdrop gerufen.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onOpenChange(false);
      }}
      onClick={(e) => {
        // Klick außerhalb des Inhalts (auf das dialog-Element selbst) schließt.
        if (e.target === ref.current) onOpenChange(false);
      }}
      className={cn(
        "m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)]",
        "bg-[var(--surface)] p-0 text-[var(--fg)] shadow-lg backdrop:bg-black/40",
        className,
      )}
      aria-label={title}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-[var(--fg-muted)]">{description}</p>
            )}
          </div>
          {children}
          {footer && <div className="flex justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
