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
import {
  HR_LABEL,
  alsFreitext,
  ausFreitext,
  hrEinstellungKeys,
  ladeHrEinstellungen,
  setzeHrEinstellung,
  type HrEinstellung,
} from "@/lib/hr-einstellungen";
import { Button, Card, Input, Label } from "@/components/ui/primitives";

/**
 * Zielwerte der Kennzahlen pflegen.
 *
 * Ändern darf, wer die Einstellungen bearbeiten darf. Das entscheidet die
 * Policy an der Tabelle; die Oberfläche blendet nur aus, was die Datenbank
 * ohnehin abweist.
 */
export function Einstellungen({ darfAendern }: { darfAendern: boolean }) {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Zielwerte der Kennzahlen. Sie erscheinen als Ziellinie im Verlauf und entscheiden, ab
          wann eine Kachel warnt.
        </p>
      </div>

      {zielwerte.error && (
        <Card className="p-4 text-sm text-[var(--danger)]">
          Zielwerte konnten nicht geladen werden: {(zielwerte.error as Error).message}
        </Card>
      )}

      {!darfAendern && (
        <Card className="p-4 text-sm text-[var(--fg-muted)]">
          Du kannst die Zielwerte ansehen, aber nicht ändern. Dafür braucht es das Recht{" "}
          {"„Bearbeiten“"} auf den Einstellungen.
        </Card>
      )}

      {zielwerte.isLoading && (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      )}

      <HrAbschnitt darfAendern={darfAendern} />

      {nachBereich.map(([bereich, werte]) => (
        <Card key={bereich} className="p-5">
          <h2 className="font-medium">{BEREICH_LABEL[bereich] ?? bereich}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {werte.map((z) => (
              <div key={z.schluessel} className="flex flex-col gap-1">
                <Label htmlFor={z.schluessel}>{z.label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={z.schluessel}
                    inputMode="decimal"
                    value={anzeigewert(z)}
                    disabled={!darfAendern}
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


/**
 * Listen statt Zahlen — deshalb ein eigener Abschnitt und nicht noch eine
 * Zeile im Zielwerte-Raster. Ohne die Krankheitsarten bleibt die
 * Krankheitsquote im Personal-Dashboard leer; das ist absichtlich sichtbar
 * und nicht still null.
 */
function HrAbschnitt({ darfAendern }: { darfAendern: boolean }) {
  const queryClient = useQueryClient();
  const [entwurf, setEntwurf] = useState<Record<string, string>>({});

  const einstellungen = useQuery({
    queryKey: hrEinstellungKeys.alle(),
    queryFn: ladeHrEinstellungen,
  });

  const speichern = useMutation({
    mutationFn: ({ schluessel, werte }: { schluessel: string; werte: string[] }) =>
      setzeHrEinstellung(schluessel, werte),
    onSuccess: (_d, { schluessel }) => {
      setEntwurf((v) => {
        const rest = { ...v };
        delete rest[schluessel];
        return rest;
      });
      queryClient.invalidateQueries({ queryKey: hrEinstellungKeys.alle() });
      toast.success("Gespeichert. Das Personal-Dashboard zeigt es nach dem Neuladen.");
    },
    onError: (err: Error) => toast.error(`Speichern fehlgeschlagen: ${err.message}`),
  });

  if (einstellungen.error) {
    return (
      <Card className="p-4 text-sm text-[var(--danger)]">
        Personal-Einstellungen konnten nicht geladen werden:{" "}
        {(einstellungen.error as Error).message}
      </Card>
    );
  }
  if (!einstellungen.data?.length) return null;

  function wert(e: HrEinstellung): string {
    return entwurf[e.schluessel] ?? alsFreitext(e.werte);
  }

  return (
    <Card className="p-5">
      <h2 className="font-medium">Personal</h2>
      <p className="mt-1 text-sm text-[var(--fg-muted)]">
        Mehrere Angaben mit Komma trennen.
      </p>
      <div className="mt-4 space-y-4">
        {einstellungen.data.map((e) => (
          <div key={e.schluessel} className="flex flex-col gap-1">
            <Label htmlFor={e.schluessel}>{HR_LABEL[e.schluessel] ?? e.schluessel}</Label>
            <div className="flex items-center gap-2">
              <Input
                id={e.schluessel}
                value={wert(e)}
                disabled={!darfAendern}
                placeholder={e.schluessel === "krank_typ_ids" ? "568234, 3270500" : "Fertigung, Montage"}
                onChange={(ev) =>
                  setEntwurf((v) => ({ ...v, [e.schluessel]: ev.target.value }))
                }
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" && entwurf[e.schluessel] !== undefined) {
                    speichern.mutate({
                      schluessel: e.schluessel,
                      werte: ausFreitext(entwurf[e.schluessel]),
                    });
                  }
                }}
                className="max-w-md"
              />
              {entwurf[e.schluessel] !== undefined && (
                <Button
                  size="sm"
                  disabled={speichern.isPending}
                  onClick={() =>
                    speichern.mutate({
                      schluessel: e.schluessel,
                      werte: ausFreitext(entwurf[e.schluessel]),
                    })
                  }
                >
                  Speichern
                </Button>
              )}
            </div>
            <p className="text-xs text-[var(--fg-muted)]">{e.beschreibung}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
