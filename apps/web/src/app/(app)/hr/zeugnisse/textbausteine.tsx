"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  DIMENSIONEN,
  NOTEN,
  bausteinSchluessel,
  geaenderteBausteine,
  zeugnisApi,
  zeugnisKeys,
} from "@/lib/zeugnisse";
import { Button } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";

const NOTEN_TEXT = (worte: ReturnType<typeof useTexte>): Record<number, string> => ({
  1: worte.zeugnisse.note1,
  2: worte.zeugnisse.note2,
  3: worte.zeugnisse.note3,
  4: worte.zeugnisse.note4,
});

const DIM_TEXT = (worte: ReturnType<typeof useTexte>): Record<string, string> => ({
  fachwissen: worte.zeugnis.fachwissen,
  auffassungsgabe: worte.zeugnis.auffassungsgabe,
  arbeitsweise: worte.zeugnis.arbeitsweise,
  belastbarkeit: worte.zeugnis.belastbarkeit,
  arbeitserfolg: worte.zeugnis.arbeitserfolg,
  sozialverhalten: worte.zeugnis.sozialverhalten,
  fuehrung: worte.zeugnis.fuehrung,
});

/**
 * Pflege der Textbausteine je Bewertungsbereich und Note (ZEU-02).
 *
 * Für jede Dimension und jede Schulnote (1–4) eine Formulierung. Gespeichert
 * werden nur geänderte, nicht leere Bausteine — bestehende Formulierungen
 * bleiben unangetastet. Der Platzhalter `[NAME]` und die Pronomen-Platzhalter
 * werden beim Erzeugen des Zeugnisses ersetzt.
 */
export function Textbausteine() {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const notenText = NOTEN_TEXT(worte);
  const dimText = DIM_TEXT(worte);
  const bausteine = useQuery({ queryKey: zeugnisKeys.bausteine(), queryFn: zeugnisApi.bausteine });

  // Den Entwurf aus dem Bestand füllen, sobald er sich ändert — als
  // Zustandsvergleich beim Rendern, nicht als Effekt (sonst ein zusätzlicher
  // Renderdurchlauf und ein Lint-Verstoß).
  const [entwurf, setEntwurf] = useState<Record<string, string>>({});
  const [geladen, setGeladen] = useState(bausteine.data);
  if (geladen !== bausteine.data) {
    setGeladen(bausteine.data);
    const m: Record<string, string> = {};
    for (const b of bausteine.data ?? []) m[bausteinSchluessel(b.dimension, b.note)] = b.text;
    setEntwurf(m);
  }

  const geaendert = useMemo(
    () => geaenderteBausteine(bausteine.data ?? [], entwurf),
    [bausteine.data, entwurf],
  );

  const speichern = useMutation({
    mutationFn: () => zeugnisApi.bausteineSetzen(geaendert),
    onSuccess: () => {
      toast.success(worte.zeugnisse.gespeichert);
      return queryClient.invalidateQueries({ queryKey: zeugnisKeys.bausteine() });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <div className="space-y-4 p-4">
      <p className="max-w-prose text-sm text-[var(--fg-muted)]">{worte.zeugnisse.bausteineHinweis}</p>
      {DIMENSIONEN.map((dim) => (
        <div key={dim.wert} className="rounded-md border border-[var(--border)] p-3">
          <h4 className="mb-2 text-sm font-semibold">{dimText[dim.wert]}</h4>
          <div className="grid gap-2 lg:grid-cols-2">
            {NOTEN.map((n) => {
              const schluessel = bausteinSchluessel(dim.wert, n.wert);
              return (
                <label key={n.wert} className="block text-sm">
                  <span className="text-[var(--fg-muted)]">
                    {n.wert} – {notenText[n.wert]}
                  </span>
                  <textarea
                    rows={3}
                    value={entwurf[schluessel] ?? ""}
                    aria-label={`${dimText[dim.wert]} — ${n.wert}`}
                    onChange={(e) => setEntwurf((m) => ({ ...m, [schluessel]: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
                  />
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <Button disabled={geaendert.length === 0 || speichern.isPending} onClick={() => speichern.mutate()}>
        {speichern.isPending ? worte.einstellungenText.speichert : worte.zeugnisse.speichern}
      </Button>
    </div>
  );
}
