"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, FileUp, Plus } from "lucide-react";

import {
  INTERVALLE,
  intervallText,
  laufendesHalbjahr,
  wartungApi,
  wartungKeys,
  type Aufgabe,
  type Datei,
  type Intervall,
  type Maschine,
} from "@/lib/wartung";
import { computeFetch } from "@/lib/compute";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  Table,
  TableWrap,
  Td,
  Textarea,
  Th,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

const STAMMDATEN: { feld: keyof Maschine; label: string }[] = [
  { feld: "name", label: "Name" },
  { feld: "inventarnummer", label: "Inventar-Nr." },
  { feld: "standort", label: "Standort" },
  { feld: "hersteller", label: "Hersteller" },
  { feld: "modell", label: "Modell" },
  { feld: "verantwortlich", label: "Verantwortlich" },
];

export function MaschineAnsicht({
  id,
  darfSchreiben,
}: {
  id: string;
  darfSchreiben: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const jetzt = laufendesHalbjahr();
  const [jahr, setJahr] = useState(jetzt.jahr);
  const [halbjahr, setHalbjahr] = useState<1 | 2>(jetzt.halbjahr);
  const [neu, setNeu] = useState<{ titel: string; intervall: Intervall; wochen: string }>({
    titel: "",
    intervall: "monatlich",
    wochen: "4",
  });

  const maschine = useQuery({
    queryKey: wartungKeys.maschine(id),
    queryFn: () => wartungApi.maschine(id),
  });
  const aufgaben = useQuery({
    queryKey: wartungKeys.aufgaben(id),
    queryFn: () => wartungApi.aufgaben(id),
  });
  const dateien = useQuery({
    queryKey: wartungKeys.dateien(id),
    queryFn: () => wartungApi.dateien(id),
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["wartung"] });

  const aendern = useMutation({
    mutationFn: (felder: Partial<Maschine>) => wartungApi.aendern(id, felder),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const anlegen = useMutation({
    mutationFn: () =>
      wartungApi.aufgabeAnlegen(
        id,
        neu.titel.trim(),
        neu.intervall,
        Number(neu.wochen) || null,
      ),
    onSuccess: () => {
      setNeu({ ...neu, titel: "" });
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const aufgabeWeg = useMutation({
    mutationFn: (aufgabe: Aufgabe) => wartungApi.aufgabeLoeschen(aufgabe.id),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const hochladen = useMutation({
    mutationFn: ({ art, datei }: { art: Datei["art"]; datei: File }) =>
      wartungApi.dateiHochladen(id, art, datei),
    onSuccess: () => {
      toast.success("Datei hinterlegt.");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const dateiWeg = useMutation({
    mutationFn: (datei: Datei) => wartungApi.dateiLoeschen(datei),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const maschineWeg = useMutation({
    mutationFn: () => wartungApi.loeschen(maschine.data!, dateien.data ?? []),
    onSuccess: () => {
      toast.success("Maschine gelöscht.");
      router.push("/produktion");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  /**
   * Der Bogen kommt als PDF von `compute`. Er braucht das Bearer-Token, also
   * kein blanker Link: geholt, als Blob geöffnet, Objekt-URL wieder freigeben.
   */
  const bogen = useMutation({
    mutationFn: async () => {
      const antwort = await computeFetch(
        `/api/wartung/maschinen/${id}/bogen.pdf?jahr=${jahr}&halbjahr=${halbjahr}`,
      );
      if (!antwort.ok) {
        const text = await antwort.text();
        throw new Error(text.slice(0, 200) || `HTTP ${antwort.status}`);
      }
      const blob = await antwort.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const m = maschine.data;
  if (maschine.isLoading) {
    return <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>;
  }
  if (!m) {
    return <EmptyState title="Diese Maschine gibt es nicht" body="Sie wurde vermutlich gelöscht." />;
  }

  const liste = aufgaben.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{m.name}</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {[m.hersteller, m.modell].filter(Boolean).join(" · ") || "Ohne Herstellerangabe"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/produktion" className="text-sm underline-offset-4 hover:underline">
            Zur Übersicht
          </Link>
          {darfSchreiben && (
            <ConfirmDeleteButton
              itemLabel={m.name}
              onConfirm={() => maschineWeg.mutateAsync().then(() => undefined)}
            />
          )}
        </div>
      </div>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">Stammdaten</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STAMMDATEN.map(({ feld, label }) => (
            <div key={feld} className="flex flex-col gap-1">
              <Label htmlFor={feld}>{label}</Label>
              <Input
                id={feld}
                defaultValue={(m[feld] as string | null) ?? ""}
                placeholder="—"
                disabled={!darfSchreiben}
                onBlur={(e) => {
                  const wert = e.target.value.trim();
                  const alt = (m[feld] as string | null) ?? "";
                  if (wert === alt) return;
                  if (feld === "name" && !wert) {
                    toast.error("Ohne Namen geht es nicht.");
                    e.target.value = alt;
                    return;
                  }
                  aendern.mutate({ [feld]: wert || null } as Partial<Maschine>);
                }}
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor="status">Status</Label>
            <Select
              id="status"
              value={m.status}
              disabled={!darfSchreiben}
              onChange={(e) =>
                aendern.mutate({ status: e.target.value as Maschine["status"] })
              }
            >
              <option value="aktiv">aktiv</option>
              <option value="stillgelegt">stillgelegt</option>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="notizen">Notizen</Label>
          <Textarea
            id="notizen"
            defaultValue={m.notizen}
            rows={3}
            disabled={!darfSchreiben}
            onBlur={(e) => {
              if (e.target.value !== m.notizen) aendern.mutate({ notizen: e.target.value });
            }}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Wartungsaufgaben</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="jahr">Jahr</Label>
              <Input
                id="jahr"
                className="w-24 tabular-nums"
                inputMode="numeric"
                value={jahr}
                onChange={(e) => setJahr(Number(e.target.value) || jetzt.jahr)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="halbjahr">Halbjahr</Label>
              <Select
                id="halbjahr"
                value={String(halbjahr)}
                onChange={(e) => setHalbjahr(Number(e.target.value) as 1 | 2)}
              >
                <option value="1">KW 1–26</option>
                <option value="2">KW 27–52</option>
              </Select>
            </div>
            <Button onClick={() => bogen.mutate()} disabled={bogen.isPending}>
              <FileDown className="mr-1.5 h-4 w-4" aria-hidden />
              {bogen.isPending ? "Wird gebaut …" : "Nachweisbogen"}
            </Button>
          </div>
        </div>

        {darfSchreiben && (
          <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-4">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="neue-aufgabe">Neue Aufgabe</Label>
              <Input
                id="neue-aufgabe"
                value={neu.titel}
                placeholder="z. B. Ölstand prüfen"
                onChange={(e) => setNeu({ ...neu, titel: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && neu.titel.trim()) anlegen.mutate();
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="intervall">Intervall</Label>
              <Select
                id="intervall"
                value={neu.intervall}
                onChange={(e) =>
                  setNeu({ ...neu, intervall: e.target.value as Intervall })
                }
              >
                {INTERVALLE.map((i) => (
                  <option key={i.wert} value={i.wert}>
                    {i.label}
                  </option>
                ))}
              </Select>
            </div>
            {neu.intervall === "alle_n_wochen" && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="wochen">Wochen</Label>
                <Input
                  id="wochen"
                  className="w-24 tabular-nums"
                  inputMode="numeric"
                  value={neu.wochen}
                  onChange={(e) => setNeu({ ...neu, wochen: e.target.value })}
                />
              </div>
            )}
            <Button
              disabled={!neu.titel.trim() || anlegen.isPending}
              onClick={() => anlegen.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Hinzufügen
            </Button>
          </div>
        )}

        {liste.length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">
            Noch keine Aufgabe — der Bogen bliebe leer.
          </p>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Aufgabe</Th>
                  <Th>Intervall</Th>
                  <Th className="text-right" />
                </tr>
              </thead>
              <tbody>
                {liste.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      <Input
                        defaultValue={a.titel}
                        disabled={!darfSchreiben}
                        onBlur={(e) => {
                          const wert = e.target.value.trim();
                          if (wert && wert !== a.titel) {
                            wartungApi
                              .aufgabeAendern(a.id, { titel: wert })
                              .then(neuLaden)
                              .catch((f: Error) => toast.error(f.message));
                          }
                        }}
                      />
                    </Td>
                    <Td>{intervallText(a)}</Td>
                    <Td className="text-right">
                      {darfSchreiben && (
                        <ConfirmDeleteButton
                          itemLabel={a.titel}
                          onConfirm={() => aufgabeWeg.mutateAsync(a).then(() => undefined)}
                        />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Dateien</h2>
          {darfSchreiben && (
            <div className="flex gap-2">
              <DateiWahl art="plan" label="Plan hinterlegen" hochladen={hochladen} />
              <DateiWahl art="nachweis" label="Nachweis ablegen" hochladen={hochladen} />
            </div>
          )}
        </div>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          Der Herstellerplan und die zurückgescannten, unterschriebenen Bögen.
        </p>
        {(dateien.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">Noch keine Datei.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {(dateien.data ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                <Badge variant={d.art === "plan" ? "secondary" : "outline"}>
                  {d.art === "plan" ? "Plan" : "Nachweis"}
                </Badge>
                <button
                  type="button"
                  className="text-sm underline-offset-4 hover:underline"
                  onClick={() =>
                    wartungApi
                      .dateiUrl(d)
                      .then((url) => window.open(url, "_blank", "noopener"))
                      .catch((f: Error) => toast.error(f.message))
                  }
                >
                  {d.dateiname}
                </button>
                <span className="text-xs text-[var(--fg-muted)]">
                  {DATUM.format(new Date(d.hochgeladen_am))}
                </span>
                {darfSchreiben && (
                  <span className="ml-auto">
                    <ConfirmDeleteButton
                      itemLabel={d.dateiname}
                      onConfirm={() => dateiWeg.mutateAsync(d).then(() => undefined)}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DateiWahl({
  art,
  label,
  hochladen,
}: {
  art: Datei["art"];
  label: string;
  hochladen: { mutate: (v: { art: Datei["art"]; datei: File }) => void; isPending: boolean };
}) {
  return (
    <label
      className={
        "inline-flex h-9 cursor-pointer items-center rounded-md border " +
        "border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--muted)] " +
        "focus-within:outline-2 focus-within:outline-[var(--ring)]"
      }
    >
      <FileUp className="mr-1.5 h-4 w-4" aria-hidden />
      {hochladen.isPending ? "Lädt …" : label}
      <input
        type="file"
        className="sr-only"
        aria-label={label}
        accept="application/pdf,image/png,image/jpeg"
        disabled={hochladen.isPending}
        onChange={(e) => {
          const datei = e.target.files?.[0];
          e.target.value = "";
          if (datei) hochladen.mutate({ art, datei });
        }}
      />
    </label>
  );
}
