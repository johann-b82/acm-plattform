"use client";

import { FARBEN, ballonPixel } from "@/lib/fair/geometrie";
import type { Ballon } from "@/lib/fair";

/**
 * Die Ballons über der Zeichnung, als ein SVG in kanonischen Seitenpixeln.
 *
 * Die Ebene liegt unter derselben Transformation wie die Zeichnung, also
 * stimmen die Koordinaten ohne weiteres Zutun. Nicht skaliert wird die
 * Strichstärke: die soll beim Zoomen dünn bleiben, sonst wird der Pfeil zum
 * Balken. Deshalb `vectorEffect="non-scaling-stroke"`.
 */
export function BallonEbene({
  ballons,
  breite,
  hoehe,
  hervorgehoben,
  vorschau,
  onWaehlen,
}: {
  ballons: Ballon[];
  breite: number;
  hoehe: number;
  hervorgehoben: string | null;
  /** Das Feld, das gerade aufgezogen wird. */
  vorschau: { x: number; y: number; b: number; h: number } | null;
  onWaehlen: (id: string) => void;
}) {
  return (
    <svg
      width={breite}
      height={hoehe}
      viewBox={`0 0 ${breite} ${hoehe}`}
      className="absolute left-0 top-0"
      style={{ overflow: "visible" }}
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
        const p = ballonPixel(b, breite, hoehe);
        const aktiv = hervorgehoben === b.id;
        return (
          <g
            key={b.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              onWaehlen(b.id);
            }}
            style={{ cursor: "pointer" }}
          >
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
            />
            <text
              x={p.blase.x}
              y={p.blase.y}
              fontSize={p.schriftgroesse}
              fill={FARBEN.schrift}
              textAnchor="middle"
              dominantBaseline="central"
              fontWeight={600}
              style={{ userSelect: "none" }}
            >
              {b.nummer}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
