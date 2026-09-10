"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fmt } from "@/lib/kpi/gemeinsam";
import { personalApi, personalKeys } from "@/lib/kpi/personal";
import { Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/**
 * Ist-Stunden und Überstunden je Person im gewählten Zeitraum.
 *
 * Rechnet mit denselben Tagessummen und demselben Arbeitszeitmodell wie die
 * Kachel darüber — die Summe der Zeilen ergibt die Kachel. Im Altprojekt
 * weichen die beiden um den Faktor zehn ab, weil die Tabelle dort je
 * Anwesenheitssegment und mit pauschalem Tagessoll rechnet.
 */
export function Mitarbeitertabelle({ von, bis }: { von: string; bis: string }) {
  const [nurMitUeberstunden, setNurMitUeberstunden] = useState(true);

  const zeilen = useQuery({
    queryKey: personalKeys.mitarbeiter(von, bis),
    queryFn: () => personalApi.mitarbeiter(von, bis),
  });

  const alle = useMemo(() => zeilen.data ?? [], [zeilen.data]);
  const sichtbar = nurMitUeberstunden ? alle.filter((z) => z.ueberstunden > 0) : alle;
  const ohne = alle.length - sichtbar.length;

  if (zeilen.error) {
    return (
      <Card className="p-4 text-sm text-[var(--danger)]">
        Mitarbeitertabelle konnte nicht geladen werden: {(zeilen.error as Error).message}
      </Card>
    );
  }
  if (!zeilen.isLoading && alle.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Mitarbeiter</h2>
        <label className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
          <input
            type="checkbox"
            checked={nurMitUeberstunden}
            onChange={(e) => setNurMitUeberstunden(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          nur mit Überstunden
          {ohne > 0 && nurMitUeberstunden && <span>({ohne} ausgeblendet)</span>}
        </label>
      </div>

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Abteilung</Th>
              <Th className="text-right">Ist-Std.</Th>
              <Th className="text-right">Überstunden</Th>
              <Th className="text-right">ÜS %</Th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((z) => (
              <tr key={z.employee_id}>
                <Td>{z.name ?? `#${z.employee_id}`}</Td>
                <Td className="text-[var(--fg-muted)]">{z.department ?? "—"}</Td>
                <Td className="text-right font-mono tabular-nums">
                  {z.ist_stunden.toFixed(2)}
                </Td>
                <Td
                  className={cn(
                    "text-right font-mono tabular-nums",
                    z.ueberstunden > 0 && "font-medium",
                  )}
                >
                  {z.ueberstunden > 0 ? z.ueberstunden.toFixed(2) : "—"}
                </Td>
                <Td className="text-right font-mono tabular-nums text-[var(--fg-muted)]">
                  {fmt.prozent(z.quote)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {zeilen.isLoading && (
        <p className="text-sm text-[var(--fg-muted)]">wird geladen …</p>
      )}
    </section>
  );
}
