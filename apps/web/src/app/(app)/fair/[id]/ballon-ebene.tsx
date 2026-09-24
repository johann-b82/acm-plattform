"use client";

import { useRef } from "react";

import { FARBEN, ballonPixel, type Punkt } from "@/lib/fair/geometrie";
import type { Ballon } from "@/lib/fair";

/**
 * Die Ballons über der Zeichnung, als ein SVG in kanonischen Seitenpixeln.
 *
 * Die Ebene liegt unter derselben Transformation wie die Zeichnung, also
 * stimmen die Koordinaten ohne weiteres Zutun. Nicht skaliert wird die
 * Strichstärke: die soll beim Zoomen dünn bleiben, sonst wird der Pfeil zum
 * Balken. Deshalb `vectorEffect="non-scaling-stroke"`.
 *
 * Das SVG selbst nimmt keine Zeiger an (`pointerEvents: none`), nur die Blasen —
 * so erreicht ein Klick zum Setzen einer neuen Blase die Fläche auch dann, wenn
 * er über einem bestehenden Ballon liegt. Die Blase ist zugleich der Ziehgriff:
 * Ziehen verschiebt sie (der Pfeil zielt von selbst nach), Loslassen speichert.
 */
export function BallonEbene({
  ballons,
  breite,
  hoehe,
  groesse,
  hervorgehoben,
  vorschau,
  darfSchreiben,
  onWaehlen,
  zuPunkt,
  onZiehen,
}: {
  ballons: Ballon[];
  breite: number;
  hoehe: number;
  /** Bubblegröße (FAI-04) — Blase und Nummer, nicht Feld oder Lage. */
  groesse: number;
  hervorgehoben: string | null;
  /** Das Feld, das gerade aufgezogen wird. */
  vorschau: { x: number; y: number; b: number; h: number } | null;
  darfSchreiben: boolean;
  onWaehlen: (id: string) => void;
  /** Zeigerposition → kanonischer, normierter Punkt (aus dem Editor). */
  zuPunkt: (e: { clientX: number; clientY: number }) => Punkt | null;
  /** Blase verschoben: `speichern` erst beim Loslassen. */
  onZiehen: (id: string, blase: Punkt, speichern: boolean) => void;
}) {
  // Nur ein Ballon wird zur Zeit gezogen. `bewegt` trennt einen reinen Klick
  // (nur auswählen) vom Ziehen (speichern).
  const zieht = useRef<{ id: string; bewegt: boolean } | null>(null);

  return (
    <svg
      width={breite}
      height={hoehe}
      viewBox={`0 0 ${breite} ${hoehe}`}
      className="absolute left-0 top-0"
      style={{ overflow: "visible", pointerEvents: "none" }}
    >
      {vorschau && (
        <rect
          x={vorschau.x * breite}
          y={vorschau.y * hoehe}
          width={vorschau.b * breite}
          height={vorschau.h * hoehe}
          fill="none"
          stroke={FARBEN.strich}
          strokeDasharray="6 4"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {ballons.map((b) => {
        const p = ballonPixel(b, breite, hoehe, groesse);
        const aktiv = hervorgehoben === b.id;
        return (
          <g key={b.id}>
            <rect
              x={p.bereich.x}
              y={p.bereich.y}
              width={p.bereich.b}
              height={p.bereich.h}
              fill={aktiv ? "rgba(220,38,38,0.12)" : "none"}
              stroke={FARBEN.strich}
              strokeWidth={aktiv ? 2.5 : 1.5}
              vectorEffect="non-scaling-stroke"
            />
            <polygon points={p.keilPunkte} fill={FARBEN.strich} />
            <circle
              cx={p.blase.x}
              cy={p.blase.y}
              r={p.r}
              fill={FARBEN.blase}
              stroke={FARBEN.strich}
              strokeWidth={aktiv ? 2.5 : 1.5}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "auto", cursor: darfSchreiben ? "grab" : "pointer" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onWaehlen(b.id);
                if (!darfSchreiben || e.button !== 0) return;
                e.preventDefault();
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
                zieht.current = { id: b.id, bewegt: false };
              }}
              onPointerMove={(e) => {
                const z = zieht.current;
                if (!z || z.id !== b.id) return;
                const q = zuPunkt(e);
                if (!q) return;
                z.bewegt = true;
                e.stopPropagation();
                onZiehen(b.id, q, false);
              }}
              onPointerUp={(e) => {
                const z = zieht.current;
                if (!z || z.id !== b.id) return;
                zieht.current = null;
                try {
                  (e.currentTarget as Element).releasePointerCapture(e.pointerId);
                } catch {
                  /* war nicht gefangen */
                }
                if (!z.bewegt) return; // reiner Klick: nur ausgewählt, nichts gespeichert
                const q = zuPunkt(e);
                if (q) onZiehen(b.id, q, true);
                e.stopPropagation();
              }}
              onPointerCancel={() => {
                zieht.current = null;
              }}
            />
            <text
              x={p.blase.x}
              y={p.blase.y}
              fontSize={p.schriftgroesse}
              fill={FARBEN.schrift}
              textAnchor="middle"
              dominantBaseline="central"
              fontWeight={600}
              style={{ userSelect: "none", pointerEvents: "none" }}
            >
              {b.nummer}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
