"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "./primitives";
import { Dialog } from "./dialog";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Löschknopf mit Rückfrage. Ersetzt die vier verschiedenen Löschdialoge des
 * Altprojekts durch eine Variante.
 */
export function ConfirmDeleteButton({
  itemLabel,
  onConfirm,
  disabled,
}: {
  itemLabel: string;
  onConfirm: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const worte = useTexte().allgemein;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={worte.loeschenKnopf(itemLabel)}
        title={worte.loeschenKnopf(itemLabel)}
      >
        <Trash2 className="h-4 w-4 text-[var(--danger)]" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => !busy && setOpen(o)}
        title={worte.loeschenTitel}
        description={worte.loeschenFrage(itemLabel)}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {worte.abbrechen}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {worte.loeschen}
            </Button>
          </>
        }
      />
    </>
  );
}
