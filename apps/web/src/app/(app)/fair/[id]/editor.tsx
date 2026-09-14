"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CircleDot, Maximize, Minus, Plus, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

import { fairApi, fairKeys, type Ballon, type Drehung } from "@/lib/fair";
import {
  begrenze01,
  drehungCss,
  einpassen,
  gedrehteMasse,
  naechsteDrehung,
  rechteckAusEcken,
  runde6,
  zoomeUm,
  zuNormiert,
  type Ansicht,
  type Punkt,
  type Rechteck,
} from "@/lib/fair/geometrie";
import {
  BALLON_GROESSE_MAX,
  BALLON_GROESSE_MIN,
  groesser,
  kleiner,
  useBallonGroesse,
} from "@/lib/fair/ballon-groesse";
import { beendeOcr, liesFeld } from "@/lib/fair/ocr";
import { Button, ButtonLink, Card, Select } from "@/components/ui/primitives";
import { Zeichenflaeche } from "./zeichenflaeche";
import { BallonEbene } from "./ballon-ebene";
import { Ballonliste } from "./ballonliste";
import { Projektkopf, type Kopffeld } from "./projektkopf";
import { feldAlsLeinwand, seitenAlsBilder } from "./raster";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenwerkzeuge, Werkzeug } from "@/components/sidebar/werkzeugplatz";

/**
 * Der Editor: Zeichnung anzeigen, Bereiche markieren, Ballons setzen.
 *
 * Ein Ballon entsteht in zwei Schritten — erst das Feld über dem Maß
 * aufziehen, dann klicken, wo die Blase sitzen soll. Die Nummer kommt von der
 * Datenbank zurück; hier wird keine gezählt.
 *
 * Zoom und Verschieben liegen als eine Transformation über Zeichnung und
 * Ballonebene gemeinsam. Dadurch stimmen die Koordinaten von selbst, und die
 * PDF-Leinwand muss beim Zoomen nicht neu gerastert werden.
 *
 * Die Prüfliste steht rechts neben der Zeichnung (FAI-02), auf schmalen
 * Bildschirmen darunter. Die Zeichnung bleibt dabei stehen, während man
 * durch eine lange Liste blättert.
 */
type Schritt =
  | { art: "ruht" }
  | { art: "zieht"; von: Punkt; bis: Punkt }
  | { art: "wartet_auf_blase"; bereich: Rechteck };

/** Nur Zeichen, die jedes Dateisystem als Dateinamen annimmt. */
function dateiname(text: string): string {
  return text.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "zeichnung";
}

