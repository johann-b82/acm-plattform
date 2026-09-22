"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CircleDot, Maximize, Minus, Plus, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

import { fairApi, fairKeys, type Ballon, type Drehung } from "@/lib/fair";
import {
  begrenze01,
  bevorzugteDrehung,
  drehungCss,
  einpassen,
  gedrehteMasse,
  inDrehung,
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
import { beendeOcr, liesFeld, normalisiereMass, type OcrModus } from "@/lib/fair/ocr";
import { Button, ButtonLink, Card, Select } from "@/components/ui/primitives";
import { BallonEbene } from "./ballon-ebene";
import { Ballonliste } from "./ballonliste";
import { Projektkopf, type Kopffeld } from "./projektkopf";
import { OcrKorrektur } from "./ocr-korrektur";
import { useTexte } from "@/components/sprache/anbieter";
import { Seitenwerkzeuge, Werkzeug } from "@/components/sidebar/werkzeugplatz";

// react-pdf/pdfjs fasst schon beim Laden Browser-Globals an (`DOMMatrix`) und
// würde beim Serverrendern werfen (500 auf der ganzen Route). Deshalb lädt die
// PDF-Leinwand nur im Browser; die Rasterhelfer (`./raster`) importieren pdfjs
// ebenso und werden darum erst in den Handlern nachgeladen.
const Zeichenflaeche = dynamic(
  () => import("./zeichenflaeche").then((m) => m.Zeichenflaeche),
  { ssr: false },
);

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
  // Das Feld ist gezogen, die OCR läuft. Die Blase kann erst gesetzt werden,
  // wenn die Vermutung da ist — sie kommt mit dem zweiten Klick mit.
  | { art: "liest"; bereich: Rechteck; bevorzugt: Drehung }
  | { art: "wartet_auf_blase"; bereich: Rechteck; wert: string; bevorzugt: Drehung };

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
  // Das zuletzt markierte, gerasterte Feld — für erneutes Lesen als „Maß"/„Text"
  // aus demselben Ausschnitt, ohne ihn neu aus der Datei zu holen.
  const ocrFeld = useRef<{ leinwand: HTMLCanvasElement; bevorzugt: Drehung } | null>(null);
  const [prueftNeu, setPrueftNeu] = useState(false);
  // Während eine Blase gezogen wird, folgt sie hier lokal, bis das Speichern
  // zurück ist — sonst spränge sie kurz auf die alte Lage.
  const [zug, setZug] = useState<Record<string, Punkt>>({});

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
    // Fehlt das Objekt im Speicher (Sign-Aufruf → 400), ist das kein flüchtiger
    // Fehler: nicht wiederholen, sondern sofort „Datei fehlt" zeigen statt einer
    // weißen Fläche, die wie ein Ladehänger aussieht.
    retry: false,
  });

  const ballonAbfrage = useQuery({
    queryKey: fairKeys.ballons(id),
    queryFn: () => fairApi.ballons(id),
  });
  const alleBallons = ballonAbfrage.data ?? [];
  const ballons = alleBallons
    .filter((b) => b.seite === seite)
    // Eine gerade gezogene Blase folgt lokal, bis das Speichern zurück ist.
    .map((b) => {
      const o = zug[b.id];
      return o ? { ...b, blase_x: o.x, blase_y: o.y } : b;
    });

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

  const blaseAendern = useMutation({
    mutationFn: ({ id: bid, p }: { id: string; p: Punkt }) =>
      fairApi.ballonAendern(bid, { blase_x: runde6(p.x), blase_y: runde6(p.y) }),
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  // Die entdeckte Seitenzahl einmal festhalten, damit die Liste nicht ewig
  // „1 Seite" zeigt. Nur Schreibende dürfen die Zeile ändern.
  const seitenSpeichern = useMutation({
    mutationFn: (n: number) => fairApi.zeichnungAendern(id, { seiten: n }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: fairKeys.zeichnung(id) }),
        queryClient.invalidateQueries({ queryKey: fairKeys.zeichnungen() }),
      ]),
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
    // Abhängig von `z`: beim ersten Rendern steht der Editor noch im
    // Ladezustand, die Fläche (und `fenster.current`) gibt es noch nicht. Sobald
    // die Zeichnung da ist, rendert die Karte und der Lauscher wird nachgezogen.
  }, [z]);

  // Der OCR-Arbeiter lebt so lange wie der Editor.
  useEffect(() => beendeOcr, []);

  // Escape bricht eine laufende Markierung ab und hebt die Auswahl auf.
  useEffect(() => {
    const beiTaste = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSchritt({ art: "ruht" });
      setGewaehlt(null);
    };
    window.addEventListener("keydown", beiTaste);
    return () => window.removeEventListener("keydown", beiTaste);
  }, []);

  // Sobald die echte Seitenzahl feststeht, in der Zeile festhalten (einmal, die
  // invalidierte Abfrage bringt danach denselben Wert und der Effekt ruht).
  useEffect(() => {
    if (darfSchreiben && z && seiten > 0 && seiten !== z.seiten) {
      seitenSpeichern.mutate(seiten);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seiten, z?.seiten, darfSchreiben]);

  /** OCR für eine Zeile: das gespeicherte Feld frisch aus der Datei lesen. */
  const ocr = useCallback(
    async (b: Ballon): Promise<string> => {
      if (!z || !datei.data) throw new Error(worte.fair.ladefehler);
      const bereich = { x: b.bereich_x, y: b.bereich_y, b: b.bereich_b, h: b.bereich_h };
      const { feldAlsLeinwand, textImBereich } = await import("./raster");
      // Echter PDF-Text schlägt OCR — exakt statt geraten.
      if (z.art === "pdf") {
        const t = await textImBereich(datei.data, b.seite, bereich);
        if (t) return normalisiereMass(t);
      }
      const feld = await feldAlsLeinwand(datei.data, z.art, b.seite, bereich);
      return liesFeld(feld);
    },
    [z, datei.data, worte],
  );

  /** Nach dem Markieren: die Stelle scharf rastern, lesen und die Vermutung ins
   *  schwebende Feld stellen. Der zweite Klick übernimmt sie mit der Blase. */
  const liesBereich = useCallback(
    async (bereich: Rechteck, bevorzugt: Drehung) => {
      let wert = "";
      try {
        if (z && datei.data) {
          const { feldAlsLeinwand, textImBereich } = await import("./raster");
          // Trägt die PDF-Zeichnung echten Text im Feld, gilt der — ohne OCR.
          if (z.art === "pdf") {
            const t = await textImBereich(datei.data, seite, bereich);
            if (t) wert = normalisiereMass(t);
          }
          // Den Ausschnitt trotzdem rastern und behalten: für „Maß"/„Text" und
          // als Rückfall, wenn kein Text da war (Scan).
          const feld = await feldAlsLeinwand(datei.data, z.art, seite, bereich);
          ocrFeld.current = { leinwand: feld, bevorzugt };
          if (!wert) wert = await liesFeld(feld, bevorzugt, "auto");
        }
      } catch {
        // Eine misslungene Lesung ist kein Grund zu scheitern — Feld bleibt leer.
        ocrFeld.current = null;
      }
      // Nur übernehmen, wenn zwischenzeitlich nicht abgebrochen wurde (Escape).
      setSchritt((s) =>
        s.art === "liest" ? { art: "wartet_auf_blase", bereich, wert, bevorzugt } : s,
      );
    },
    [z, datei.data, seite],
  );

  /** Dieselbe markierte Stelle erneut lesen — als Maß (nur Ziffern) oder Text. */
  const neuLesen = useCallback(async (modus: OcrModus) => {
    const feld = ocrFeld.current;
    if (!feld) return;
    setPrueftNeu(true);
    try {
      const wert = await liesFeld(feld.leinwand, feld.bevorzugt, modus);
      setSchritt((s) => (s.art === "wartet_auf_blase" ? { ...s, wert } : s));
    } finally {
      setPrueftNeu(false);
    }
  }, []);

  /** Eine Blase verschieben: erst nur lokal folgen, beim Loslassen speichern. */
  const ballonZiehen = useCallback(
    (bid: string, p: Punkt, speichern: boolean) => {
      setZug((o) => ({ ...o, [bid]: p }));
      if (!speichern) return;
      blaseAendern.mutate(
        { id: bid, p },
        {
          onSuccess: () => neuLaden(),
          onSettled: () =>
            setZug((o) => {
              const n = { ...o };
              delete n[bid];
              return n;
            }),
        },
      );
    },
    // `neuLaden` ist eine stabile Closure über den Query-Client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blaseAendern],
  );

  const pdfErstellen = async () => {
    if (!z || !datei.data) return;
    setPdfLaeuft(true);
    try {
      // Die schweren Bausteine erst laden, wenn jemand ein PDF will.
      const [{ ballonierteZeichnung, haengePdfAn, speicherePdf }, { prueflistePdf }] =
        await Promise.all([import("@/lib/fair/ballon-pdf"), import("@/lib/fair/pdf")]);
      // Die Originalbytes: die PDF-Seite kommt vektortreu hinein, ein Bild nativ.
      const quelle = await (await fetch(datei.data)).arrayBuffer();
      const doc = await ballonierteZeichnung({
        quelle,
        art: z.art,
        ballons: alleBallons,
        drehung,
        groesse,
      });
      const liste = prueflistePdf({
        name: z.name,
        kopf: [
          [worte.fair.kunde, z.kunde],
          [worte.fair.artikelnummer, z.artikelnummer],
          [worte.fair.pn, z.teilenummer],
        ],
        spalten: { nr: worte.fair.nr, seite: worte.fair.seite, wert: worte.fair.wert },
        pruefliste: worte.fair.pruefliste,
        ballons: alleBallons,
      });
      await haengePdfAn(doc, liste.output("arraybuffer"));
      await speicherePdf(doc, `${dateiname(z.teilenummer || z.name)}_balloniert.pdf`);
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
    // Rechte Taste und mittlere schieben — wie in einem CAD-Betrachter. Den
    // Zeiger fangen, damit das Schieben nicht abreißt, wenn er die Fläche
    // verlässt.
    if (e.button !== 0) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
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
        // Der beim Markieren gelesene Wert kommt mit — kein leeres Feld.
        wert: schritt.wert,
      });
      setSchritt({ art: "ruht" });
      return;
    }
    // Während die OCR läuft, keinen neuen Zug beginnen.
    if (schritt.art !== "ruht") return;
    // Den Zeiger fangen, damit das Aufziehen am Zeichnungsrand nicht abreißt.
    e.currentTarget.setPointerCapture(e.pointerId);
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

  const beiLoslassen = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* war nicht gefangen */
    }
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
    // Das Feld steht — jetzt lesen. Die Blase folgt mit dem nächsten Klick.
    const bevorzugt = bevorzugteDrehung(schritt.von, schritt.bis);
    setSchritt({ art: "liest", bereich, bevorzugt });
    void liesBereich(bereich, bevorzugt);
  };

  const vorschau =
    schritt.art === "zieht"
      ? rechteckAusEcken(schritt.von, schritt.bis)
      : schritt.art === "wartet_auf_blase" || schritt.art === "liest"
        ? schritt.bereich
        : null;

  // Bildschirmanker der schwebenden Korrekturbox: die Mitte des markierten
  // Felds, kanonisch → gedrehter Kasten → Bildschirm.
  const ocrAnker = (() => {
    if (!masse) return null;
    if (schritt.art !== "liest" && schritt.art !== "wartet_auf_blase") return null;
    const b = schritt.bereich;
    const r = inDrehung(
      (b.x + b.b / 2) * masse.b,
      (b.y + b.h / 2) * masse.h,
      masse.b,
      masse.h,
      drehung,
    );
    return { x: r.x * ansicht.skala + ansicht.tx, y: r.y * ansicht.skala + ansicht.ty };
  })();

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
          {schritt.art === "liest"
            ? worte.fair.liest
            : schritt.art === "wartet_auf_blase"
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
          // Kein Abbruch beim Verlassen: der gefangene Zeiger führt die Geste
          // weiter. Nur ein echter Abbruch (z. B. Systemgeste) beendet sie.
          onPointerCancel={beiLoslassen}
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
                    darfSchreiben={darfSchreiben}
                    onWaehlen={setGewaehlt}
                    zuPunkt={punkt}
                    onZiehen={ballonZiehen}
                  />
                )}
              </div>
            </div>
          )}

          {ocrAnker && (schritt.art === "liest" || schritt.art === "wartet_auf_blase") && (
            <OcrKorrektur
              x={ocrAnker.x}
              y={ocrAnker.y}
              wert={schritt.art === "wartet_auf_blase" ? schritt.wert : ""}
              liest={schritt.art === "liest"}
              prueftNeu={prueftNeu}
              onWert={(v) =>
                setSchritt((s) => (s.art === "wartet_auf_blase" ? { ...s, wert: v } : s))
              }
              onNeuLesen={(modus) => void neuLesen(modus)}
              onAbbrechen={() => setSchritt({ art: "ruht" })}
            />
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
