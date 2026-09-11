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
import { useTexte } from "@/components/sprache/anbieter";
import { useZeugnisart, useZeugnisworte } from "@/lib/tafeln";

const STAMM: { feld: keyof Zeugnis; art?: "date" }[] = [
  { feld: "name" },
  { feld: "personalnummer" },
  { feld: "abteilung" },
  { feld: "taetigkeit" },
  { feld: "eintritt", art: "date" },
  { feld: "austritt", art: "date" },
  { feld: "geburtsdatum", art: "date" },
  { feld: "ausstellungsdatum", art: "date" },
];

const FREITEXTE: { feld: keyof Zeugnis; hinweis: "aufgabenHinweis" | "kompetenzenHinweis" | "erfolgeHinweis" }[] = [
  { feld: "taetigkeit_stichpunkte", hinweis: "aufgabenHinweis" },
  { feld: "besondere_kompetenzen", hinweis: "kompetenzenHinweis" },
  { feld: "besondere_erfolge", hinweis: "erfolgeHinweis" },
];

export function ZeugnisAnsicht({ id }: { id: string }) {
  const worte = useTexte();
  const zeugnisworte = useZeugnisworte();
  const artLabel = useZeugnisart();
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
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</Card>;
  }
  if (!z) {
    return <EmptyState title={worte.zeugnis.gibtEsNicht} body={worte.zeugnis.gibtEsNichtText} />;
  }

  const schnitt = z.schlussnote ? Number(z.schlussnote) : null;
  const dimensionen = DIMENSIONEN.filter((d) => d.wert !== "fuehrung" || z.fuehrungskraft);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{z.name}</h2>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {artLabel[z.art]}
            {schnitt !== null && worte.zeugnis.durchschnitt(schnitt.toFixed(1))}
            {zufriedenheit(schnitt) && ` — „${zufriedenheit(schnitt)}“`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/hr/zeugnisse" className="text-sm underline-offset-4 hover:underline">
            {worte.zeugnis.zurUebersicht}
          </Link>
          <ConfirmDeleteButton
            itemLabel={worte.zeugnis.zeugnisVon(z.name)}
            onConfirm={() => loeschen.mutateAsync().then(() => undefined)}
          />
        </div>
      </div>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">{worte.zeugnis.stammdaten}</h2>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          {worte.zeugnis.stammdatenHinweis}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STAMM.map(({ feld, art }) => (
            <div key={feld} className="flex flex-col gap-1">
              <Label htmlFor={feld}>{zeugnisworte[feld]}</Label>
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
                    toast.error(worte.zeugnis.ohneNamen);
                    e.target.value = alt;
                    return;
                  }
                  aendern.mutate({ [feld]: wert || null } as Partial<Zeugnis>);
                }}
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor="geschlecht">{worte.zeugnis.anrede}</Label>
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
              {worte.zeugnis.anredeHinweis}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="art">{worte.zeugnis.art}</Label>
            <Select
              id="art"
              value={z.art}
              onChange={(e) => aendern.mutate({ art: e.target.value })}
            >
              {ARTEN.map((a) => (
                <option key={a.wert} value={a.wert}>
                  {artLabel[a.wert]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="anlass">{worte.zeugnis.anlass}</Label>
            <Input
              id="anlass"
              defaultValue={z.anlass ?? ""}
              placeholder={worte.zeugnis.anlassBeispiel}
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
            label={worte.zeugnis.fuehrungskraft}
            onCheckedChange={(fuehrungskraft) => aendern.mutate({ fuehrungskraft })}
          />
          <span className="text-sm">
            {worte.zeugnis.fuehrungskraftHinweis}
          </span>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">{worte.zeugnis.bewertung}</h2>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          {worte.zeugnis.bewertungHinweis}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dimensionen.map((d) => (
            <div key={d.wert} className="flex flex-col gap-1">
              <Label htmlFor={d.wert}>{zeugnisworte[d.wert]}</Label>
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
        {FREITEXTE.map(({ feld, hinweis }) => (
          <div key={feld} className="flex flex-col gap-1">
            <Label htmlFor={feld}>{zeugnisworte[feld]}</Label>
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
            <span className="text-xs text-[var(--fg-muted)]">{worte.zeugnis[hinweis]}</span>
          </div>
        ))}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">{worte.zeugnis.text}</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={baukasten.isPending}
              onClick={() => baukasten.mutate()}
            >
              <Wrench className="mr-1.5 h-4 w-4" aria-hidden />
              {baukasten.isPending ? worte.zeugnis.baut : worte.zeugnis.ausBausteinen}
            </Button>
            <Button variant="outline" disabled={ki.isPending} onClick={() => ki.mutate()}>
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
              {ki.isPending ? worte.zeugnis.formuliert : worte.zeugnis.mitKi}
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
          {worte.zeugnis.textHinweis} {worte.zeugnis.hinweisDeutsch}
        </p>

        <Unterschriften id={id} />

        {!z.abschnitte ? (
          <p className="text-sm text-[var(--fg-muted)]">
            {worte.zeugnis.nochKeinText}
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
            label={worte.zeugnis.fertigSchalter}
            onCheckedChange={(fertig) =>
              aendern.mutate({ status: fertig ? "fertig" : "entwurf" })
            }
          />
          <span className="text-sm">{worte.zeugnis.fertigHinweis}</span>
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
  const worte = useTexte();
  const abfrage = useQuery({
    queryKey: zeugnisKeys.unterschriften(id),
    queryFn: () => zeugnisApi.unterschriften(id),
  });

  if (abfrage.isPending) return null;
  if (abfrage.isError) {
    return (
      <p className="text-sm text-[var(--warn)]">
        {worte.zeugnis.unterschriftenFehler((abfrage.error as Error).message)}
      </p>
    );
  }

  const { fachlich, personalseitig } = abfrage.data;
  return (
    <div className="rounded-md border border-[var(--border)] p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <PenLine className="h-4 w-4" aria-hidden />
        {worte.zeugnis.darunterSteht}
      </h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Signatur titel={worte.zeugnis.fachlich} u={fachlich} />
        <Signatur titel={worte.zeugnis.personalwesen} u={personalseitig} />
      </div>
      {(fachlich.quelle === "keine" || personalseitig.quelle === "keine") && (
        <p className="mt-3 text-sm text-[var(--warn)]">
          {worte.zeugnis.unterschriftFehlt}
        </p>
      )}
    </div>
  );
}

function Signatur({ titel, u }: { titel: string; u: Unterschrift }) {
  const worte = useTexte();
  const zeugnisworte = useZeugnisworte();
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">{titel}</p>
      <p className={u.name ? "font-medium" : "font-medium text-[var(--warn)]"}>
        {u.name ?? worte.zeugnis.niemandHinterlegt}
      </p>
      <p className="text-sm text-[var(--fg-muted)]">
        {[u.titel, zeugnisworte[u.quelle]].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}
