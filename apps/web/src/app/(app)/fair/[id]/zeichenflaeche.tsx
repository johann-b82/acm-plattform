"use client";

import { memo } from "react";
import { Document, Page } from "react-pdf";

import "@/app/(app)/fair/pdf-arbeiter";
import type { ZeichnungsArt } from "@/lib/fair";

/**
 * Die Zeichnung in ihrer natürlichen Größe — eine PDF-Seite oder ein Bild.
 *
 * Zoom und Verschieben macht der Elternteil per CSS-Transformation. Deshalb
 * bleibt `width` hier fest, und die PDF-Leinwand wird beim Zoomen nicht jedes
 * Mal neu gerastert. `renderDpr` hebt nur die Auflösung der Leinwand an, damit
 * Maßtext beim Hineinzoomen scharf bleibt, statt vergrößert zu werden.
 */
function ZeichenflaecheImpl({
  url,
  art,
  seite,
  breite,
  hoehe,
  renderDpr,
  onMasse,
  onSeiten,
}: {
  url: string;
  art: ZeichnungsArt;
  seite: number;
  breite: number | null;
  hoehe: number | null;
  renderDpr: number;
  onMasse: (m: { b: number; h: number }) => void;
  onSeiten: (n: number) => void;
}) {
  if (art === "bild") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt="Zeichnung"
        draggable={false}
        style={{
          display: "block",
          width: breite ? `${breite}px` : "auto",
          height: hoehe ? `${hoehe}px` : "auto",
          userSelect: "none",
          pointerEvents: "none",
        }}
        onLoad={(e) => {
          onSeiten(1);
          if (!breite) {
            onMasse({ b: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
          }
        }}
      />
    );
  }

  return (
    <Document
      file={url}
      onLoadSuccess={({ numPages }) => onSeiten(numPages)}
      loading=""
      error="Die Zeichnung ließ sich nicht laden."
    >
      <Page
        pageNumber={seite}
        width={breite ?? undefined}
        devicePixelRatio={renderDpr}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        onLoadSuccess={(p) => {
          const sicht = p.getViewport({ scale: 1 });
          onMasse({ b: sicht.width, h: sicht.height });
        }}
      />
    </Document>
  );
}

export const Zeichenflaeche = memo(ZeichenflaecheImpl);
