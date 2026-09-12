/**
 * Reine Koordinatenrechnung für den FAIR-Editor. Ohne React und ohne DOM,
 * damit sie sich prüfen lässt.
 *
 * Alle normierten Werte sind Brüche [0,1] der natürlichen Seitengröße. Die
 * Ansicht liegt darüber als `translate(tx,ty) scale(skala)` mit Ursprung 0 0.
 *
 * Aus `lumeapps` übernommen (`frontend/src/components/fair/geometry.ts`),
 * unverändert im Verhalten.
 */
import type { Ballon, Drehung } from "@/lib/fair";

export interface Ansicht {
  skala: number;
  tx: number;
  ty: number;
}

export interface Punkt {
  x: number;
  y: number;
}

export interface Rechteck {
  x: number;
  y: number;
  b: number;
  h: number;
}

export function begrenze01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function begrenze(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Zeigerposition (px im Behälter) → normierter Seitenpunkt. */
export function zuNormiert(
  px: number,
  py: number,
  a: Ansicht,
  breite: number,
  hoehe: number,
): Punkt {
  return {
    x: begrenze01((px - a.tx) / a.skala / breite),
    y: begrenze01((py - a.ty) / a.skala / hoehe),
  };
}

/** Der Weg zurück: normierter Seitenpunkt → px im Behälter. */
export function zuBildschirm(
  p: Punkt,
  a: Ansicht,
  breite: number,
  hoehe: number,
): Punkt {
  return {
    x: p.x * breite * a.skala + a.tx,
    y: p.y * hoehe * a.skala + a.ty,
  };
}

/** Rechteck aus zwei gezogenen Ecken. */
export function rechteckAusEcken(a: Punkt, b: Punkt): Rechteck {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    b: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Auf sechs Nachkommastellen runden — kompakt und wiederholbar. */
export function runde6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

/** Ansicht, in der die ganze Seite mit etwas Rand hineinpasst. */
export function einpassen(
  fensterB: number,
  fensterH: number,
  breite: number,
  hoehe: number,
  rand = 24,
): Ansicht {
  const freiB = Math.max(1, fensterB - rand * 2);
  const freiH = Math.max(1, fensterH - rand * 2);
  const skala = Math.min(freiB / breite, freiH / hoehe);
  return {
    skala,
    tx: (fensterB - breite * skala) / 2,
    ty: (fensterH - hoehe * skala) / 2,
  };
}

/** Zoomen um einen festen Punkt, sodass das, was darunter liegt, liegen
 *  bleibt. `faktor` größer als 1 vergrößert. */
export function zoomeUm(
  a: Ansicht,
  ankerX: number,
  ankerY: number,
  faktor: number,
  minSkala = 0.1,
  maxSkala = 12,
): Ansicht {
  const skala = begrenze(a.skala * faktor, minSkala, maxSkala);
  const k = skala / a.skala;
  return {
    skala,
    tx: ankerX - (ankerX - a.tx) * k,
    ty: ankerY - (ankerY - a.ty) * k,
  };
}

// ── Drehung (nur Ansicht; Ballons liegen immer kanonisch) ──────────────────

export function naechsteDrehung(d: Drehung): Drehung {
  return ((d + 90) % 360) as Drehung;
}

/** Sichtbare Maße nach dem Drehen einer Seite b×h im Uhrzeigersinn. */
export function gedrehteMasse(
  b: number,
  h: number,
  d: Drehung,
): { b: number; h: number } {
  return d === 90 || d === 270 ? { b: h, h: b } : { b, h };
}

/** CSS-Transformation (Ursprung 0 0), die die kanonische Ebene in ihren
 *  gedrehten Kasten legt. */
export function drehungCss(b: number, h: number, d: Drehung): string {
  switch (d) {
    case 90:
      return `translate(${h}px, 0px) rotate(90deg)`;
    case 180:
      return `translate(${b}px, ${h}px) rotate(180deg)`;
    case 270:
      return `translate(0px, ${b}px) rotate(270deg)`;
    default:
      return "none";
  }
}

/** Gedrehter Kasten (px) → kanonische px. Umkehrung von `drehungCss`. */
export function ausDrehung(
  rx: number,
  ry: number,
  b: number,
  h: number,
  d: Drehung,
): Punkt {
  switch (d) {
    case 90:
      return { x: ry, y: h - rx };
    case 180:
      return { x: b - rx, y: h - ry };
    case 270:
      return { x: b - ry, y: rx };
    default:
      return { x: rx, y: ry };
  }
}

/** Kanonische px → gedrehter Kasten (px). Umkehrung von `ausDrehung`; die
 *  PDF-Ausgabe legt damit Ballons auf die gedrehte Seite. */
export function inDrehung(
  x: number,
  y: number,
  b: number,
  h: number,
  d: Drehung,
): Punkt {
  switch (d) {
    case 90:
      return { x: h - y, y: x };
    case 180:
      return { x: b - x, y: h - y };
    case 270:
      return { x: y, y: b - x };
    default:
      return { x, y };
  }
}

// ── Der Ballon selbst ──────────────────────────────────────────────────────

export const FARBEN = {
  strich: "#dc2626",
  blase: "#ffffff",
  schrift: "#dc2626",
} as const;

/** Punkte eines gefüllten Pfeilkeils: Spitze bei `spitze`, Fuß an der Blase. */
export function keil(blase: Punkt, spitze: Punkt, r: number): string {
  const dx = spitze.x - blase.x;
  const dy = spitze.y - blase.y;
  const laenge = Math.hypot(dx, dy) || 1;
  const ux = dx / laenge;
  const uy = dy / laenge;
  const fussX = blase.x + ux * r * 0.9;
  const fussY = blase.y + uy * r * 0.9;
  const halb = r * 0.8;
  return (
    `${spitze.x},${spitze.y} ` +
    `${fussX - uy * halb},${fussY + ux * halb} ` +
    `${fussX + uy * halb},${fussY - ux * halb}`
  );
}

/** Wo der Strahl aus der Mitte eines Rechtecks Richtung `ziel` den Rand
 *  verlässt, um `abstand` weiter hinausgeschoben. So sitzt die Pfeilspitze
 *  knapp neben dem markierten Feld statt darauf. */
export function randpunkt(
  mx: number,
  my: number,
  halbeB: number,
  halbeH: number,
  ziel: Punkt,
  abstand: number,
): Punkt {
  const dx = ziel.x - mx;
  const dy = ziel.y - my;
  if (dx === 0 && dy === 0) return { x: mx, y: my };
  const tX = dx !== 0 ? halbeB / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? halbeH / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  const laenge = Math.hypot(dx, dy);
  return {
    x: mx + dx * t + (dx / laenge) * abstand,
    y: my + dy * t + (dy / laenge) * abstand,
  };
}

export interface BallonPixel {
  spitze: Punkt;
  blase: Punkt;
  bereich: Rechteck;
  r: number;
  schriftgroesse: number;
  keilPunkte: string;
}

/**
 * Ein Ballon in Pixeln für eine Seite von (breite, hoehe).
 *
 * Der Radius hängt an der Seitengröße, damit er unter Zoom im Verhältnis
 * bleibt, und die Spitze sitzt außerhalb des markierten Felds, damit sie den
 * Wert nicht verdeckt.
 */
export function ballonPixel(
  b: Pick<
    Ballon,
    "bereich_x" | "bereich_y" | "bereich_b" | "bereich_h" | "blase_x" | "blase_y"
  >,
  breite: number,
  hoehe: number,
  groesse = 1,
): BallonPixel {
  const bereich = {
    x: b.bereich_x * breite,
    y: b.bereich_y * hoehe,
    b: b.bereich_b * breite,
    h: b.bereich_h * hoehe,
  };
  const mx = bereich.x + bereich.b / 2;
  const my = bereich.y + bereich.h / 2;
  const blase = { x: b.blase_x * breite, y: b.blase_y * hoehe };
  const r = Math.max(9, Math.min(breite, hoehe) * 0.02) * groesse;
  const spitze = randpunkt(mx, my, bereich.b / 2, bereich.h / 2, blase, r * 0.4);
  return {
    spitze,
    blase,
    bereich,
    r,
    schriftgroesse: r * 1.05,
    keilPunkte: keil(blase, spitze, r),
  };
}

// ── Ausgabe für die Prüfliste ──────────────────────────────────────────────

/** Tabelle mit Tabulatoren — zum Einfügen in Excel. */
export function alsTsv(
  zeilen: readonly Pick<Ballon, "nummer" | "wert">[],
  kopf: readonly [string, string] = ["Nr", "Wert"],
): string {
  const zelle = (v: string) => v.replace(/[\t\r\n]+/g, " ").trim();
  return [
    kopf.join("\t"),
    ...[...zeilen]
      .sort((a, b) => a.nummer - b.nummer)
      .map((z) => `${z.nummer}\t${zelle(z.wert)}`),
  ].join("\r\n");
}

/** Tabelle mit Semikolon — was deutsches Excel beim Öffnen erwartet. */
export function alsCsv(
  zeilen: readonly Pick<Ballon, "nummer" | "wert">[],
  kopf: readonly [string, string] = ["Nr", "Wert"],
): string {
  const zelle = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    kopf.map(zelle).join(";"),
    ...[...zeilen]
      .sort((a, b) => a.nummer - b.nummer)
      .map((z) => `${z.nummer};${zelle(z.wert)}`),
  ].join("\r\n");
}
