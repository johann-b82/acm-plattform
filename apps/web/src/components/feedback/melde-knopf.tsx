"use client";

import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { feedbackApi } from "@/lib/feedback";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Der Melde-Knopf, der in jeder angemeldeten Ansicht unten rechts sitzt.
 *
 * Der Dialog geht sofort auf, die Aufnahme läuft daneben weiter. Gemessen
 * braucht sie auf einer Seite mit Diagramm mehrere Sekunden — so lange auf
 * einen Knopfdruck hin gar nichts zu zeigen, wäre die Meldung nicht wert.
 * Getippt wird in der Zeit ohnehin.
 *
 * Aufgenommen wird der Stand, den die Seite beim Klick hatte: der Dialog ist
 * zu diesem Zeitpunkt noch leer, und die eigenen Bedienelemente tragen
 * `data-feedback-ui` und fallen aus der Aufnahme.
 *
 * Die Aufnahme ist freiwillig. Schlägt sie fehl, geht der Bericht ohne Bild —
 * ein Bericht ohne Bild ist besser als keiner, und die Beschreibung ist
 * ohnehin das, was zählt.
 */
export function MeldeKnopf() {
  const t = useTexte();
  const [offen, setOffen] = useState(false);
  const [nimmtAuf, setNimmtAuf] = useState(false);
  const [beschreibung, setBeschreibung] = useState("");
  const [bild, setBild] = useState<Blob | null>(null);
  const [bildUrl, setBildUrl] = useState<string | null>(null);
  const [aufnahmeMisslungen, setAufnahmeMisslungen] = useState(false);

  const aufraeumen = useCallback(() => {
    setBeschreibung("");
    setBild(null);
    setBildUrl((alt) => {
      if (alt) URL.revokeObjectURL(alt);
      return null;
    });
    setAufnahmeMisslungen(false);
  }, []);

  const oeffnen = useCallback(() => {
    aufraeumen();
    setNimmtAuf(true);
    setOffen(true);

    void (async () => {
      try {
        // Erst beim Öffnen laden: das Paket wiegt mehr als die ganze Ansicht,
        // und die meisten Sitzungen melden nie etwas.
        const { toCanvas } = await import("html-to-image");
        const grund = getComputedStyle(document.body).backgroundColor || "#ffffff";
        // Nur der sichtbare Ausschnitt, nicht das ganze Dokument. Auf einer
        // Seite mit langer Tabelle machte die Tabelle sonst neunzehn
        // Zwanzigstel des Bildes aus, und das, worauf der Melder gerade
        // schaut, war ein unlesbarer Streifen. Der Versatz schiebt die
        // Bildfläche auf die Scrollposition.
        const leinwand = await toCanvas(document.body, {
          pixelRatio: 1,
          backgroundColor: grund,
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
          style: {
            transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
            transformOrigin: "top left",
          },
          // Schriften nicht einbetten: das ist der teuerste Schritt, und die
          // Aufnahme entsteht im selben Browser, der die Schriften schon hat.
          skipFonts: true,
          filter: (knoten) =>
            !(knoten instanceof HTMLElement && knoten.dataset.feedbackUi === "true"),
        });
        // Über die Leinwand, nicht über `toBlob`: dessen `type` wird nicht
        // beachtet, und ein PNG einer vollen Ansicht wiegt schnell zwei
        // Megabyte. Als JPEG sind es rund zweihundert Kilobyte.
        const aufnahme = await new Promise<Blob | null>((fertig) =>
          leinwand.toBlob(fertig, "image/jpeg", 0.85),
        );
        if (!aufnahme) throw new Error("keine Aufnahme");
        setBild(aufnahme);
        setBildUrl(URL.createObjectURL(aufnahme));
      } catch {
        setAufnahmeMisslungen(true);
      } finally {
        setNimmtAuf(false);
      }
    })();
  }, [aufraeumen]);

  const senden = useMutation({
    mutationFn: () =>
      feedbackApi.melden({
        seite: window.location.pathname + window.location.search,
        beschreibung: beschreibung.trim(),
        browser: navigator.userAgent,
        ansicht: `${window.innerWidth}×${window.innerHeight}`,
        bild,
      }),
    onSuccess: ({ mitBild }) => {
      toast.success(
        mitBild
          ? t.melden.dankeMitBild
          : t.melden.dankeOhneBild,
      );
      setOffen(false);
      aufraeumen();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  return (
    <>
      <div data-feedback-ui="true" className="fixed bottom-4 end-4 z-40">
        <Button variant="outline" onClick={oeffnen} className="shadow-sm">
          <MessageSquareWarning className="me-2 h-4 w-4" aria-hidden />
          {t.melden.knopf}
        </Button>
      </div>

      <div data-feedback-ui="true">
        <Dialog
          open={offen}
          onOpenChange={(o) => {
            setOffen(o);
            if (!o) aufraeumen();
          }}
          title={t.melden.titel}
          description={t.melden.frage}
          footer={
            <>
              <Button variant="outline" onClick={() => setOffen(false)}>
                {t.melden.abbrechen}
              </Button>
              <Button
                onClick={() => senden.mutate()}
                disabled={!beschreibung.trim() || senden.isPending || nimmtAuf}
              >
                {senden.isPending ? t.melden.sendet : t.melden.senden}
              </Button>
            </>
          }
        >
          <Textarea
            value={beschreibung}
            onChange={(e) => setBeschreibung(e.target.value)}
            rows={5}
            autoFocus
            placeholder={t.melden.beispiel}
            aria-label={t.melden.beschreibung}
          />
          {bildUrl && (
            <figure className="m-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bildUrl}
                alt={t.melden.aufnahme}
                className="max-h-48 w-full rounded-md border border-[var(--border)] object-contain"
              />
              <figcaption className="mt-1 text-xs text-[var(--fg-muted)]">
                {t.melden.gehtMit}
              </figcaption>
            </figure>
          )}
          {nimmtAuf && (
            <p className="text-xs text-[var(--fg-muted)]">
              {t.melden.nimmtAuf}
            </p>
          )}
          {aufnahmeMisslungen && (
            <p className="text-xs text-[var(--fg-muted)]">
              {t.melden.misslungen}
            </p>
          )}
        </Dialog>
      </div>
    </>
  );
}
