"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus } from "lucide-react";

import {
  HR_LABEL,
  alsFreitext,
  ausFreitext,
  hrEinstellungKeys,
  ladeAuswahllisten,
  ladeHrEinstellungen,
  setzeHrEinstellung,
  vorschlaege,
  type HrEinstellung,
} from "@/lib/hr-einstellungen";
import { Badge, Button, Card, Input, Label } from "@/components/ui/primitives";

/**
 * Listen statt Zahlen — deshalb ein eigener Abschnitt und nicht noch eine
 * Zeile im Zielwerte-Raster. Ohne die Krankheitsarten bleibt die
 * Krankheitsquote im Personal-Dashboard leer; das ist absichtlich sichtbar
 * und nicht still null.
 *
 * Die Werte lassen sich aus einer Vorschlagsliste anklicken statt abtippen.
 * Das Altprojekt schreibt dort „568234, 3270500" ins Textfeld — eine Zahl, die
 * jemand aus Personio abschreiben muss und die niemand nachträglich einer
 * Abwesenheitsart zuordnen kann. Das Freitextfeld bleibt trotzdem: Personio
 * kann gerade nicht erreichbar sein, und dann muss die Maske bedienbar
 * bleiben.
 */
export function Personal() {
  const queryClient = useQueryClient();
  const [entwurf, setEntwurf] = useState<Record<string, string>>({});

  const einstellungen = useQuery({
    queryKey: hrEinstellungKeys.alle(),
    queryFn: ladeHrEinstellungen,
  });
  const listen = useQuery({
    queryKey: hrEinstellungKeys.listen(),
    queryFn: ladeAuswahllisten,
    // Personio bremst bei Massenabrufen; die Listen ändern sich selten.
    staleTime: 10 * 60_000,
    retry: false,
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

  function sichern(schluessel: string, text: string) {
    speichern.mutate({ schluessel, werte: ausFreitext(text) });
  }

  /** Einen Vorschlag an- oder abwählen — der Text bleibt die Wahrheit. */
  function umschalten(e: HrEinstellung, kandidat: string) {
    const aktuell = ausFreitext(wert(e));
    const neu = aktuell.includes(kandidat)
      ? aktuell.filter((w) => w !== kandidat)
      : [...aktuell, kandidat];
    setEntwurf((v) => ({ ...v, [e.schluessel]: alsFreitext(neu) }));
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <p className="text-sm text-[var(--fg-muted)]">
          Anklicken oder mit Komma getrennt eintippen.
        </p>
        {listen.data?.hinweis && (
          <p className="mt-2 text-sm text-[var(--warn)]">{listen.data.hinweis}</p>
        )}
        {listen.error && (
          <p className="mt-2 text-sm text-[var(--warn)]">
            Die Vorschläge konnten nicht geladen werden ({(listen.error as Error).message}). Die
            Werte lassen sich weiterhin eintippen.
          </p>
        )}

        <div className="mt-4 space-y-6">
          {einstellungen.data.map((e) => {
            const offen = entwurf[e.schluessel] !== undefined;
            const gewaehlt = ausFreitext(wert(e));
            const liste = vorschlaege(e.schluessel, listen.data);
            return (
              <div key={e.schluessel} className="flex flex-col gap-1">
                <Label htmlFor={e.schluessel}>{HR_LABEL[e.schluessel] ?? e.schluessel}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={e.schluessel}
                    value={wert(e)}
                    placeholder={
                      e.schluessel === "krank_typ_ids" ? "568234, 3270500" : "Fertigung, Montage"
                    }
                    onChange={(ev) =>
                      setEntwurf((v) => ({ ...v, [e.schluessel]: ev.target.value }))
                    }
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" && offen) sichern(e.schluessel, wert(e));
                    }}
                    className="max-w-md"
                  />
                  {offen && (
                    <Button
                      size="sm"
                      disabled={speichern.isPending}
                      onClick={() => sichern(e.schluessel, wert(e))}
                    >
                      Speichern
                    </Button>
                  )}
                </div>
                <p className="text-xs text-[var(--fg-muted)]">{e.beschreibung}</p>

                {liste.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {liste.map((v) => {
                      const an = gewaehlt.includes(v.wert);
                      return (
                        <button
                          key={v.wert}
                          type="button"
                          onClick={() => umschalten(e, v.wert)}
                          className={
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 " +
                            "text-xs transition-colors focus-visible:outline-2 " +
                            "focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] " +
                            (an
                              ? "border-[var(--ring)] bg-[var(--ring)] text-white"
                              : "border-[var(--border)] hover:bg-[var(--muted)]")
                          }
                          aria-pressed={an}
                        >
                          {an ? (
                            <Check className="h-3 w-3" aria-hidden />
                          ) : (
                            <Plus className="h-3 w-3" aria-hidden />
                          )}
                          {v.label}
                        </button>
                      );
                    })}
                    {listen.data?.arten_aus_bestand && e.schluessel === "krank_typ_ids" && (
                      <Badge variant="outline" className="text-xs">
                        aus dem Bestand
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
