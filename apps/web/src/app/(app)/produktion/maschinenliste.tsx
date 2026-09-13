"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import {
  STAMMFELDER,
  maschinenEingabe,
  wartungApi,
  wartungKeys,
  type Maschine,
  type MaschinenEntwurf,
  type Status,
} from "@/lib/wartung";
import { Badge, Button, Card, EmptyState, Input, Label, Select } from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenkopf } from "@/components/seitenkopf";

const LEER: MaschinenEntwurf = {
  name: "",
  inventarnummer: "",
  standort: "",
  hersteller: "",
  modell: "",
  verantwortlich: "",
  status: "aktiv",
};

/**
 * Die Maschinen und ihre Wartung.
 *
 * Es gibt keine Liste fälliger Termine — das Intervall ist eine Regel, und der
 * Nachweis ist ein Bogen, auf dem in der Spalte der Kalenderwoche abgezeichnet
 * wird. Alles andere wäre eine Terminliste, die niemand pflegt.
 *
 * Angelegt wird wie im Altsystem mit allen Stammdaten in einem Schritt
 * (WAR-02) — Pflicht ist nur der Name.
 */
export function Maschinenliste({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [formular, setFormular] = useState(false);
  const [neu, setNeu] = useState<MaschinenEntwurf>(LEER);

  const maschinen = useQuery({
    queryKey: wartungKeys.maschinen(),
    queryFn: wartungApi.maschinen,
  });
  const liste = maschinen.data ?? [];

  const anlegen = useMutation({
    mutationFn: () => wartungApi.anlegen(maschinenEingabe(neu)),
    onSuccess: () => {
      setNeu(LEER);
      setFormular(false);
      toast.success(worte.wartung.angelegt);
      return queryClient.invalidateQueries({ queryKey: ["wartung"] });
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const spalten: Tabellenspalte<Maschine>[] = [
    {
      schluessel: "name",
      titel: worte.wartung.maschine,
      typ: "text",
      wert: (m) => m.name,
      zelle: (m) => (
        <Link href={`/produktion/${m.id}`} className="font-medium underline-offset-4 hover:underline">
          {m.name}
        </Link>
      ),
    },
    { schluessel: "inventarnummer", titel: worte.wartung.inventarnummer, typ: "text", wert: (m) => m.inventarnummer },
    { schluessel: "standort", titel: worte.wartung.standort, typ: "text", wert: (m) => m.standort },
    { schluessel: "verantwortlich", titel: worte.wartung.verantwortlich, typ: "text", wert: (m) => m.verantwortlich },
    {
      schluessel: "status",
      titel: worte.wartung.status,
      typ: "text",
      wert: (m) => (m.status === "aktiv" ? worte.wartung.aktiv : worte.wartung.stillgelegt),
      zelle: (m) =>
        m.status === "aktiv" ? (
          <Badge>{worte.wartung.aktiv}</Badge>
        ) : (
          <Badge variant="outline">{worte.wartung.stillgelegt}</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.wartung.einleitung}
        unter={
          <div className="mt-2 flex justify-start text-sm">
            <Link href="/kpi/produktion" className="underline-offset-4 hover:underline">
              {worte.wartung.zuKennzahlen}
            </Link>
          </div>
        }
        bedienung={
          darfSchreiben && (
            <Button
              variant={formular ? "outline" : "default"}
              aria-expanded={formular}
              onClick={() => {
                if (formular) setNeu(LEER);
                setFormular(!formular);
              }}
            >
              {formular ? (
                worte.allgemein.abbrechen
              ) : (
                <>
                  <Plus className="me-1.5 h-4 w-4" aria-hidden />
                  {worte.wartung.neueMaschine}
                </>
              )}
            </Button>
          )
        }
      />

      {darfSchreiben && formular && (
        <Card className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STAMMFELDER.map((feld) => (
              <div key={feld} className="flex flex-col gap-1">
                <Label htmlFor={`neu-${feld}`}>{worte.maschine[feld]}</Label>
                <Input
                  id={`neu-${feld}`}
                  value={neu[feld]}
                  required={feld === "name"}
                  maxLength={feld === "inventarnummer" ? 64 : 255}
                  placeholder={feld === "name" ? worte.wartung.beispiel : undefined}
                  onChange={(e) => setNeu({ ...neu, [feld]: e.target.value })}
                />
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <Label htmlFor="neu-status">{worte.maschine.status}</Label>
              <Select
                id="neu-status"
                value={neu.status}
                onChange={(e) => setNeu({ ...neu, status: e.target.value as Status })}
              >
                <option value="aktiv">{worte.maschine.aktiv}</option>
                <option value="stillgelegt">{worte.maschine.stillgelegt}</option>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!neu.name.trim() || anlegen.isPending} onClick={() => anlegen.mutate()}>
              {worte.allgemein.speichern}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setNeu(LEER);
                setFormular(false);
              }}
            >
              {worte.allgemein.abbrechen}
            </Button>
          </div>
        </Card>
      )}

      {maschinen.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.allgemein.laedt}</Card>
      ) : liste.length === 0 ? (
        <EmptyState
          title={worte.wartung.keineMaschine}
          body={worte.wartung.keineMaschineText}
        />
      ) : (
        <Datentabelle
          zeilen={liste}
          spalten={spalten}
          zeilenSchluessel={(m) => m.id}
          vorsortierung={{ spalte: "name", richtung: "auf" }}
          beschriftung={worte.pfad.seiten["/produktion"]}
        />
      )}
    </div>
  );
}
