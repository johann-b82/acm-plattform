"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  anzeigename,
  baueWald,
  filtere,
  ladeFoto,
  ladeOrganigramm,
  organigrammKeys,
  standorte,
  treffer,
  type Knoten,
} from "@/lib/organigramm";
import { initialen } from "@/lib/initialen";
import { Card, EmptyState, Input, Select } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenkopf } from "@/components/seitenkopf";
import { Seitenwerkzeuge, Werkzeug, useInSchale } from "@/components/sidebar/werkzeugplatz";
import { cn } from "@/lib/cn";

/**
 * Wer wem berichtet — als Baum mit Linien (ORG-01).
 *
 * Die Kette kommt aus Personio. Aufgeklappt ist zunächst alles; wer eine große
 * Abteilung zuklappen will, kann es. Stehen unter jemandem nur Personen ohne
 * eigene Mitarbeiter, stapeln sie sich in einer Spalte, damit das Haus nicht
 * breiter wird als nötig. Was trotzdem nicht passt, scrollt waagerecht.
 *
 * Mit Suche oder Standort bleibt die Führungskette stehen: wer passt, ist
 * umrandet, Vorgesetzte von anderswo stehen blass als Kontext dabei. Suche,
 * Standort und die Zählzeile stehen in der rechten Leiste.
 */
export function Organigramm() {
  const worte = useTexte();
  const inSchale = useInSchale();
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
  const fokus = useMemo(
    () => treffer(personen.data ?? [], suche, standort || null),
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
      />

      {/* In der Leiste trägt der Werkzeug-Titel die Beschriftung, sonst das Label. */}
      <Seitenwerkzeuge kategorie="filter">
        <div className="flex flex-col items-stretch gap-3">
          <Werkzeug titel={worte.organigramm.suchfeld}>
            <div className="space-y-1">
              {!inSchale && (
                <label htmlFor="org-suche" className="text-sm font-medium">
                  {worte.organigramm.suchfeld}
                </label>
              )}
              <Input
                id="org-suche"
                aria-label={worte.organigramm.suchfeld}
                value={suche}
                placeholder={worte.organigramm.suchePlatzhalter}
                className="w-full"
                onChange={(e) => setSuche(e.target.value)}
              />
            </div>
          </Werkzeug>
          {orte.length > 0 && (
            <Werkzeug titel={worte.organigramm.standort}>
              <div className="space-y-1">
                {!inSchale && (
                  <label htmlFor="org-ort" className="text-sm font-medium">
                    {worte.organigramm.standort}
                  </label>
                )}
                <Select
                  id="org-ort"
                  aria-label={worte.organigramm.standort}
                  value={standort}
                  className="w-full"
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
            </Werkzeug>
          )}
        </div>
      </Seitenwerkzeuge>
      <Seitenwerkzeuge kategorie="aktionen">
        <span className="text-sm text-[var(--fg-muted)]">
          {worte.organigramm.personen(personen.data?.length ?? 0)}
          {fokus && worte.organigramm.treffer(fokus.size)}
          {ohneVorgesetzten > 1 && worte.organigramm.ohneVorgesetzten(ohneVorgesetzten)}
        </span>
      </Seitenwerkzeuge>

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
          {fokus && <p className="mb-4 text-xs text-[var(--fg-muted)]">{worte.organigramm.kontext}</p>}
          <div className="org-baum">
            <ul>
              {wald.map((k) => (
                <Ast key={k.id} knoten={k} zu={zu} umschalten={umschalten} fokus={fokus} />
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}

function Ast({
  knoten,
  zu,
  umschalten,
  fokus,
}: {
  knoten: Knoten;
  zu: Set<number>;
  umschalten: (id: number) => void;
  fokus: Set<number> | null;
}) {
  const offen = knoten.kinder.length > 0 && !zu.has(knoten.id);
  // Mehrere Mitarbeiter ohne eigene Mitarbeiter: eine Spalte statt einer Reihe.
  const gestapelt = knoten.kinder.length > 1 && knoten.kinder.every((k) => k.kinder.length === 0);

  return (
    <li>
      <Karte knoten={knoten} fokus={fokus} zugeklappt={zu.has(knoten.id)} umschalten={umschalten} />
      {offen && (
        <ul className={cn(gestapelt && "org-blaetter")}>
          {knoten.kinder.map((k) =>
            gestapelt ? (
              <li key={k.id}>
                <Karte knoten={k} fokus={fokus} zugeklappt={false} umschalten={umschalten} />
              </li>
            ) : (
              <Ast key={k.id} knoten={k} zu={zu} umschalten={umschalten} fokus={fokus} />
            ),
          )}
        </ul>
      )}
    </li>
  );
}

function Karte({
  knoten,
  fokus,
  zugeklappt,
  umschalten,
}: {
  knoten: Knoten;
  fokus: Set<number> | null;
  zugeklappt: boolean;
  umschalten: (id: number) => void;
}) {
  const worte = useTexte();
  const name = anzeigename(knoten);
  const istTreffer = fokus?.has(knoten.id) ?? false;
  const unterzeile = [knoten.department, knoten.standort].filter(Boolean).join(" · ");

  return (
    <div
      data-treffer={istTreffer || undefined}
      className={cn(
        "flex w-56 items-start gap-2 rounded-lg border bg-[var(--surface)] p-2 text-start",
        istTreffer ? "border-[var(--ring)] ring-2 ring-[var(--ring)]" : "border-[var(--border)]",
        fokus && !istTreffer && "opacity-60",
      )}
    >
      <Avatar knoten={knoten} />
      <div className="min-w-0 flex-1" dir="auto">
        <div className="truncate text-sm font-medium" title={name}>
          {name}
        </div>
        {knoten.position && (
          <div className="truncate text-xs text-[var(--fg-muted)]" title={knoten.position}>
            {knoten.position}
          </div>
        )}
        {unterzeile && (
          <div className="truncate text-[11px] text-[var(--fg-muted)]" title={unterzeile}>
            {unterzeile}
          </div>
        )}
        {knoten.kinder.length > 0 && (
          <button
            type="button"
            onClick={() => umschalten(knoten.id)}
            aria-expanded={!zugeklappt}
            aria-label={zugeklappt ? worte.organigramm.aufklappen(name) : worte.organigramm.zuklappen(name)}
            className="mt-0.5 inline-flex items-center gap-0.5 rounded text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
          >
            {zugeklappt ? (
              <ChevronRight className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden />
            )}
            {worte.organigramm.direkt(knoten.kinder.length)}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Rechteckig mit dem Eckenradius der Felder. Das Bild kommt aus Personio,
 * gefunden über die Personio-Kennung; ohne Bild oder wenn es nicht lädt,
 * stehen die Initialen da.
 */
function Avatar({ knoten }: { knoten: Knoten }) {
  const [kaputt, setKaputt] = useState(false);
  const foto = useQuery({
    queryKey: organigrammKeys.foto(knoten.id),
    queryFn: () => ladeFoto(knoten.id),
    enabled: knoten.hat_foto,
    staleTime: Infinity,
    retry: false,
  });

  if (foto.data && !kaputt) {
    return (
      // Ein Blob aus dem Speicher des Browsers — `next/image` kann damit nichts anfangen.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={foto.data}
        alt=""
        className="h-11 w-11 shrink-0 rounded-md object-cover"
        onError={() => setKaputt(true)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--muted)] text-xs font-medium text-[var(--fg-muted)]"
    >
      {initialen(anzeigename(knoten))}
    </span>
  );
}