export function Editor({ id, darfSchreiben }: { id: string; darfSchreiben: boolean }) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const fenster = useRef<HTMLDivElement>(null);

  const [ansicht, setAnsicht] = useState<Ansicht>({ skala: 1, tx: 0, ty: 0 });
  const [masse, setMasse] = useState<{ b: number; h: number } | null>(null);
  const [seite, setSeite] = useState(1);
  const [seiten, setSeiten] = useState(1);
  const [schritt, setSchritt] = useState<Schritt>({ art: "ruht" });
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [schiebt, setSchiebt] = useState<{ x: number; y: number } | null>(null);
  const [groesse, setGroesse] = useBallonGroesse();
  const [pdfLaeuft, setPdfLaeuft] = useState(false);
  const eingepasst = useRef(false);

  const zeichnung = useQuery({
    queryKey: fairKeys.zeichnung(id),
    queryFn: () => fairApi.zeichnung(id),
  });
  const z = zeichnung.data;

  const datei = useQuery({
    queryKey: fairKeys.datei(z?.pfad ?? ""),
    queryFn: () => fairApi.dateiUrl(z!.pfad),
    enabled: !!z,
    // Die signierte URL gilt eine Stunde; sie vorher neu zu holen hiesse, die
    // Zeichnung mitten in der Arbeit neu zu laden.
    staleTime: 50 * 60 * 1000,
  });

  const ballonAbfrage = useQuery({
    queryKey: fairKeys.ballons(id),
    queryFn: () => fairApi.ballons(id),
  });
  const alleBallons = ballonAbfrage.data ?? [];
  const ballons = alleBallons.filter((b) => b.seite === seite);

  const neuLaden = () =>
    queryClient.invalidateQueries({ queryKey: fairKeys.ballons(id) });

  const setzen = useMutation({
    mutationFn: (b: Parameters<typeof fairApi.ballonSetzen>[1]) =>
      fairApi.ballonSetzen(id, b),
    onSuccess: async (neu: Ballon) => {
      setGewaehlt(neu.id);
      await neuLaden();
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const drehen = useMutation({
    mutationFn: (d: Drehung) => fairApi.zeichnungAendern(id, { drehung: d }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fairKeys.zeichnung(id) }),
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const kopfAendern = useMutation({
    mutationFn: ({ feld, wert }: { feld: Kopffeld; wert: string | null }) =>
      fairApi.zeichnungAendern(id, { [feld]: wert }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: fairKeys.zeichnung(id) }),
        queryClient.invalidateQueries({ queryKey: fairKeys.zeichnungen() }),
      ]),
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const drehung: Drehung = z?.drehung ?? 0;
  // Was das Fenster sieht: die gedrehten Maße. Die Ballons liegen darunter
  // immer kanonisch — ein Drehen der Ansicht ist keine Datenänderung.
  const sicht = masse ? gedrehteMasse(masse.b, masse.h, drehung) : null;

  const einpassenJetzt = useCallback(() => {
    const el = fenster.current;
    if (!el || !sicht) return;
    setAnsicht(einpassen(el.clientWidth, el.clientHeight, sicht.b, sicht.h));
  }, [sicht]);

  // Einmal einpassen, sobald die Maße bekannt sind — danach nicht mehr, sonst
  // springt die Ansicht bei jedem Nachladen zurück.
  useLayoutEffect(() => {
    if (sicht && !eingepasst.current) {
      eingepasst.current = true;
      einpassenJetzt();
    }
  }, [sicht, einpassenJetzt]);

  // Das Mausrad zoomt statt zu scrollen. Als eigener Lauscher mit
  // `passive: false`, weil React seine Rad-Ereignisse passiv anmeldet und
  // `preventDefault` dort nichts täte.
  useEffect(() => {
    const el = fenster.current;
    if (!el) return;
    const beiRad = (e: WheelEvent) => {
      e.preventDefault();
      const kasten = el.getBoundingClientRect();
      setAnsicht((a) =>
        zoomeUm(
          a,
          e.clientX - kasten.left,
          e.clientY - kasten.top,
          e.deltaY < 0 ? 1.15 : 1 / 1.15,
        ),
      );
    };
    el.addEventListener("wheel", beiRad, { passive: false });
    return () => el.removeEventListener("wheel", beiRad);
  }, []);

  // Der OCR-Arbeiter lebt so lange wie der Editor.
  useEffect(() => beendeOcr, []);

  /** OCR für eine Zeile: das gespeicherte Feld frisch aus der Datei lesen. */
  const ocr = useCallback(
    async (b: Ballon): Promise<string> => {
      if (!z || !datei.data) throw new Error(worte.fair.ladefehler);
      const feld = await feldAlsLeinwand(datei.data, z.art, b.seite, {
        x: b.bereich_x,
        y: b.bereich_y,
        b: b.bereich_b,
        h: b.bereich_h,
      });
      return liesFeld(feld);
    },
    [z, datei.data, worte],
  );

  const pdfErstellen = async () => {
    if (!z || !datei.data) return;
    setPdfLaeuft(true);
    try {
      // jsPDF erst laden, wenn jemand ein PDF will.
      const [{ pruefberichtPdf }, bilder] = await Promise.all([
        import("@/lib/fair/pdf"),
        seitenAlsBilder(datei.data, z.art, drehung),
      ]);
      pruefberichtPdf({
        name: z.name,
        kopf: [
          [worte.fair.kunde, z.kunde],
          [worte.fair.artikelnummer, z.artikelnummer],
          [worte.fair.pn, z.teilenummer],
        ],
        spalten: { nr: worte.fair.nr, seite: worte.fair.seite, wert: worte.fair.wert },
        pruefliste: worte.fair.pruefliste,
        seiten: bilder,
        ballons: alleBallons,
        drehung,
        groesse,
      }).save(`${dateiname(z.teilenummer || z.name)}_balloniert.pdf`);
    } catch (fehler) {
      toast.error(worte.fair.pdfFehler(fehler instanceof Error ? fehler.message : String(fehler)));
    } finally {
      setPdfLaeuft(false);
    }
  };

  /** Zeigerposition → kanonischer, normierter Punkt. */
  const punkt = useCallback(
    (e: { clientX: number; clientY: number }): Punkt | null => {
      const el = fenster.current;
      if (!el || !sicht || !masse) return null;
      const kasten = el.getBoundingClientRect();
      const imKasten = zuNormiert(
        e.clientX - kasten.left,
        e.clientY - kasten.top,
        ansicht,
        sicht.b,
        sicht.h,
      );
      // Aus der gedrehten Ansicht zurück in kanonische Koordinaten.
      if (drehung === 0) return imKasten;
      const rx = imKasten.x * sicht.b;
      const ry = imKasten.y * sicht.h;
      const k =
        drehung === 90
          ? { x: ry, y: sicht.b - rx }
          : drehung === 180
            ? { x: sicht.b - rx, y: sicht.h - ry }
            : { x: sicht.h - ry, y: rx };
      return { x: begrenze01(k.x / masse.b), y: begrenze01(k.y / masse.h) };
    },
    [ansicht, sicht, masse, drehung],
  );

  const beiDruck = (e: React.PointerEvent) => {
    // Rechte Taste und mittlere schieben — wie in einem CAD-Betrachter.
    if (e.button !== 0) {
      e.preventDefault();
      setSchiebt({ x: e.clientX - ansicht.tx, y: e.clientY - ansicht.ty });
      return;
    }
    if (!darfSchreiben) return;
    const p = punkt(e);
    if (!p) return;

    if (schritt.art === "wartet_auf_blase") {
      const b = schritt.bereich;
      setzen.mutate({
        seite,
        bereich_x: runde6(b.x),
        bereich_y: runde6(b.y),
        bereich_b: runde6(b.b),
        bereich_h: runde6(b.h),
        blase_x: runde6(p.x),
        blase_y: runde6(p.y),
      });
      setSchritt({ art: "ruht" });
      return;
    }
    setSchritt({ art: "zieht", von: p, bis: p });
  };

  const beiBewegung = (e: React.PointerEvent) => {
    if (schiebt) {
      setAnsicht((a) => ({ ...a, tx: e.clientX - schiebt.x, ty: e.clientY - schiebt.y }));
      return;
    }
    if (schritt.art !== "zieht") return;
    const p = punkt(e);
    if (p) setSchritt({ ...schritt, bis: p });
  };

  const beiLoslassen = () => {
    if (schiebt) {
      setSchiebt(null);
      return;
    }
    if (schritt.art !== "zieht") return;
    const bereich = rechteckAusEcken(schritt.von, schritt.bis);
    // Ein Klick ohne Ziehen ist kein Feld. Ohne diese Schwelle entstünde bei
    // jedem versehentlichen Klick ein Ballon mit unsichtbarem Bereich.
    if (bereich.b < 0.004 || bereich.h < 0.002) {
      setSchritt({ art: "ruht" });
      return;
    }
    setSchritt({ art: "wartet_auf_blase", bereich });
  };

  const vorschau =
    schritt.art === "zieht"
      ? rechteckAusEcken(schritt.von, schritt.bis)
      : schritt.art === "wartet_auf_blase"
        ? schritt.bereich
        : null;

  if (zeichnung.isLoading) {
    return <p className="text-sm text-[var(--fg-muted)]">Wird geladen …</p>;
  }
  if (!z) {
    return <p className="text-sm text-[var(--fg-muted)]">Zeichnung nicht gefunden.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Rückweg und Zeichenwerkzeuge gelten für die ganze Zeichnung: in der
          Schale stehen sie in der rechten Leiste, die Fläche behält die Breite. */}
      <Seitenwerkzeuge kategorie="navigation">
        <ButtonLink href="/fair" variant="outline">
          <ArrowLeft className="me-2 h-4 w-4 rtl:rotate-180" aria-hidden />
          Zeichnungen
        </ButtonLink>
      </Seitenwerkzeuge>
      <Seitenwerkzeuge kategorie="ansicht">
        <div className="flex flex-col items-stretch gap-2">
          {seiten > 1 && (
            <Werkzeug titel={worte.fair.seite}>
            <Select
              aria-label={worte.fair.seite}
              value={seite}
              onChange={(e) => setSeite(Number(e.target.value))}
            >
              {Array.from({ length: seiten }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Seite {n}
                </option>
              ))}
            </Select>
            </Werkzeug>
          )}
          <Werkzeug titel={worte.fair.darstellung}>
          <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={worte.fair.drehen}
            onClick={() => drehen.mutate(naechsteDrehung(drehung))}
            disabled={!darfSchreiben}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={worte.fair.verkleinern}
            onClick={() => setAnsicht((a) => zoomeUm(a, 0, 0, 1 / 1.3))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={worte.fair.vergroessern}
            onClick={() => setAnsicht((a) => zoomeUm(a, 0, 0, 1.3))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={worte.fair.einpassen} onClick={einpassenJetzt}>
            <Maximize className="h-4 w-4" />
          </Button>
          </div>
          </Werkzeug>

          {/* Bubblegröße (FAI-04): eigenes Paar, unabhängig vom Zoom. */}
          <Werkzeug titel={worte.fair.bubbleGroesse}>
          <div className="flex items-center gap-1">
          <CircleDot className="h-4 w-4 text-[var(--fg-muted)]" aria-hidden />
          <Button
            variant="ghost"
            size="icon"
            aria-label={worte.fair.bubblesKleiner}
            title={worte.fair.bubblesKleiner}
            disabled={groesse <= BALLON_GROESSE_MIN}
            onClick={() => setGroesse(kleiner)}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={worte.fair.bubblesGroesser}
            title={worte.fair.bubblesGroesser}
            disabled={groesse >= BALLON_GROESSE_MAX}
            onClick={() => setGroesse(groesser)}
          >
            <Plus className="h-4 w-4" />
          </Button>
          </div>
          </Werkzeug>
        </div>
      </Seitenwerkzeuge>

      <h2 className="text-lg font-semibold">{z.name}</h2>

      <Projektkopf
        werte={z}
        darfSchreiben={darfSchreiben}
        onSpeichern={(feld, wert) => kopfAendern.mutate({ feld, wert })}
      />

      {darfSchreiben && (
        <p className="text-sm text-[var(--fg-muted)]">
          {schritt.art === "wartet_auf_blase"
            ? "Jetzt klicken, wo die Blase sitzen soll."
            : "Ein Feld über das Maß ziehen, dann klicken, wo die Blase sitzen soll. Rechte Maustaste verschiebt, Mausrad zoomt."}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_30rem]">
        <Card
          ref={fenster}
          className="relative h-[62vh] touch-none overflow-hidden bg-[var(--muted)] lg:sticky lg:top-4 lg:h-[78vh]"
          onPointerDown={beiDruck}
          onPointerMove={beiBewegung}
          onPointerUp={beiLoslassen}
          onPointerLeave={beiLoslassen}
          onContextMenu={(e) => e.preventDefault()}
          style={{ cursor: schiebt ? "grabbing" : darfSchreiben ? "crosshair" : "default" }}
        >
          {datei.isError && (
            // Ohne diesen Hinweis bliebe die Fläche einfach weiß, und niemand
            // wüsste, ob die Zeichnung fehlt oder das Laden noch läuft.
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <p className="max-w-prose text-center text-sm text-[var(--fg-muted)]">
                {worte.fair.dateiFehlt((datei.error as Error).message)}
              </p>
            </div>
          )}
          {datei.data && (
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                transform: `translate(${ansicht.tx}px, ${ansicht.ty}px) scale(${ansicht.skala})`,
              }}
            >
              <div
                className="relative origin-top-left"
                style={{ transform: masse ? drehungCss(masse.b, masse.h, drehung) : undefined }}
              >
                <Zeichenflaeche
                  url={datei.data}
                  art={z.art}
                  seite={seite}
                  breite={masse?.b ?? null}
                  hoehe={masse?.h ?? null}
                  renderDpr={Math.min(4, Math.max(1, ansicht.skala))}
                  onMasse={setMasse}
                  onSeiten={setSeiten}
                />
                {masse && (
                  <BallonEbene
                    ballons={ballons}
                    breite={masse.b}
                    hoehe={masse.h}
                    groesse={groesse}
                    hervorgehoben={gewaehlt}
                    vorschau={vorschau}
                    onWaehlen={setGewaehlt}
                  />
                )}
              </div>
            </div>
          )}
        </Card>

        <Ballonliste
          zeichnungId={id}
          ballons={alleBallons}
          gewaehlt={gewaehlt}
          darfSchreiben={darfSchreiben}
          mehrereSeiten={seiten > 1}
          pdfLaeuft={pdfLaeuft}
          onWaehlen={(b) => {
            setGewaehlt(b.id);
            setSeite(b.seite);
          }}
          onOcr={ocr}
          onPdf={() => void pdfErstellen()}
        />
      </div>
    </div>
  );
}
