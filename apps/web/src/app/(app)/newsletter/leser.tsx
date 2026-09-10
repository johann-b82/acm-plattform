"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, PencilLine } from "lucide-react";

import { newsletterApi, newsletterKeys, type Ausgabe } from "@/lib/newsletter";
import { alsPdf } from "@/lib/newsletter/pdf";
import { Button, EmptyState, Select } from "@/components/ui/primitives";
import { AusgabeAnsicht } from "./ausgabe-ansicht";
import { useBildUrls } from "./bild-urls";

/**
 * Newsletter lesen. Die Ausgabe wird als Folge von A4-Seiten gezeigt, und
 * genau diese Seiten setzt der PDF-Export — was am Bildschirm eine Seite ist,
 * ist im PDF eine.
 */
export function NewsletterLeser({ darfSchreiben }: { darfSchreiben: boolean }) {
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [pdfSeite, setPdfSeite] = useState<{ nr: number; gesamt: number } | null>(null);
  const seiten = useRef<HTMLDivElement>(null);

  const ausgaben = useQuery({
    queryKey: newsletterKeys.ausgaben(),
    queryFn: newsletterApi.ausgaben,
  });

  const liste = useMemo(() => ausgaben.data ?? [], [ausgaben.data]);
  const aktiv: Ausgabe | undefined =
    liste.find((a) => a.id === gewaehlt) ?? liste[0];

  const kapitel = useQuery({
    queryKey: newsletterKeys.kapitel(aktiv?.id ?? ""),
    queryFn: () => newsletterApi.kapitel(aktiv!.id),
    enabled: !!aktiv,
  });

  const urls = useBildUrls(aktiv, kapitel.data);

  const exportieren = async () => {
    if (!seiten.current || !aktiv) return;
    setPdfSeite({ nr: 0, gesamt: 0 });
    try {
      await alsPdf(
        seiten.current,
        `Newsletter_Q${aktiv.quartal}_${aktiv.jahr}.pdf`,
        (nr, gesamt) => setPdfSeite({ nr, gesamt }),
      );
    } catch (fehler) {
      toast.error((fehler as Error).message);
    } finally {
      setPdfSeite(null);
    }
  };

  if (ausgaben.isLoading) {
    return <p className="text-sm text-[var(--fg-muted)]">Wird geladen …</p>;
  }

  if (!aktiv) {
    return (
      <EmptyState
        title="Noch keine Ausgabe"
        body="Sobald die Redaktion eine Ausgabe veröffentlicht, steht sie hier."
        action={
          darfSchreiben ? (
            <Link href="/newsletter/redaktion">
              <Button>Zur Redaktion</Button>
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Newsletter</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {aktiv.titel || `Quartal ${aktiv.quartal} · ${aktiv.jahr}`}
            {aktiv.status === "entwurf" && " · Entwurf"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {liste.length > 1 && (
            <Select
              aria-label="Ausgabe"
              className="w-48"
              value={aktiv.id}
              onChange={(e) => setGewaehlt(e.target.value)}
            >
              {liste.map((a) => (
                <option key={a.id} value={a.id}>
                  Q{a.quartal} {a.jahr}
                  {a.status === "entwurf" ? " (Entwurf)" : ""}
                </option>
              ))}
            </Select>
          )}
          <Button variant="outline" onClick={exportieren} disabled={pdfSeite !== null}>
            <FileDown className="mr-2 h-4 w-4" aria-hidden />
            {pdfSeite === null
              ? "Als PDF"
              : pdfSeite.gesamt === 0
                ? "Wird gesetzt …"
                : `Seite ${pdfSeite.nr} von ${pdfSeite.gesamt} …`}
          </Button>
          {darfSchreiben && (
            <Link href="/newsletter/redaktion">
              <Button variant="outline">
                <PencilLine className="mr-2 h-4 w-4" aria-hidden />
                Redaktion
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div ref={seiten}>
        <AusgabeAnsicht ausgabe={aktiv} kapitel={kapitel.data ?? []} urls={urls} />
      </div>
    </div>
  );
}
