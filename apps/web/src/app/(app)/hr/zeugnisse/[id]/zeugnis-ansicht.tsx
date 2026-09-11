"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, FileText, PenLine, Sparkles, Wrench } from "lucide-react";

import {
  ABSCHNITTE,
  ARTEN,
  DIMENSIONEN,
  NOTEN,
  QUELLE_LABEL,
  zeugnisApi,
  zeugnisKeys,
  zufriedenheit,
  type Unterschrift,
  type Zeugnis,
} from "@/lib/zeugnisse";
import {
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  Switch,
  Textarea,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";

const STAMM: { feld: keyof Zeugnis; label: string; art?: "date" }[] = [
  { feld: "name", label: "Name" },
  { feld: "personalnummer", label: "Personalnummer" },
  { feld: "abteilung", label: "Abteilung" },
  { feld: "taetigkeit", label: "Tätigkeit" },
  { feld: "eintritt", label: "Eintritt", art: "date" },
  { feld: "austritt", label: "Austritt", art: "date" },
  { feld: "geburtsdatum", label: "Geburtsdatum", art: "date" },
  { feld: "ausstellungsdatum", label: "Ausstellungsdatum", art: "date" },
];

const FREITEXTE: { feld: keyof Zeugnis; label: string; hinweis: string }[] = [
  {
    feld: "taetigkeit_stichpunkte",
    label: "Aufgaben (Stichpunkte)",
    hinweis: "Eine Aufgabe je Zeile — daraus wird die Aufzählung im Zeugnis.",
  },
  {
    feld: "besondere_kompetenzen",
    label: "Besondere Kompetenzen",
    hinweis: "Fließt in die Leistungsbeurteilung ein.",
  },
  {
    feld: "besondere_erfolge",
    label: "Besondere Erfolge",
    hinweis: "Projekte, Auszeichnungen, messbare Ergebnisse.",
  },
];

export function ZeugnisAnsicht({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [entwuerfe, setEntwuerfe] = useState<Record<string, string>>({});

  const zeugnis = useQuery({
    queryKey: zeugnisKeys.eines(id),
    queryFn: () => zeugnisApi.eines(id),
  });
  const noten = useQuery({
    queryKey: zeugnisKeys.bewertungen(id),
    queryFn: () => zeugnisApi.bewertungen(id),
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["zeugnisse"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const aendern = useMutation({
    mutationFn: (felder: Partial<Zeugnis>) => zeugnisApi.aendern(id, felder),
    onSuccess: neuLaden,
    onError: melde,
  });

  const note = useMutation({
    mutationFn: ({ dimension, wert }: { dimension: string; wert: number | null }) =>
      zeugnisApi.noteSetzen(id, dimension, wert),
    onSuccess: neuLaden,
    onError: melde,
  });

  const baukasten = useMutation({
    mutationFn: () => zeugnisApi.baukasten(id),
    onSuccess: () => {
      toast.success("Text aus den Bausteinen gebildet.");
      return neuLaden();
    },
    onError: melde,
  });

  const ki = useMutation({
    mutationFn: () => zeugnisApi.ki(id),
    onSuccess: () => {
      toast.success("Text von der KI formuliert.");
      return neuLaden();
    },
    onError: (fehler: Error) =>
      toast.error(
        /ANTHROPIC|inaktiv/i.test(fehler.message)
          ? "Die KI ist nicht eingerichtet — der Baukasten schreibt den Text ohne sie."
          : fehler.message,
      ),
  });

  const dokument = useMutation({
    mutationFn: (art: "docx" | "pdf") => zeugnisApi.dokument(id, art),
    onError: melde,
  });

  const loeschen = useMutation({
    mutationFn: () => zeugnisApi.loeschen(id),
    onSuccess: () => {
      toast.success("Zeugnis gelöscht.");
      router.push("/hr/zeugnisse");
      return neuLaden();
    },
    onError: melde,
  });

  const z = zeugnis.data;
  const notenNach = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of noten.data ?? []) m.set(b.dimension, b.note);
    return m;
  }, [noten.data]);

  if (zeugnis.isLoading) {
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>;
  }
  if (!z) {
    return <EmptyState title="Dieses Zeugnis gibt es nicht" body="Vermutlich wurde es gelöscht." />;
  }

  const schnitt = z.schlussnote ? Number(z.schlussnote) : null;
  const dimensionen = DIMENSIONEN.filter((d) => d.wert !== "fuehrung" || z.fuehrungskraft);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{z.name}</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {ARTEN.find((a) => a.wert === z.art)?.label}
            {schnitt !== null && ` · Durchschnitt ${schnitt.toFixed(1)}`}
            {zufriedenheit(schnitt) && ` — „${zufriedenheit(schnitt)}“`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/hr/zeugnisse" className="text-sm underline-offset-4 hover:underline">
            Zur Übersicht
          </Link>
          <ConfirmDeleteButton
            itemLabel={`Zeugnis ${z.name}`}
            onConfirm={() => loeschen.mutateAsync().then(() => undefined)}
          />
        </div>
      </div>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">Stammdaten</h2>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          Abgeschrieben beim Anlegen. Änderungen hier gelten nur für dieses
          Zeugnis — Personio bleibt unberührt.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STAMM.map(({ feld, label, art }) => (
            <div key={feld} className="flex flex-col gap-1">
              <Label htmlFor={feld}>{label}</Label>
              <Input
                id={feld}
                type={art === "date" ? "date" : "text"}
                defaultValue={(z[feld] as string | null) ?? ""}
                placeholder="—"
                onBlur={(e) => {
                  const wert = e.target.value.trim();
                  const alt = (z[feld] as string | null) ?? "";
                  if (wert === alt) return;
                  if (feld === "name" && !wert) {
                    toast.error("Ohne Namen geht es nicht.");
                    e.target.value = alt;
                    return;
                  }
                  aendern.mutate({ [feld]: wert || null } as Partial<Zeugnis>);
                }}
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor="geschlecht">Anrede</Label>
            <Select
              id="geschlecht"
              value={z.geschlecht ?? ""}
              onChange={(e) =>
                aendern.mutate({
                  geschlecht: (e.target.value || null) as Zeugnis["geschlecht"],
                })
              }
            >
              <option value="">ohne (geschlechtsneutral)</option>
              <option value="w">Frau</option>
              <option value="m">Herr</option>
              <option value="d">divers</option>
            </Select>
            <span className="text-xs text-[var(--fg-muted)]">
              Steuert Anrede und Pronomen im Text.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="art">Art</Label>
            <Select
              id="art"
              value={z.art}
              onChange={(e) => aendern.mutate({ art: e.target.value })}
            >
              {ARTEN.map((a) => (
                <option key={a.wert} value={a.wert}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="anlass">Anlass</Label>
            <Input
              id="anlass"
              defaultValue={z.anlass ?? ""}
              placeholder="z. B. eigener Wunsch"
              onBlur={(e) => {
                const wert = e.target.value.trim() || null;
                if (wert !== z.anlass) aendern.mutate({ anlass: wert });
              }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={z.fuehrungskraft}
            label="Führungskraft"
            onCheckedChange={(fuehrungskraft) => aendern.mutate({ fuehrungskraft })}
          />
          <span className="text-sm">
            {"Führungskraft — blendet die Dimension „Führung“ ein"}
          </span>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">Bewertung</h2>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          Schulnoten von 1 bis 4. Aus dem Durchschnitt folgt die
          Zufriedenheitsformel — nicht umgekehrt.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dimensionen.map((d) => (
            <div key={d.wert} className="flex flex-col gap-1">
              <Label htmlFor={d.wert}>{d.label}</Label>
              <Select
                id={d.wert}
                value={String(notenNach.get(d.wert) ?? "")}
                onChange={(e) =>
                  note.mutate({
                    dimension: d.wert,
                    wert: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">— ohne —</option>
                {NOTEN.map((n) => (
                  <option key={n.wert} value={String(n.wert)}>
                    {n.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">Was hineinsoll</h2>
        {FREITEXTE.map(({ feld, label, hinweis }) => (
          <div key={feld} className="flex flex-col gap-1">
            <Label htmlFor={feld}>{label}</Label>
            <Textarea
              id={feld}
              rows={3}
              defaultValue={(z[feld] as string | null) ?? ""}
              onBlur={(e) => {
                const wert = e.target.value.trim() || null;
                if (wert !== z[feld]) {
                  aendern.mutate({ [feld]: wert } as Partial<Zeugnis>);
                }
              }}
            />
            <span className="text-xs text-[var(--fg-muted)]">{hinweis}</span>
          </div>
        ))}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Text</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={baukasten.isPending}
              onClick={() => baukasten.mutate()}
            >
              <Wrench className="mr-1.5 h-4 w-4" aria-hidden />
              {baukasten.isPending ? "Baut …" : "Aus Bausteinen"}
            </Button>
            <Button variant="outline" disabled={ki.isPending} onClick={() => ki.mutate()}>
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
              {ki.isPending ? "Formuliert …" : "Mit KI"}
            </Button>
            <Button
              disabled={dokument.isPending}
              onClick={() => dokument.mutate("pdf")}
            >
              <FileDown className="mr-1.5 h-4 w-4" aria-hidden />
              PDF
            </Button>
            <Button
              variant="outline"
              disabled={dokument.isPending}
              onClick={() => dokument.mutate("docx")}
            >
              <FileText className="mr-1.5 h-4 w-4" aria-hidden />
              Word
            </Button>
          </div>
        </div>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          Der Baukasten schreibt ohne Netz und ohne KI. Die KI formuliert
          freier — an sie gehen nur Anrede, Rolle, Abteilung, Dauer, Noten und
          die Freitexte oben. Name, Geburtsdatum und Personalnummer verlassen
          den Server nicht.
        </p>

        <Unterschriften id={id} />

        {!z.abschnitte ? (
          <p className="text-sm text-[var(--fg-muted)]">
            Noch kein Text. Vergib die Noten und lass ihn bilden.
          </p>
        ) : (
          ABSCHNITTE.map((a) => {
            const wert = entwuerfe[a.wert] ?? z.abschnitte?.[a.wert] ?? "";
            return (
              <div key={a.wert} className="flex flex-col gap-1">
                <Label htmlFor={`t-${a.wert}`}>{a.label}</Label>
                <Textarea
                  id={`t-${a.wert}`}
                  rows={Math.min(10, Math.max(3, Math.ceil(wert.length / 90)))}
                  value={wert}
                  onChange={(e) =>
                    setEntwuerfe((s) => ({ ...s, [a.wert]: e.target.value }))
                  }
                  onBlur={() => {
                    const neu = entwuerfe[a.wert];
                    if (neu === undefined || neu === z.abschnitte?.[a.wert]) return;
                    aendern.mutate({
                      abschnitte: { ...(z.abschnitte ?? {}), [a.wert]: neu },
                    });
                  }}
                />
              </div>
            );
          })
        )}

        <div className="flex items-center gap-2 border-t border-[var(--border)] pt-4">
          <Switch
            checked={z.status === "fertig"}
            label="Zeugnis fertig"
            onCheckedChange={(fertig) =>
              aendern.mutate({ status: fertig ? "fertig" : "entwurf" })
            }
          />
          <span className="text-sm">Fertig — nicht mehr in Arbeit</span>
        </div>
      </Card>
    </div>
  );
}


/**
 * Wer unter diesem Zeugnis stehen wird.
 *
 * Die linke Unterschrift hängt an der Person und wird erst beim Setzen aus
 * Personio aufgelöst. Stünde sie nirgends, fiele das erst im fertigen PDF auf
 * — und dann ist das Zeugnis schon gedruckt.
 */
function Unterschriften({ id }: { id: string }) {
  const abfrage = useQuery({
    queryKey: zeugnisKeys.unterschriften(id),
    queryFn: () => zeugnisApi.unterschriften(id),
  });

  if (abfrage.isPending) return null;
  if (abfrage.isError) {
    return (
      <p className="text-sm text-[var(--warn)]">
        Die Unterschriften konnten nicht ermittelt werden (
        {(abfrage.error as Error).message}).
      </p>
    );
  }

  const { fachlich, personalseitig } = abfrage.data;
  return (
    <div className="rounded-md border border-[var(--border)] p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <PenLine className="h-4 w-4" aria-hidden />
        Darunter steht
      </h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Signatur titel="Fachlich" u={fachlich} />
        <Signatur titel="Personalwesen" u={personalseitig} />
      </div>
      {(fachlich.quelle === "keine" || personalseitig.quelle === "keine") && (
        <p className="mt-3 text-sm text-[var(--warn)]">
          Eine Unterschrift fehlt. Hinterlegen unter Einstellungen → Zeugnisse,
          oder in Personio den Vorgesetzten pflegen.
        </p>
      )}
    </div>
  );
}

function Signatur({ titel, u }: { titel: string; u: Unterschrift }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">{titel}</p>
      <p className={u.name ? "font-medium" : "font-medium text-[var(--warn)]"}>
        {u.name ?? "— niemand hinterlegt —"}
      </p>
      <p className="text-sm text-[var(--fg-muted)]">
        {[u.titel, QUELLE_LABEL[u.quelle]].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}
