"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { onboardingApi, onboardingKeys, type Rolle } from "@/lib/onboarding";
import { Badge, Button, Input, Label } from "@/components/ui/primitives";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Position → Abteilungskürzel: die Brücke zwischen Personio und der feinen
 * Ebene der Anforderungsmatrix. Ohne Eintrag greift die feine Ebene für diese
 * Position nicht — der Plan sagt das dann ausdrücklich.
 */
export function Rollen({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState({ position: "", kuerzel: "" });

  const rollen = useQuery({ queryKey: onboardingKeys.rollen(), queryFn: onboardingApi.rollen });
  const neuLaden = () => queryClient.invalidateQueries({ queryKey: ["onboarding"] });
  const melde = (fehler: Error) => toast.error(fehler.message);

  const setzen = useMutation({
    mutationFn: () => onboardingApi.rolleSetzen(neu.position.trim(), neu.kuerzel.trim()),
    onSuccess: () => {
      setNeu({ position: "", kuerzel: "" });
      return neuLaden();
    },
    onError: melde,
  });

  const weg = useMutation({
    mutationFn: (id: string) => onboardingApi.rolleLoeschen(id),
    onSuccess: neuLaden,
    onError: melde,
  });

  const spalten: Tabellenspalte<Rolle>[] = [
    { schluessel: "position", titel: worte.onboarding.position, typ: "text", wert: (r) => r.position },
    {
      schluessel: "kuerzel",
      titel: worte.onboarding.kuerzel,
      typ: "text",
      wert: (r) => r.abteilung_kuerzel,
      zelle: (r) => <Badge variant="outline">{r.abteilung_kuerzel}</Badge>,
    },
    {
      schluessel: "aktion",
      titel: "",
      typ: "text",
      sortierbar: false,
      suchtext: false,
      wert: () => null,
      ausrichtung: "end",
      zelle: (r) =>
        darfSchreiben ? (
          <ConfirmDeleteButton itemLabel={r.position} onConfirm={() => weg.mutateAsync(r.id).then(() => undefined)} />
        ) : null,
    },
  ];

  return (
    <div className="space-y-4 p-4">
      <p className="max-w-prose text-sm text-[var(--fg-muted)]">{worte.onboarding.brueckeHinweis}</p>
      <Datentabelle
        zeilen={rollen.data ?? []}
        spalten={spalten}
        zeilenSchluessel={(r) => r.id}
        laedt={rollen.isPending}
        beschriftung={worte.onboarding.bruecke}
      />
      {darfSchreiben && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label htmlFor="rolle-position">{worte.onboarding.position}</Label>
            <Input
              id="rolle-position"
              value={neu.position}
              placeholder={worte.onboarding.positionBeispiel}
              onChange={(e) => setNeu({ ...neu, position: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rolle-kuerzel">{worte.onboarding.kuerzel}</Label>
            <Input
              id="rolle-kuerzel"
              className="w-28"
              value={neu.kuerzel}
              placeholder={worte.onboarding.kuerzelBeispiel}
              onChange={(e) => setNeu({ ...neu, kuerzel: e.target.value })}
            />
          </div>
          <Button
            variant="outline"
            disabled={!neu.position.trim() || !neu.kuerzel.trim() || setzen.isPending}
            onClick={() => setzen.mutate()}
          >
            {worte.onboarding.zuordnen}
          </Button>
        </div>
      )}
    </div>
  );
}
