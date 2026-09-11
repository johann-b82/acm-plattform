"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  anzeigename,
  baueWald,
  filtere,
  ladeOrganigramm,
  organigrammKeys,
  standorte,
  type Knoten,
} from "@/lib/organigramm";
import { Card, EmptyState, Input, Select } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenkopf } from "@/components/seitenkopf";

/**
 * Wer wem berichtet.
 *
 * Die Kette kommt aus Personio und wird hier zum Baum. Aufgeklappt ist
 * zunächst alles: bei rund vierzig Leuten ist ein zusammengeklapptes
 * Organigramm eine Klickstrecke ohne Nutzen. Wer eine große Abteilung
 * zuklappen will, kann es.
 */
export function Organigramm() {
  const worte = useTexte();
  const [suche, setSuche] = useState("");
  const [standort, setStandort] = useState<string>("");
  const [zu, setZu] = useState<Set<number>>(new Set());

  const personen = useQuery({
    queryKey: organigrammKeys.alle(),
    queryFn: ladeOrganigramm,
  });

  const orte = useMemo(() => standorte(personen.data ?? []), [personen.data]);
  const wald = useMemo(
    () => baueWald(filtere(personen.data ?? [], suche, standort || null)),
    [personen.data, suche, standort],
  );

  function umschalten(id: number) {
    setZu((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  }

  const ohneVorgesetzten = (personen.data ?? []).filter(
    (p) => p.vorgesetzter_id === null,
  ).length;

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.organigramm.einleitung}
      />

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="space-y-1">
          <label htmlFor="org-suche" className="text-sm font-medium">
            {worte.organigramm.suchfeld}
          </label>
          <Input
            id="org-suche"
            value={suche}
            placeholder={worte.organigramm.suchePlatzhalter}
            className="w-72"
            onChange={(e) => setSuche(e.target.value)}
          />
        </div>
        {orte.length > 0 && (
          <div className="space-y-1">
            <label htmlFor="org-ort" className="text-sm font-medium">
              {worte.organigramm.standort}
            </label>
            <Select
              id="org-ort"
              value={standort}
              className="w-48"
              onChange={(e) => setStandort(e.target.value)}
            >
              <option value="">{worte.organigramm.alleStandorte}</option>
              {orte.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </div>
        )}
        <span className="pb-2 text-sm text-[var(--fg-muted)]">
          {worte.organigramm.personen(personen.data?.length ?? 0)}
          {ohneVorgesetzten > 1 && worte.organigramm.ohneVorgesetzten(ohneVorgesetzten)}
        </span>
      </Card>

      {personen.error && (
        <p className="text-sm text-[var(--danger)]">{(personen.error as Error).message}</p>
      )}
      {personen.isPending && <p className="text-sm text-[var(--fg-muted)]">{worte.allgemein.laedt}</p>}

      {!personen.isPending && wald.length === 0 && (
        <EmptyState
          title={worte.organigramm.niemand}
          body={worte.organigramm.niemandText}
        />
      )}

      {wald.length > 0 && (
        <Card className="overflow-x-auto p-4">
          <ul className="min-w-max">
            {wald.map((k) => (
              <Ast key={k.id} knoten={k} zu={zu} umschalten={umschalten} ebene={0} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * Ein Ast samt seinen Kindern.
 *
 * Eingerückte Liste statt gezeichneter Kästchen: ein Organigramm mit vierzig
 * Leuten wird als Grafik entweder winzig oder breiter als jeder Bildschirm.
 * Eine Liste lässt sich lesen, durchsuchen und vorlesen.
 */
function Ast({
  knoten,
  zu,
  umschalten,
  ebene,
}: {
  knoten: Knoten;
  zu: Set<number>;
  umschalten: (id: number) => void;
  ebene: number;
}) {
  const worte = useTexte();
  const hatKinder = knoten.kinder.length > 0;
  const zugeklappt = zu.has(knoten.id);

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded py-1 hover:bg-[var(--muted)]"
        style={{ paddingLeft: `${ebene * 1.5}rem` }}
      >
        {hatKinder ? (
          <button
            type="button"
            onClick={() => umschalten(knoten.id)}
            aria-expanded={!zugeklappt}
            aria-label={
              zugeklappt
                ? worte.organigramm.aufklappen(anzeigename(knoten))
                : worte.organigramm.zuklappen(anzeigename(knoten))
            }
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--fg-muted)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
          >
            {zugeklappt ? (
              <ChevronRight className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden />
            )}
          </button>
        ) : (
          <span className="inline-block h-6 w-6" aria-hidden />
        )}
        <div className="min-w-0">
          <span className="font-medium">{anzeigename(knoten)}</span>
          {(knoten.position || knoten.department) && (
            <span className="ms-2 text-sm text-[var(--fg-muted)]">
              {[knoten.position, knoten.department].filter(Boolean).join(" · ")}
            </span>
          )}
          {knoten.standort && (
            <span className="ms-2 text-xs text-[var(--fg-muted)]">{knoten.standort}</span>
          )}
          {hatKinder && (
            <span className="ms-2 text-xs text-[var(--fg-muted)]">
              {worte.organigramm.direkt(knoten.kinder.length)}
            </span>
          )}
        </div>
      </div>
      {hatKinder && !zugeklappt && (
        <ul>
          {knoten.kinder.map((k) => (
            <Ast key={k.id} knoten={k} zu={zu} umschalten={umschalten} ebene={ebene + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
