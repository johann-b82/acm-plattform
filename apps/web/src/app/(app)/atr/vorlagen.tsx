"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";

import { XLSX_TYP, atrApi, atrKeys, type Vorlage } from "@/lib/atr";
import { Card, EmptyState, Input, Label } from "@/components/ui/primitives";

/**
 * Die Vorlage je Programm: Kopfdaten, die in jedem ATR-Dokument gleich
 * stehen, und die Gerüstdatei, aus der die Ausgabe entsteht.
 *
 * Angelegt werden Vorlagen beim Einlesen einer Referenzmappe — das Programm
 * steht dort in Zelle D2. Hier werden sie gepflegt.
 */
const FELDER: { feld: keyof Vorlage; label: string }[] = [
  { feld: "kunde", label: "Kunde" },
  { feld: "lieferant", label: "Lieferant" },
  { feld: "arbeitspaket", label: "Arbeitspaket" },
  { feld: "referenz", label: "Referenz" },
  { feld: "besteller_spez", label: "Bestellerspezifikation" },
  { feld: "lieferanten_spez", label: "Lieferantenspezifikation" },
  { feld: "kunden_spez", label: "Kundenspezifikation" },
  { feld: "atp", label: "ATP" },
  { feld: "nscm", label: "NSCM" },
  { feld: "ata_kapitel", label: "ATA-Kapitel" },
  { feld: "waage", label: "Waage" },
  { feld: "qs_unterschrift", label: "QS-Unterschrift" },
];

export function Vorlagen({ darfSchreiben }: { darfSchreiben: boolean }) {
  const queryClient = useQueryClient();
  const vorlagen = useQuery({
    queryKey: atrKeys.vorlagen(),
    queryFn: atrApi.vorlagen,
  });
  const liste = vorlagen.data ?? [];

  const neuLaden = () =>
    queryClient.invalidateQueries({ queryKey: atrKeys.vorlagen() });

  const aendern = useMutation({
    mutationFn: ({ programm, felder }: { programm: string; felder: Partial<Vorlage> }) =>
      atrApi.vorlageAendern(programm, felder),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const geruest = useMutation({
    mutationFn: ({ v, datei }: { v: Vorlage; datei: File }) =>
      atrApi.geruestSetzen(v, datei),
    onSuccess: () => {
      toast.success("Gerüstdatei hinterlegt.");
      return neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Vorlagen</h2>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">
          Eine je Programm. Kopfdaten und Gerüstdatei stehen in jedem
          ATR-Dokument dieses Programms gleich. Angelegt wird eine Vorlage
          beim Einlesen einer Referenzmappe.
        </p>
      </div>

      {liste.length === 0 ? (
        <EmptyState
          title="Noch keine Vorlage"
          body="Eine Referenzmappe einlesen — das Programm steht dort in Zelle D2."
        />
      ) : (
        liste.map((v) => (
          <Card key={v.programm} className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-medium">{v.programm}</h3>
              {darfSchreiben && (
                <label
                  className={
                    "ml-auto inline-flex h-8 cursor-pointer items-center rounded-md " +
                    "border border-[var(--border)] px-3 text-xs font-medium " +
                    "hover:bg-[var(--muted)] focus-within:outline-2 focus-within:outline-[var(--ring)]"
                  }
                >
                  <FileUp className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {v.geruest_dateiname ? "Gerüst ersetzen" : "Gerüst wählen"}
                  <input
                    type="file"
                    accept={`.xlsx,${XLSX_TYP}`}
                    className="sr-only"
                    aria-label={`Gerüstdatei für ${v.programm}`}
                    onChange={(e) => {
                      const datei = e.target.files?.[0];
                      e.target.value = "";
                      if (datei) geruest.mutate({ v, datei });
                    }}
                  />
                </label>
              )}
            </div>

            <p className="text-sm text-[var(--fg-muted)]">
              Gerüstdatei:{" "}
              {v.geruest_dateiname ? (
                <span className="text-[var(--fg)]">{v.geruest_dateiname}</span>
              ) : (
                "noch keine hinterlegt"
              )}
            </p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FELDER.map(({ feld, label }) => (
                <div key={feld} className="flex flex-col gap-1">
                  <Label htmlFor={`${v.programm}-${feld}`}>{label}</Label>
                  <Input
                    id={`${v.programm}-${feld}`}
                    defaultValue={(v[feld] as string | null) ?? ""}
                    placeholder="—"
                    disabled={!darfSchreiben}
                    onBlur={(e) => {
                      const wert = e.target.value.trim() || null;
                      if (wert !== ((v[feld] as string | null) ?? null)) {
                        aendern.mutate({
                          programm: v.programm,
                          felder: { [feld]: wert },
                        });
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
    </section>
  );
}
