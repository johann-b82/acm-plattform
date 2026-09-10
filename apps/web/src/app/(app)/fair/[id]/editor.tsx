"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Maximize, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

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
import { Button, Card, Select } from "@/components/ui/primitives";
import { Zeichenflaeche } from "./zeichenflaeche";
import { BallonEbene } from "./ballon-ebene";
import { Ballonliste } from "./ballonliste";

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
 */
type Schritt =
  | { art: "ruht" }
  | { art: "zieht"; von: Punkt; bis: Punkt }
  | { art: "wartet_auf_blase"; bereich: Rechteck };

export function Editor({ id, darfSchreiben }: { id: string; darfSchreiben: boolean }) {
  const queryClient = useQueryClient();
  const fenster = useRef<HTMLDivElement>(null);

  const [ansicht, setAnsicht] = useState<Ansicht>({ skala: 1, tx: 0, ty: 0 });
  const [masse, setMasse] = useState<{ b: number; h: number } | null>(null);
  const [seite, setSeite] = useState(1);
  const [seiten, setSeiten] = useState(1);
  const [schritt, setSchritt] = useState<Schritt>({ art: "ruht" });
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [schiebt, setSchiebt] = useState<{ x: number; y: number } | null>(null);
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
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/fair"
          className="inline-flex items-center text-sm text-[var(--fg-muted)] underline-offset-4 hover:underline"
        >
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
          Zeichnungen
        </Link>
        <h1 className="text-lg font-semibold">{z.name}</h1>

        <div className="ml-auto flex items-center gap-1">
          {seiten > 1 && (
            <Select
              aria-label="Seite"
              className="w-28"
              value={seite}
              onChange={(e) => setSeite(Number(e.target.value))}
            >
              {Array.from({ length: seiten }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Seite {n}
                </option>
              ))}
            </Select>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Ansicht drehen"
            onClick={() => drehen.mutate(naechsteDrehung(drehung))}
            disabled={!darfSchreiben}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Verkleinern"
            onClick={() => setAnsicht((a) => zoomeUm(a, 0, 0, 1 / 1.3))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Vergrößern"
            onClick={() => setAnsicht((a) => zoomeUm(a, 0, 0, 1.3))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Einpassen" onClick={einpassenJetzt}>
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {darfSchreiben && (
        <p className="text-sm text-[var(--fg-muted)]">
          {schritt.art === "wartet_auf_blase"
            ? "Jetzt klicken, wo die Blase sitzen soll."
            : "Ein Feld über das Maß ziehen, dann klicken, wo die Blase sitzen soll. Rechte Maustaste verschiebt, Mausrad zoomt."}
        </p>
      )}

      <Card
        ref={fenster}
        className="relative h-[62vh] touch-none overflow-hidden bg-[var(--muted)]"
        onPointerDown={beiDruck}
        onPointerMove={beiBewegung}
        onPointerUp={beiLoslassen}
        onPointerLeave={beiLoslassen}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: schiebt ? "grabbing" : darfSchreiben ? "crosshair" : "default" }}
      >
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
        onWaehlen={(b) => {
          setGewaehlt(b.id);
          setSeite(b.seite);
        }}
      />
    </div>
  );
}
