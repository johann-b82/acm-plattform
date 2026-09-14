"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { ARTEN, zeugnisApi, zeugnisKeys, type Zeugnis } from "@/lib/zeugnisse";
import { onboardingApi, onboardingKeys } from "@/lib/onboarding";
import { Badge, Button, Label, Select } from "@/components/ui/primitives";
import { Seitenwerkzeuge, Werkzeug, useInSchale } from "@/components/sidebar/werkzeugplatz";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";
import { useZeugnisart } from "@/lib/tafeln";
import { Klappbar } from "../klappbar";
import { Textbausteine } from "./textbausteine";



/**
 * Die Zeugnisse.
 *
 * Beim Anlegen werden die Stammdaten der Person abgeschrieben, nicht
 * verknüpft: ein im Mai ausgestelltes Zeugnis darf im September nicht anders
 * aussehen, weil sich in Personio eine Abteilung geändert hat. Person, Art
 * und „Anlegen“ stehen in der rechten Leiste.
 */
export function Zeugnisliste() {
  const worte = useTexte();
  const inSchale = useInSchale();
  const artLabel = useZeugnisart();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const queryClient = useQueryClient();
  const router = useRouter();
  const [person, setPerson] = useState("");
  const [art, setArt] = useState<string>("qualifiziert");

  const zeugnisse = useQuery({ queryKey: zeugnisKeys.liste(), queryFn: zeugnisApi.liste });
  const eintritte = useQuery({
    queryKey: onboardingKeys.eintritte(),
    queryFn: onboardingApi.eintritte,
  });

  const anlegen = useMutation({
    mutationFn: () => {
      const gewaehlt = (eintritte.data ?? []).find(
        (e) => String(e.employee_id ?? e.extern_id) === person,
      );
      if (!gewaehlt) throw new Error("Bitte eine Person wählen.");
      return zeugnisApi.anlegen({
        employee_id: gewaehlt.employee_id,
        extern_id: gewaehlt.extern_id,
        name: gewaehlt.name,
        abteilung: gewaehlt.abteilung,
        taetigkeit: gewaehlt.position,
        eintritt: gewaehlt.eintritt,
        art,
      });
    },
    onSuccess: (z) => {
      queryClient.invalidateQueries({ queryKey: ["zeugnisse"] });
      router.push(`/hr/zeugnisse/${z.id}`);
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const liste = zeugnisse.data ?? [];

  const spalten: Tabellenspalte<Zeugnis>[] = [
    {
      schluessel: "name",
      titel: worte.zeugnisse.person,
      typ: "text",
      wert: (z) => z.name,
      zelle: (z) => (
        <Link href={`/hr/zeugnisse/${z.id}`} className="font-medium underline-offset-4 hover:underline">
          {z.name}
        </Link>
      ),
    },
    { schluessel: "art", titel: worte.zeugnisse.art, typ: "text", wert: (z) => artLabel[z.art] ?? z.art },
    {
      schluessel: "zeitraum",
      titel: worte.zeugnisse.zeitraum,
      typ: "datum",
      suchtext: false,
      wert: (z) => z.eintritt,
      zelle: (z) => (
        <>
          {z.eintritt ? DATUM.format(new Date(z.eintritt)) : "—"}
          {z.austritt ? ` – ${DATUM.format(new Date(z.austritt))}` : ""}
        </>
      ),
    },
    {
      schluessel: "note",
      titel: worte.zeugnisse.note,
      typ: "zahl",
      suchtext: false,
      ausrichtung: "end",
      wert: (z) => (z.schlussnote === null ? null : Number(z.schlussnote)),
      zelle: (z) => z.schlussnote ?? "—",
    },
    {
      schluessel: "stand",
      titel: worte.zeugnisse.stand,
      typ: "text",
      wert: (z) => z.status,
      zelle: (z) =>
        z.status === "fertig" ? (
          <Badge>{worte.zeugnisse.fertig}</Badge>
        ) : (
          <Badge variant="outline">{worte.zeugnisse.entwurf}</Badge>
        ),
    },
    {
      schluessel: "angelegt",
      titel: worte.zeugnisse.angelegt,
      typ: "datum",
      suchtext: false,
      wert: (z) => z.erstellt_am,
      zelle: (z) => DATUM.format(new Date(z.erstellt_am)),
    },
  ];

  return (
    <div className="space-y-6">
      <Seitenkopf
      />

      <Klappbar titel={worte.zeugnisse.bausteineTitel} offenStart={false}>
        <Textbausteine />
      </Klappbar>

      {/* Person und Art gehören zum Anlegen, sie filtern die Liste nicht. In der
          Leiste trägt der Werkzeug-Titel die Beschriftung, sonst das Label. */}
      <Seitenwerkzeuge kategorie="aktionen">
        <div className="flex flex-col items-stretch gap-2">
          <Werkzeug titel={worte.zeugnisse.person}>
          <div className="flex flex-col gap-1">
            {!inSchale && <Label htmlFor="person">{worte.zeugnisse.person}</Label>}
            <Select
              id="person"
              aria-label={worte.zeugnisse.person}
              value={person}
              onChange={(e) => setPerson(e.target.value)}
            >
              <option value="">{worte.zeugnisse.waehlen}</option>
              {(eintritte.data ?? []).map((e) => (
                <option
                  key={e.employee_id ?? e.extern_id}
                  value={String(e.employee_id ?? e.extern_id)}
                >
                  {e.name}
                  {e.abteilung ? ` · ${e.abteilung}` : ""}
                </option>
              ))}
            </Select>
          </div>
          </Werkzeug>
          <Werkzeug titel={worte.zeugnisse.art}>
          <div className="flex flex-col gap-1">
            {!inSchale && <Label htmlFor="art">{worte.zeugnisse.art}</Label>}
            <Select id="art" aria-label={worte.zeugnisse.art} value={art} onChange={(e) => setArt(e.target.value)}>
              {ARTEN.map((a) => (
                <option key={a.wert} value={a.wert}>
                  {artLabel[a.wert]}
                </option>
              ))}
            </Select>
          </div>
          </Werkzeug>
          <Button disabled={!person || anlegen.isPending} onClick={() => anlegen.mutate()}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden />
            {worte.zeugnisse.anlegen}
          </Button>
        </div>
      </Seitenwerkzeuge>

      <Datentabelle
        zeilen={liste}
        spalten={spalten}
        zeilenSchluessel={(z) => z.id}
        laedt={zeugnisse.isLoading}
        leer={worte.zeugnisse.keinesText}
        beschriftung={worte.pfad.seiten["/hr/zeugnisse"]}
        vorsortierung={{ spalte: "angelegt", richtung: "ab" }}
      />
    </div>
  );
}
