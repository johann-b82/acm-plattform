"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  BEREICH_LABEL,
  alsAnzeige,
  ausAnzeige,
  ladeZielwerte,
  setzeZielwert,
  zielwerteKeys,
  type Zielwert,
} from "@/lib/zielwerte";
import { Button, Card, Input, Label } from "@/components/ui/primitives";

/**
 * Zielwerte der Kennzahlen pflegen.
 *
 * Wer bis hierher kommt, darf ändern — das Tor sitzt an der Seite. Die Policy
 * an der Tabelle prüft es trotzdem noch einmal: die Oberfläche ist die
 * Bequemlichkeit, nicht der Riegel.
 */
export function Kennzahlen() {
  const queryClient = useQueryClient();
  const [entwurf, setEntwurf] = useState<Record<string, string>>({});

  const zielwerte = useQuery({
    queryKey: zielwerteKeys.alle(),
    queryFn: ladeZielwerte,
  });

  const speichern = useMutation({
    mutationFn: ({ schluessel, wert }: { schluessel: string; wert: number }) =>
      setzeZielwert(schluessel, wert),
    onSuccess: (_daten, { schluessel }) => {
      setEntwurf((v) => {
        const rest = { ...v };
        delete rest[schluessel];
        return rest;
      });
      queryClient.invalidateQueries({ queryKey: zielwerteKeys.alle() });
      toast.success("Zielwert gespeichert. Die Dashboards zeigen ihn nach dem Neuladen.");
    },
    onError: (err: Error) => toast.error(`Speichern fehlgeschlagen: ${err.message}`),
  });

  const daten = zielwerte.data;
  const nachBereich = useMemo(() => {
    const m = new Map<string, Zielwert[]>();
    for (const z of daten ?? []) {
      m.set(z.bereich, [...(m.get(z.bereich) ?? []), z]);
    }
    return [...m.entries()];
  }, [daten]);

  function anzeigewert(z: Zielwert): string {
    return entwurf[z.schluessel] ?? String(alsAnzeige(z.wert, z.einheit));
  }

  function absenden(z: Zielwert) {
    const roh = entwurf[z.schluessel];
    if (roh === undefined) return;
    const zahl = Number(roh.replace(",", "."));
    if (!Number.isFinite(zahl) || zahl < 0) {
      toast.error("Bitte eine Zahl ab 0 eingeben.");
      return;
    }
    speichern.mutate({ schluessel: z.schluessel, wert: ausAnzeige(zahl, z.einheit) });
  }

  if (zielwerte.error) {
    return (
      <Card className="p-4 text-sm text-[var(--danger)]">
        Zielwerte konnten nicht geladen werden: {(zielwerte.error as Error).message}
      </Card>
    );
  }
  if (zielwerte.isLoading) {
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>;
  }

  return (
    <div className="space-y-4">
      {nachBereich.map(([bereich, werte]) => (
        <Card key={bereich} className="p-5">
          <h3 className="font-medium">{BEREICH_LABEL[bereich] ?? bereich}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {werte.map((z) => (
              <div key={z.schluessel} className="flex flex-col gap-1">
                <Label htmlFor={z.schluessel}>{z.label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={z.schluessel}
                    inputMode="decimal"
                    value={anzeigewert(z)}
                    onChange={(e) =>
                      setEntwurf((v) => ({ ...v, [z.schluessel]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") absenden(z);
                    }}
                    className="max-w-32 text-right tabular-nums"
                  />
                  <span className="text-sm text-[var(--fg-muted)]">
                    {z.einheit === "anteil" ? "%" : "Stück"}
                  </span>
                  {entwurf[z.schluessel] !== undefined && (
                    <Button size="sm" disabled={speichern.isPending} onClick={() => absenden(z)}>
                      Speichern
                    </Button>
                  )}
                </div>
                {z.beschreibung && (
                  <p className="text-xs text-[var(--fg-muted)]">{z.beschreibung}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
