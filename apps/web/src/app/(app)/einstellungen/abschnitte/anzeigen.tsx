"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, MonitorPlay } from "lucide-react";

import { computeJson } from "@/lib/compute";
import type { Anzeigenart, NeuerToken } from "@/lib/anzeige";
import { Button, Card, Input, Label, Select } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

const ANZEIGEN: { art: Anzeigenart; pfad: string }[] = [
  { art: "geburtstage", pfad: "/embed/geburtstage" },
  { art: "neuzugaenge", pfad: "/embed/neuzugaenge" },
];

/**
 * Die Adressen für die Bildschirme.
 *
 * Im Altprojekt waren das schlicht offene Routen: wer die Adresse kannte, las
 * die Namen der Belegschaft, und über die laufende Nummer ließ sich die ganze
 * Liste durchzählen. Hier trägt jede Tafel einen unterschriebenen Token, der
 * genau eine Anzeige freigibt und abläuft.
 *
 * Der Token wird nicht gespeichert — er trägt sich selbst. Deshalb lässt er
 * sich auch nicht nachträglich anzeigen: hier steht er einmal zum Kopieren.
 * Verloren heißt neu erzeugen. Alle auf einmal sperrt, wer `EMBED_SECRET` in
 * der Umgebung wechselt.
 */
export function Anzeigen() {
  const worte = useTexte();
  const [art, setArt] = useState<Anzeigenart>("geburtstage");
  const [tage, setTage] = useState(365);
  const [ergebnis, setErgebnis] = useState<{ art: Anzeigenart; adresse: string; bis: string } | null>(
    null,
  );

  const erzeugen = useMutation({
    mutationFn: () =>
      computeJson<NeuerToken>(`/api/anzeige/token?art=${art}&tage=${tage}`, { method: "POST" }),
    onSuccess: (neu) => {
      const pfad = ANZEIGEN.find((a) => a.art === art)!.pfad;
      setErgebnis({
        art,
        adresse: `${window.location.origin}${pfad}?token=${encodeURIComponent(neu.token)}`,
        bis: neu.gueltig_bis,
      });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <Card className="space-y-3 p-5">
      <h3 className="flex items-center gap-1.5 font-medium">
        <MonitorPlay className="h-4 w-4" aria-hidden />
        Adressen für die Bildschirme
      </h3>
      <p className="max-w-prose text-sm text-[var(--fg-muted)]">
        {worte.einstellungenText.anzeigenHinweis}
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="anzeige-art">{worte.einstellungenText.anzeige}</Label>
          <Select
            id="anzeige-art"
            value={art}
            onChange={(e) => {
              setArt(e.target.value as Anzeigenart);
              setErgebnis(null);
            }}
          >
            {ANZEIGEN.map((a) => (
              <option key={a.art} value={a.art}>
                {worte.einstellungenText[a.art]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="anzeige-tage">{worte.einstellungenText.gueltigTage}</Label>
          <Input
            id="anzeige-tage"
            type="number"
            min={1}
            max={3650}
            value={tage}
            className="w-28"
            onChange={(e) => setTage(Number(e.target.value))}
          />
        </div>
        <Button onClick={() => erzeugen.mutate()} disabled={erzeugen.isPending}>
          {erzeugen.isPending ? worte.einstellungenText.erzeugt : worte.einstellungenText.adresseErzeugen}
        </Button>
      </div>

      {ergebnis && (
        <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--muted)] p-3">
          <p className="text-sm text-[var(--fg-muted)]">
            Gültig bis {DATUM.format(new Date(ergebnis.bis))}. Jetzt kopieren —
            die Adresse lässt sich später nicht noch einmal anzeigen.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-[var(--surface)] px-2 py-1.5 text-xs">
              {ergebnis.adresse}
            </code>
            <Button
              variant="ghost"
              onClick={() =>
                navigator.clipboard
                  .writeText(ergebnis.adresse)
                  .then(() => toast.success(worte.einstellungenText.adresseKopiert))
                  .catch(() => toast.error(worte.einstellungenText.kopierenFehler))
              }
            >
              <Copy className="me-1.5 h-4 w-4" aria-hidden />
              Kopieren
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
