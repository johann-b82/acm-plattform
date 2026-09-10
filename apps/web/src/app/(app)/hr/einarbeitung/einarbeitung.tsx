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

/**
 * Einarbeitung: die Inhalte, ihre Abteilungen und der persönliche Bogen.
 *
 * Ein Inhalt gehört einem Ansprechpartner, nicht einer Abteilung. Welche
 * Abteilung ihn braucht, sagt die Matrix darunter — sonst stünde derselbe
 * Inhalt für jede Abteilung noch einmal da.
 */
export function Einarbeitung({ darfSchreiben }: { darfSchreiben: boolean }) {
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Einarbeitung</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
            Was eine neue Person lernen muss und wer es ihr zeigt. Der Bogen
            entsteht aus den Inhalten, die für ihre Abteilung hinterlegt sind.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href="/hr/onboarding" className="underline-offset-4 hover:underline">
            Onboarding
          </Link>
          <Link href="/hr" className="underline-offset-4 hover:underline">
            Personal
          </Link>
        </div>
      </div>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">Bogen erzeugen</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-col gap-1">
            <Label htmlFor="person">Person</Label>
            <Select id="person" value={fuer} onChange={(e) => setFuer(e.target.value)}>
              <option value="">— wählen —</option>
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
            {bogen.isPending ? "Wird gebaut …" : "Einarbeitungsplan"}
          </Button>
          {gewaehlt && (
            <span className="text-sm text-[var(--fg-muted)]">
              {pflichten.size === 0
                ? "Noch keine Inhalte hinterlegt — der Bogen bliebe leer."
                : `Abteilung ${gewaehlt.abteilung ?? "—"}`}
            </span>
          )}
        </div>
      </Card>

      {darfSchreiben && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <Label htmlFor="neu">Neuer Inhalt</Label>
            <Input
              id="neu"
              value={neu}
              placeholder="z. B. Sicherheitsunterweisung an der Fräse"
              onChange={(e) => setNeu(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && neu.trim()) anlegen.mutate();
              }}
            />
          </div>
          <Button disabled={!neu.trim() || anlegen.isPending} onClick={() => anlegen.mutate()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Anlegen
          </Button>
        </Card>
      )}

      {katalog.isLoading ? (
        <Card className="p-5 text-sm text-[var(--fg-muted)]">wird geladen …</Card>
      ) : inhalte.length === 0 ? (
        <EmptyState
          title="Noch kein Inhalt"
          body="Leg fest, was eine neue Person lernen muss — und für welche Abteilungen das gilt."
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Inhalt</Th>
                <Th>Ansprechpartner</Th>
                <Th>Bereich</Th>
                <Th>Für welche Abteilungen</Th>
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
                      placeholder="Abteilung"
                      title="Leer heißt: die Abteilung aus der Matrix einsetzen"
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
                              aria-label={`${a} entfernen`}
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
                          placeholder="+ Abteilung"
                          aria-label={`Abteilung für ${i.inhalt}`}
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
