"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import {
  DRINGLICHKEIT_LABEL,
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

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/** In dieser Reihenfolge steht es oben. */
const RANG: Record<Dringlichkeit, number> = {
  nie: 0,
  ueberfaellig: 1,
  faellig_bald: 2,
  offen: 3,
};

const FILTER: { wert: Dringlichkeit | "alle"; label: string }[] = [
  { wert: "alle", label: "Alles Offene" },
  { wert: "nie", label: "Nie absolviert" },
  { wert: "ueberfaellig", label: "Überfällig" },
  { wert: "faellig_bald", label: "Wird fällig" },
];

/**
 * Was zu tun ist — die Liste, nach der jemand handelt.
 *
 * Sortiert nach Dringlichkeit, nicht nach Namen: „nie absolviert" wiegt
 * schwerer als „überfällig", denn das eine ist eine Lücke und das andere eine
 * Verspätung.
 */
export function OffeneSchulungen() {
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Offene Schulungen</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Wer was noch braucht. Nur aktive Schulungen; stillgelegte tauchen
            hier nicht mehr auf.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href="/hr/schulungen/matrix" className="underline-offset-4 hover:underline">
            Matrix
          </Link>
          <Link href="/hr/schulungen" className="underline-offset-4 hover:underline">
            Zum Katalog
          </Link>
        </div>
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="flex gap-1">
          {FILTER.map((f) => (
            <Button
              key={f.wert}
              size="sm"
              variant={filter === f.wert ? "default" : "outline"}
              onClick={() => setFilter(f.wert)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Input
          className="max-w-xs"
          value={suche}
          placeholder="Person oder Schulung suchen"
          aria-label="Suchen"
          onChange={(e) => setSuche(e.target.value)}
        />
      </Card>

      {stand.isLoading || teilnahmen.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : zeilen.length === 0 ? (
        <EmptyState
          title="Nichts offen"
          body="Alle aktiven Schulungen sind im Turnus — oder es ist noch nichts eingelesen."
        />
      ) : (
        <>
          <p className="text-sm text-[var(--fg-muted)]">
            {zeilen.length} {zeilen.length === 1 ? "Eintrag" : "Einträge"}.
          </p>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Schulung</Th>
                  <Th>Bereich</Th>
                  <Th>Zuletzt</Th>
                  <Th>Fällig</Th>
                  <Th>Stand</Th>
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
                        {DRINGLICHKEIT_LABEL[z.d]}
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
