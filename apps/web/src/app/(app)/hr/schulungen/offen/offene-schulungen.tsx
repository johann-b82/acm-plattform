"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import {
  dringlichkeit,
  schulungApi,
  schulungKeys,
  type Dringlichkeit,
} from "@/lib/schulungen";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/primitives";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { ZAHL_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";
import { useDringlichkeit } from "@/lib/tafeln";
import type { Texte } from "@/texte";



/** In dieser Reihenfolge steht es oben. */
const RANG: Record<Dringlichkeit, number> = {
  nie: 0,
  ueberfaellig: 1,
  faellig_bald: 2,
  offen: 3,
};

const FILTER: { wert: Dringlichkeit | "alle"; wort: keyof Texte["offeneSchulungen"] }[] = [
  { wert: "alle", wort: "allesOffene" },
  { wert: "nie", wort: "nieAbsolviert" },
  { wert: "ueberfaellig", wort: "ueberfaellig" },
  { wert: "faellig_bald", wort: "wirdFaellig" },
];

/**
 * Was zu tun ist — die Liste, nach der jemand handelt.
 *
 * Sortiert nach Dringlichkeit, nicht nach Namen: „nie absolviert" wiegt
 * schwerer als „überfällig", denn das eine ist eine Lücke und das andere eine
 * Verspätung.
 */
export function OffeneSchulungen() {
  const worte = useTexte();
  const DATUM = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], { dateStyle: "medium" });
  const dringlichkeitLabel = useDringlichkeit();
  const [filter, setFilter] = useState<Dringlichkeit | "alle">("alle");
  const [suche, setSuche] = useState("");

  const stand = useQuery({ queryKey: schulungKeys.stand(), queryFn: schulungApi.stand });
  const katalog = useQuery({ queryKey: schulungKeys.katalog(), queryFn: schulungApi.katalog });
  const teilnahmen = useQuery({
    queryKey: ["schulungen", "alle-teilnahmen"],
    queryFn: async () => {
      const katalogListe = await schulungApi.katalog();
      const alle = await Promise.all(
        katalogListe.map((s) => schulungApi.teilnahmen(s.id)),
      );
      return alle.flat();
    },
  });

  const nameNach = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teilnahmen.data ?? []) {
      m.set(t.id, t.mitarbeiter_name ?? t.personalnummer ?? "—");
    }
    return m;
  }, [teilnahmen.data]);

  const aktiv = useMemo(
    () => new Set((katalog.data ?? []).filter((s) => s.aktiv).map((s) => s.id)),
    [katalog.data],
  );

  const zeilen = useMemo(() => {
    const suchtext = suche.trim().toLowerCase();
    return (stand.data ?? [])
      .filter((s) => aktiv.has(s.schulung_id))
      .map((s) => ({ stand: s, d: dringlichkeit(s), name: nameNach.get(s.teilnahme_id) ?? "—" }))
      .filter((z) => z.d !== "offen")
      .filter((z) => (filter === "alle" ? true : z.d === filter))
      .filter(
        (z) =>
          !suchtext ||
          z.name.toLowerCase().includes(suchtext) ||
          z.stand.schulung.toLowerCase().includes(suchtext),
      )
      .sort(
        (a, b) =>
          RANG[a.d] - RANG[b.d] ||
          (a.stand.faellig_am ?? "").localeCompare(b.stand.faellig_am ?? "") ||
          a.name.localeCompare(b.name),
      );
  }, [stand.data, aktiv, nameNach, filter, suche]);

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.offeneSchulungen.einleitung}
        unter={
          <div className="mt-2 flex justify-start gap-4 text-sm">
            <Link href="/hr/schulungen/matrix" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/schulungen/matrix"]}
            </Link>
            <Link href="/hr/schulungen" className="underline-offset-4 hover:underline">
              {worte.offeneSchulungen.zumKatalog}
            </Link>
          </div>
        }
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="flex gap-1">
          {FILTER.map((f) => (
            <Button
              key={f.wert}
              size="sm"
              variant={filter === f.wert ? "default" : "outline"}
              onClick={() => setFilter(f.wert)}
            >
              {worte.offeneSchulungen[f.wort] as string}
            </Button>
          ))}
        </div>
        <Input
          className="max-w-xs"
          value={suche}
          placeholder={worte.offeneSchulungen.suchen}
          aria-label={worte.offeneSchulungen.suchenAria}
          onChange={(e) => setSuche(e.target.value)}
        />
      </Card>

      {stand.isLoading || teilnahmen.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</Card>
      ) : zeilen.length === 0 ? (
        <EmptyState
          title={worte.offeneSchulungen.nichtsOffen}
          body={worte.offeneSchulungen.nichtsOffenText}
        />
      ) : (
        <>
          <p className="text-sm text-[var(--fg-muted)]">
            {worte.offeneSchulungen.eintraege(zeilen.length)}
          </p>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{worte.offeneSchulungen.person}</Th>
                  <Th>{worte.offeneSchulungen.schulung}</Th>
                  <Th>{worte.offeneSchulungen.bereich}</Th>
                  <Th>{worte.offeneSchulungen.zuletzt}</Th>
                  <Th>{worte.offeneSchulungen.faellig}</Th>
                  <Th>{worte.offeneSchulungen.stand}</Th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.stand.teilnahme_id}>
                    <Td>{z.name}</Td>
                    <Td>{z.stand.schulung}</Td>
                    <Td>{z.stand.bereich}</Td>
                    <Td>
                      {z.stand.aktuell_datum
                        ? DATUM.format(new Date(z.stand.aktuell_datum))
                        : "—"}
                    </Td>
                    <Td>
                      {z.stand.faellig_am ? DATUM.format(new Date(z.stand.faellig_am)) : "—"}
                    </Td>
                    <Td>
                      <Badge variant={z.d === "faellig_bald" ? "outline" : "secondary"}>
                        {dringlichkeitLabel[z.d]}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </>
      )}
    </div>
  );
}
