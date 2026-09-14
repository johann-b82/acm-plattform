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
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenwerkzeuge } from "@/components/sidebar/werkzeugplatz";

/**
 * Newsletter lesen. Die Ausgabe wird als Folge von A4-Seiten gezeigt, und
 * genau diese Seiten setzt der PDF-Export — was am Bildschirm eine Seite ist,
 * ist im PDF eine.
 */
export function NewsletterLeser({ darfSchreiben }: { darfSchreiben: boolean }) {
  const worte = useTexte();
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
    return <p className="text-sm text-[var(--fg-muted)]">{worte.allgemein.laedt}</p>;
  }

  if (!aktiv) {
    return (
      <EmptyState
        title={worte.newsletter.keineAusgabe}
        body={worte.newsletter.keineAusgabeText}
        action={
          darfSchreiben ? (
            <Link href="/newsletter/redaktion">
              <Button>{worte.newsletter.zurRedaktion}</Button>
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{worte.pfad.seiten["/newsletter"]}</h2>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          {aktiv.titel || worte.newsletter.quartalJahr(aktiv.quartal, aktiv.jahr)}
          {aktiv.status === "entwurf" && worte.newsletter.entwurfSuffix}
        </p>
      </div>

      {/* Ausgabewahl, Export und Redaktion gelten für die ganze Seite: in der
          Schale stehen sie in der rechten Leiste. */}
      <Seitenwerkzeuge>
        <div className="flex flex-col items-stretch gap-2">
          {liste.length > 1 && (
            <Select
              aria-label={worte.newsletter.ausgabe}
              value={aktiv.id}
              onChange={(e) => setGewaehlt(e.target.value)}
            >
              {liste.map((a) => (
                <option key={a.id} value={a.id}>
                  {worte.newsletter.quartalKurz(a.quartal, a.jahr)}
                  {a.status === "entwurf" ? worte.newsletter.entwurfKlammer : ""}
                </option>
              ))}
            </Select>
          )}
          <Button variant="outline" onClick={exportieren} disabled={pdfSeite !== null}>
            <FileDown className="me-2 h-4 w-4" aria-hidden />
            {pdfSeite === null
              ? worte.newsletter.alsPdf
              : pdfSeite.gesamt === 0
                ? worte.newsletter.wirdGesetzt
                : worte.newsletter.seiteVon(pdfSeite.nr, pdfSeite.gesamt)}
          </Button>
          {darfSchreiben && (
            <Link href="/newsletter/redaktion">
              <Button variant="outline" className="w-full">
                <PencilLine className="me-2 h-4 w-4" aria-hidden />
                {worte.newsletter.redaktion}
              </Button>
            </Link>
          )}
        </div>
      </Seitenwerkzeuge>

      <div ref={seiten}>
        <AusgabeAnsicht ausgabe={aktiv} kapitel={kapitel.data ?? []} urls={urls} />
      </div>
    </div>
  );
}
