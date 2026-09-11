"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, Plus } from "lucide-react";

import {
  einarbeitungApi,
  einarbeitungKeys,
  type Inhalt,
} from "@/lib/einarbeitung";
import { onboardingApi, onboardingKeys } from "@/lib/onboarding";
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
  Th,
} from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenkopf } from "@/components/seitenkopf";

/**
 * Einarbeitung: die Inhalte, ihre Abteilungen und der persönliche Bogen.
 *
 * Ein Inhalt gehört einem Ansprechpartner, nicht einer Abteilung. Welche
 * Abteilung ihn braucht, sagt die Matrix darunter — sonst stünde derselbe
 * Inhalt für jede Abteilung noch einmal da.
 */
export function Einarbeitung({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState("");
  const [neueAbteilung, setNeueAbteilung] = useState<Record<string, string>>({});
  const [fuer, setFuer] = useState("");

  const katalog = useQuery({
    queryKey: einarbeitungKeys.katalog(),
    queryFn: einarbeitungApi.katalog,
  });
  const pflicht = useQuery({
    queryKey: einarbeitungKeys.pflicht(),
    queryFn: einarbeitungApi.pflicht,
  });
  const eintritte = useQuery({
    queryKey: onboardingKeys.eintritte(),
    queryFn: onboardingApi.eintritte,
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["einarbeitung"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const anlegen = useMutation({
    mutationFn: () =>
      einarbeitungApi.anlegen(
        neu.trim(),
        Math.max(0, ...(katalog.data ?? []).map((i) => i.reihenfolge)) + 1,
      ),
    onSuccess: () => {
      setNeu("");
      return neuLaden();
    },
    onError: melde,
  });

  const aendern = useMutation({
    mutationFn: ({ id, felder }: { id: string; felder: Partial<Inhalt> }) =>
      einarbeitungApi.aendern(id, felder),
    onSuccess: neuLaden,
    onError: melde,
  });

  const weg = useMutation({
    mutationFn: (id: string) => einarbeitungApi.loeschen(id),
    onSuccess: neuLaden,
    onError: melde,
  });

  const pflichtSetzen = useMutation({
    mutationFn: (w: { id: string; abteilung: string; an: boolean }) =>
      einarbeitungApi.pflichtSetzen(w.id, w.abteilung, w.an),
    onSuccess: (_d, w) => {
      setNeueAbteilung((s) => ({ ...s, [w.id]: "" }));
      return neuLaden();
    },
    onError: melde,
  });

  /** Der Bogen kommt als PDF von `compute` — mit Token, also nicht als Link. */
  const bogen = useMutation({
    mutationFn: async (frage: Record<string, string>) => {
      const antwort = await computeFetch(einarbeitungApi.bogenUrl(frage));
      if (!antwort.ok) {
        throw new Error((await antwort.text()).slice(0, 200) || `HTTP ${antwort.status}`);
      }
      const url = URL.createObjectURL(await antwort.blob());
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: melde,
  });

  const inhalte = katalog.data ?? [];
  const pflichten = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of pflicht.data ?? []) {
      m.set(p.einarbeitung_id, [...(m.get(p.einarbeitung_id) ?? []), p.abteilung]);
    }
    return m;
  }, [pflicht.data]);

  const personen = (eintritte.data ?? []).filter((e) => e.employee_id !== null);
  const gewaehlt = personen.find((e) => String(e.employee_id) === fuer);

  return (
    <div className="space-y-6">
      <Seitenkopf
        untertitel={worte.einarbeitung.einleitung}
        unter={
          <div className="mt-2 flex justify-center gap-4 text-sm">
            <Link href="/hr/onboarding" className="underline-offset-4 hover:underline">
              {worte.pfad.seiten["/hr/onboarding"]}
            </Link>
          </div>
        }
      />

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">{worte.einarbeitung.bogenErzeugen}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-col gap-1">
            <Label htmlFor="person">{worte.einarbeitung.person}</Label>
            <Select id="person" value={fuer} onChange={(e) => setFuer(e.target.value)}>
              <option value="">{worte.einarbeitung.waehlen}</option>
              {personen.map((p) => (
                <option key={p.employee_id} value={String(p.employee_id)}>
                  {p.name}
                  {p.abteilung ? ` · ${p.abteilung}` : ""}
                </option>
              ))}
            </Select>
          </div>
          <Button
            disabled={!gewaehlt || bogen.isPending}
            onClick={() => bogen.mutate({ employee_id: fuer })}
          >
            <FileDown className="mr-1.5 h-4 w-4" aria-hidden />
            {bogen.isPending ? worte.einarbeitung.wirdGebaut : worte.einarbeitung.einarbeitungsplan}
          </Button>
          {gewaehlt && (
            <span className="text-sm text-[var(--fg-muted)]">
              {pflichten.size === 0
                ? worte.einarbeitung.keineInhalte
                : worte.einarbeitung.abteilungVon(gewaehlt.abteilung ?? "—")}
            </span>
          )}
        </div>
      </Card>

      {darfSchreiben && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <Label htmlFor="neu">{worte.einarbeitung.neuerInhalt}</Label>
            <Input
              id="neu"
              value={neu}
              placeholder={worte.einarbeitung.beispiel}
              onChange={(e) => setNeu(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && neu.trim()) anlegen.mutate();
              }}
            />
          </div>
          <Button disabled={!neu.trim() || anlegen.isPending} onClick={() => anlegen.mutate()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {worte.einarbeitung.anlegen}
          </Button>
        </Card>
      )}

      {katalog.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">{worte.dashboard.laedt}</Card>
      ) : inhalte.length === 0 ? (
        <EmptyState
          title={worte.einarbeitung.keinInhalt}
          body={worte.einarbeitung.keinInhaltText}
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{worte.einarbeitung.inhalt}</Th>
                <Th>{worte.einarbeitung.ansprechpartner}</Th>
                <Th>{worte.einarbeitung.bereich}</Th>
                <Th>{worte.einarbeitung.fuerAbteilungen}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {inhalte.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <Input
                      className="min-w-56"
                      defaultValue={i.inhalt}
                      disabled={!darfSchreiben}
                      onBlur={(e) => {
                        const wert = e.target.value.trim();
                        if (wert && wert !== i.inhalt) {
                          aendern.mutate({ id: i.id, felder: { inhalt: wert } });
                        }
                      }}
                    />
                  </Td>
                  <Td>
                    <Input
                      defaultValue={i.ansprechpartner ?? ""}
                      placeholder="—"
                      disabled={!darfSchreiben}
                      onBlur={(e) => {
                        const wert = e.target.value.trim() || null;
                        if (wert !== i.ansprechpartner) {
                          aendern.mutate({ id: i.id, felder: { ansprechpartner: wert } });
                        }
                      }}
                    />
                  </Td>
                  <Td>
                    <Input
                      className="w-32"
                      defaultValue={i.bereich ?? ""}
                      placeholder={worte.einarbeitung.abteilung}
                      title={worte.einarbeitung.bereichLeer}
                      disabled={!darfSchreiben}
                      onBlur={(e) => {
                        const wert = e.target.value.trim() || null;
                        if (wert !== i.bereich) {
                          aendern.mutate({ id: i.id, felder: { bereich: wert } });
                        }
                      }}
                    />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(pflichten.get(i.id) ?? []).map((a) => (
                        <Badge key={a} variant="secondary">
                          {a}
                          {darfSchreiben && (
                            <button
                              type="button"
                              className="ml-1.5 text-[var(--fg-muted)] hover:text-[var(--danger)]"
                              aria-label={worte.einarbeitung.entfernen(a)}
                              onClick={() =>
                                pflichtSetzen.mutate({ id: i.id, abteilung: a, an: false })
                              }
                            >
                              ×
                            </button>
                          )}
                        </Badge>
                      ))}
                      {darfSchreiben && (
                        <Input
                          className="w-32"
                          value={neueAbteilung[i.id] ?? ""}
                          placeholder={worte.einarbeitung.abteilungHinzu}
                          aria-label={worte.einarbeitung.abteilungFuer(i.inhalt)}
                          onChange={(e) =>
                            setNeueAbteilung((s) => ({ ...s, [i.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            const wert = (neueAbteilung[i.id] ?? "").trim();
                            if (e.key === "Enter" && wert) {
                              pflichtSetzen.mutate({ id: i.id, abteilung: wert, an: true });
                            }
                          }}
                        />
                      )}
                    </div>
                  </Td>
                  <Td className="text-right">
                    {darfSchreiben && (
                      <ConfirmDeleteButton
                        itemLabel={i.inhalt}
                        onConfirm={() => weg.mutateAsync(i.id).then(() => undefined)}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
