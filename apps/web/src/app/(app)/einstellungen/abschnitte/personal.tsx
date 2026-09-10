"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { NurLesend } from "../nur-lesend";

/**
 * Listen statt Zahlen — deshalb ein eigener Abschnitt und nicht noch eine
 * Zeile im Zielwerte-Raster. Ohne die Krankheitsarten bleibt die
 * Krankheitsquote im Personal-Dashboard leer; das ist absichtlich sichtbar
 * und nicht still null.
 */
export function Personal({ darfAendern }: { darfAendern: boolean }) {
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
    <div className="space-y-4">
      {!darfAendern && <NurLesend recht="Einstellungen bearbeiten" />}
      <Card className="p-5">
        <p className="text-sm text-[var(--fg-muted)]">Mehrere Angaben mit Komma trennen.</p>
        <div className="mt-4 space-y-4">
          {einstellungen.data.map((e) => (
            <div key={e.schluessel} className="flex flex-col gap-1">
              <Label htmlFor={e.schluessel}>{HR_LABEL[e.schluessel] ?? e.schluessel}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={e.schluessel}
                  value={wert(e)}
                  disabled={!darfAendern}
                  placeholder={
                    e.schluessel === "krank_typ_ids" ? "568234, 3270500" : "Fertigung, Montage"
                  }
                  onChange={(ev) => setEntwurf((v) => ({ ...v, [e.schluessel]: ev.target.value }))}
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
    </div>
  );
}
