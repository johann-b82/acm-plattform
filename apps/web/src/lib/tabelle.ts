/**
 * Die Tabellenregeln der Plattform als reine Funktionen.
 *
 * TAB-01: jede Tabelle blättert, Seitengröße zentral 25, 50 oder 100.
 * TAB-02: jede fachliche Spalte sortiert — nach ihrem Typ, nicht nach dem
 *         formatierten Text („1.200 €" stünde sonst vor „900 €").
 * TAB-03: ein Suchfeld ab mehr als 25 Datensätzen; es bleibt, solange darin
 *         Text steht, auch wenn die Treffer auf null fallen.
 *
 * Reihenfolge immer: fachlicher Filter (vom Aufrufer) → Suche → Sortierung →
 * Seite. Sortiert wird die ganze Treffermenge, nie nur die sichtbare Seite.
 */

export const SEITENGROESSEN = [25, 50, 100] as const;
export type Seitengroesse = (typeof SEITENGROESSEN)[number];

/** Ab mehr als so vielen Datensätzen erscheint das Suchfeld — unabhängig von
 *  der gewählten Seitengröße. */
export const SUCHSCHWELLE = 25;

export type Spaltentyp = "text" | "zahl" | "datum";
export type Richtung = "auf" | "ab";

export interface Spalte<T> {
  schluessel: string;
  typ: Spaltentyp;
  /** Der Rohwert, nach dem sortiert wird. Datum als ISO-Text oder `Date`. */
  wert: (zeile: T) => string | number | Date | null | undefined;
  /** Was die Suche an dieser Spalte findet; ohne Angabe der Rohwert als Text.
   *  `false` nimmt die Spalte aus der Suche. Der zweite Wert ist der
   *  eingegebene Suchtext — für Spalten, die eine Eingabe erst aufbereiten
   *  (etwa nur ihre Ziffern vergleichen). */
  suchtext?: ((zeile: T, suchtext: string) => string | null | undefined) | false;
  /** Aktions- und Auswahlspalten tragen keinen Wert und sortieren nicht. */
  sortierbar?: boolean;
}

const VERGLEICH = new Intl.Collator("de", { sensitivity: "base", numeric: true });

function leer(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

function alsZahl(v: unknown, typ: Spaltentyp): number {
  if (typ === "datum") return v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
  return typeof v === "number" ? v : Number(v);
}

/**
 * Sortiert stabil und typgerecht. Fehlende Werte stehen in beiden Richtungen
 * am Ende — wer absteigend nach Betrag sortiert, will oben die größten Beträge
 * sehen, nicht die leeren Zellen.
 */
export function sortiere<T>(zeilen: readonly T[], spalte: Spalte<T>, richtung: Richtung): T[] {
  const faktor = richtung === "auf" ? 1 : -1;
  return zeilen
    .map((zeile, index) => ({ zeile, index, wert: spalte.wert(zeile) }))
    .sort((a, b) => {
      const aLeer = leer(a.wert);
      const bLeer = leer(b.wert);
      if (aLeer || bLeer) return aLeer === bLeer ? a.index - b.index : aLeer ? 1 : -1;
      const unterschied =
        spalte.typ === "text"
          ? VERGLEICH.compare(String(a.wert), String(b.wert))
          : alsZahl(a.wert, spalte.typ) - alsZahl(b.wert, spalte.typ);
      return unterschied === 0 ? a.index - b.index : unterschied * faktor;
    })
    .map((x) => x.zeile);
}

function normiert(text: string): string {
  return text.toLocaleLowerCase("de").normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

/** Findet Zeilen, in deren durchsuchbaren Spalten der Text vorkommt. */
export function suche<T>(zeilen: readonly T[], spalten: readonly Spalte<T>[], text: string): T[] {
  const gesucht = normiert(text.trim());
  if (!gesucht) return [...zeilen];
  const texte = spalten
    .filter((s) => s.suchtext !== false)
    .map((s) =>
      typeof s.suchtext === "function"
        ? s.suchtext
        : (z: T) => {
            const w = s.wert(z);
            return leer(w) ? "" : String(w);
          },
    );
  return zeilen.filter((z) => texte.some((f) => normiert(f(z, text.trim()) ?? "").includes(gesucht)));
}

/** TAB-03: gezählt wird die fachlich gefilterte Menge **vor** der Suche. */
export function suchfeldSichtbar(ausgangsmenge: number, suchtext: string): boolean {
  return ausgangsmenge > SUCHSCHWELLE || suchtext !== "";
}

export interface Fenster<T> {
  zeilen: T[];
  /** Die tatsächlich gezeigte Seite — nie jenseits der letzten. */
  seite: number;
  seiten: number;
  /** 1-basierte Positionen für „26–50 von 101"; bei leerer Menge 0. */
  von: number;
  bis: number;
  gesamt: number;
}

export function seitenfenster<T>(zeilen: readonly T[], groesse: number, seite: number): Fenster<T> {
  const gesamt = zeilen.length;
  const seiten = Math.max(1, Math.ceil(gesamt / groesse));
  const gueltig = Math.min(Math.max(1, Math.floor(seite)), seiten);
  const start = (gueltig - 1) * groesse;
  const teil = zeilen.slice(start, start + groesse);
  return {
    zeilen: teil,
    seite: gueltig,
    seiten,
    von: gesamt === 0 ? 0 : start + 1,
    bis: start + teil.length,
    gesamt,
  };
}
