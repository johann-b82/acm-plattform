"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  alsAnzeige,
  ladeZielwerte,
  setzeZielwert,
  zielwertAusEingabe,
  zielwerteKeys,
  type Zielwert,
} from "@/lib/zielwerte";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";
import { useBereich } from "@/lib/tafeln";

/**
 * Zielwerte der Kennzahlen pflegen.
 *
 * Wer bis hierher kommt, darf ändern — das Tor sitzt an der Seite. Die Policy
 * an der Tabelle prüft es trotzdem noch einmal: die Oberfläche ist die
 * Bequemlichkeit, nicht der Riegel.
 */
export function Kennzahlen() {
  const bereichName = useBereich();
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [entwurf, setEntwurf] = useState<Record<string, string>>({});

  const zielwerte = useQuery({
    queryKey: zielwerteKeys.alle(),
    queryFn: ladeZielwerte,
  });

  const speichern = useMutation({
    mutationFn: ({ schluessel, wert }: { schluessel: string; wert: number | null }) =>
      setzeZielwert(schluessel, wert),
    onSuccess: (_daten, { schluessel }) => {
      setEntwurf((v) => {
        const rest = { ...v };
        delete rest[schluessel];
        return rest;
      });
      queryClient.invalidateQueries({ queryKey: zielwerteKeys.alle() });
      toast.success(worte.einstellungenText.zielwertGespeichert);
    },
    onError: (err: Error) => toast.error(worte.einstellungenText.speichernFehler(err.message)),
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
    return entwurf[z.schluessel] ?? (z.wert == null ? "" : String(alsAnzeige(z.wert, z.einheit)));
  }

  function absenden(z: Zielwert) {
    const roh = entwurf[z.schluessel];
    if (roh === undefined) return;
    // Leer heißt „kein Ziel, keine Ziellinie“ — nur wo die Zeile das erlaubt.
    const wert = zielwertAusEingabe(roh, z.einheit, z.leer_erlaubt);
    if (wert === "ungueltig") {
      toast.error(worte.einstellungenText.zahlAbNull);
      return;
    }
    speichern.mutate({ schluessel: z.schluessel, wert });
  }

  if (zielwerte.error) {
    return (
      <Card className="p-4 text-sm text-[var(--danger)]">
        Zielwerte konnten nicht geladen werden: {(zielwerte.error as Error).message}
      </Card>
    );
  }
  if (zielwerte.isLoading) {
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</Card>;
  }

  return (
    <div className="space-y-4">
      {nachBereich.map(([bereich, werte]) => (
        <Card key={bereich} className="p-5">
          <h3 className="font-medium">{bereichName[bereich] ?? bereich}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {werte.map((z) => (
              <div key={z.schluessel} className="flex flex-col gap-1">
                <Label htmlFor={z.schluessel} dir="auto">
                  {z.label}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={z.schluessel}
                    inputMode="decimal"
                    value={anzeigewert(z)}
                    placeholder={z.leer_erlaubt ? "—" : undefined}
                    onChange={(e) =>
                      setEntwurf((v) => ({ ...v, [z.schluessel]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") absenden(z);
                    }}
                    className="max-w-32 text-end tabular-nums"
                  />
                  <span className="text-sm text-[var(--fg-muted)]">
                    {z.einheit === "anteil" ? "%" : worte.allgemein.stueck}
                  </span>
                  {entwurf[z.schluessel] !== undefined && (
                    <Button size="sm" disabled={speichern.isPending} onClick={() => absenden(z)}>
                      {worte.allgemein.speichern}
                    </Button>
                  )}
                </div>
                {z.beschreibung && (
                  <p className="text-xs text-[var(--fg-muted)]" dir="auto">
                    {z.beschreibung}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
