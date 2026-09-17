import { rpc, type Takt, type Zeitraum } from "@/lib/kpi/gemeinsam";
import type { Fenster, Vergleichsworte } from "@/lib/kpi/vergleich";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Kennzahlen des Vertriebs. Die Rechenwege stehen als SQL-Funktionen in der
 * Datenbank (Alembic 0002); hier wird nur aufgerufen. Im Altprojekt lag
 * dieselbe Rechnung in Python und lief bei Verlaufskurven einmal je
 * Zeitfenster — als `GROUP BY` ist es eine Abfrage.
 */

export interface VertriebSumme {
  umsatz: number;
  umsatz_zeilen: number;
  auftragswert_avg: number;
  auftraege_anzahl: number;
}

export interface VerlaufPunkt {
  bucket: string;
  umsatz: number;
}

export interface KundenAnteil {
  kunde: string;
  wert: number;
  anteil: number;
}

/** Eine Zeile je ISO-Woche und Vertriebler. Die Karte summiert über die
 *  Vertriebler für den Balken und zeigt die Aufteilung im Tooltip. */
export interface AktivitaetZeile {
  iso_jahr: number;
  iso_woche: number;
  erfasser: string;
  erstkontakte: number;
  besuche_ort: number;
  besuche_onl: number;
  angebote_eur: number;
  auftraege_eur: number;
}

/** Interessenten haben keine Vertriebler-Spalte — die Quelldatei kennt keine. */
export interface InteressentenZeile {
  iso_jahr: number;
  iso_woche: number;
  anzahl: number;
}

export interface ErfasserZeile {
  erfasser: string;
  auftraege_anzahl: number;
  wert_summe: number;
}

/** Ein Auftrag der Einzelauftragstabelle (VER-03A). */
export interface Einzelauftrag {
  vorgang_nr: string;
  customer_name: string | null;
  datum: string;
  wert_eur: number;
}

/** Mehr liefert PostgREST in einer Antwort nicht. */
const SEITE = 1000;

/**
 * Der Umsatzverlauf rechnet **immer** in Monaten, unabhängig vom Fenster.
 *
 * Wie im Altprojekt (`RevenueChart.tsx`: `const GRANULARITY = "monthly"`). Der
 * fensterabhängige Takt aus `gemeinsam.ts` passt für Kennzahlen, die täglich
 * anfallen; Umsatz wird nicht täglich gebucht. In der Monatsansicht standen
 * damit rund 30 Tagespunkte gegen eine Handvoll Buchungen — die Fläche riss
 * an jedem gebuchtlosen Tag auf, obwohl nichts fehlte.
 */
export const UMSATZ_TAKT: Takt = "month";

export const vertriebApi = {
  summe: async (von: string | null, bis: string | null): Promise<VertriebSumme> => {
    const rows = await rpc<VertriebSumme[]>("kpi_vertrieb_summe", { von, bis });
    return (
      rows[0] ?? { umsatz: 0, umsatz_zeilen: 0, auftragswert_avg: 0, auftraege_anzahl: 0 }
    );
  },
  /** Verlauf für ein ausdrückliches Fenster — auch das Vergleichsfenster, das
   *  denselben Takt braucht wie die laufende Reihe. */
  verlauf: (von: string | null, bis: string | null, t: Takt = UMSATZ_TAKT) =>
    rpc<VerlaufPunkt[]>("kpi_vertrieb_verlauf", { von, bis, takt: t }),
  /** Ohne `top_n` jeder Kunde, ohne Sammelzeile (Migration 0041). */
  kundenanteil: (
    quelle: "revenues" | "auftraege",
    von: string | null,
    bis: string | null,
    top_n: number | null = null,
  ) => rpc<KundenAnteil[]>("kpi_vertrieb_kundenanteil", { quelle, von, bis, top_n }),
  /**
   * Die Aufträge, die „Aufträge gesamt“ zählt: `wert_eur > 0`, Datum im
   * Fenster. Seitenweise, weil „Alles“ mehr als die 1000 Zeilen hat, die
   * PostgREST auf einmal liefert — sonst fehlten Aufträge still.
   *
   * Sortiert nach Datum und Vorgangsnummer: die Nummer ist eindeutig, damit
   * keine Zeile beim Blättern doppelt kommt oder verloren geht.
   */
  einzelauftraege: async (von: string | null, bis: string | null): Promise<Einzelauftrag[]> => {
    const alle: Einzelauftrag[] = [];
    for (let ab = 0; ; ab += SEITE) {
      let abfrage = supabaseBrowser()
        .from("auftraege")
        .select("vorgang_nr, customer_name, datum, wert_eur")
        .gt("wert_eur", 0);
      if (von) abfrage = abfrage.gte("datum", von);
      if (bis) abfrage = abfrage.lte("datum", bis);
      const { data, error } = await abfrage
        .order("datum", { ascending: false })
        .order("vorgang_nr")
        .range(ab, ab + SEITE - 1);
      if (error) throw new Error(error.message);
      const seite = (data ?? []) as Einzelauftrag[];
      alle.push(...seite.map((z) => ({ ...z, wert_eur: Number(z.wert_eur) })));
      if (seite.length < SEITE) return alle;
    }
  },
  jeErfasser: (von: string | null, bis: string | null) =>
    rpc<ErfasserZeile[]>("kpi_vertrieb_je_erfasser", { von, bis }),
  aktivitaet: (von: string, bis: string) =>
    rpc<AktivitaetZeile[]>("kpi_vertrieb_aktivitaet", { p_von: von, p_bis: bis }),
  interessenten: (von: string, bis: string) =>
    rpc<InteressentenZeile[]>("kpi_vertrieb_interessenten", { p_von: von, p_bis: bis }),
};

/** Fenster für die Wochenkarte.
 *
 *  Die Karte hängt nicht am Zeitraumwähler des Dashboards: sie zeigt Wochen,
 *  und „Dieser Monat" ergäbe vier Balken. Ist ein Zeitraum gewählt, wird er
 *  benutzt; bei „Alles" die letzten zwölf ISO-Wochen bis zum Sonntag der
 *  laufenden Woche.
 *
 *  Im Altprojekt blieb die Karte bei „Alles" leer — eine Notlösung für eine
 *  unbegrenzte Abfrage, die es hier nicht braucht.
 */
export function wochenfenster(
  von: string | null,
  bis: string | null,
  heute = new Date(),
): { von: string; bis: string } {
  if (von && bis) return { von, bis };
  const sonntag = new Date(heute);
  // getDay(): 0 = Sonntag. Der Sonntag der laufenden ISO-Woche liegt
  // (7 − Wochentag) Tage voraus, für den Sonntag selbst null Tage.
  sonntag.setDate(sonntag.getDate() + ((7 - sonntag.getDay()) % 7));
  const montag = new Date(sonntag);
  montag.setDate(montag.getDate() - (12 * 7 - 1));
  return { von: alsIso(montag), bis: alsIso(sonntag) };
}

function alsIso(d: Date): string {
  const monat = String(d.getMonth() + 1).padStart(2, "0");
  const tag = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${monat}-${tag}`;
}

function alsDatum(iso: string): Date {
  // Mittags: so kippt keine Sommerzeitumstellung den Tag.
  return new Date(`${iso.slice(0, 10)}T12:00:00`);
}

// ---------------------------------------------------------------------------
// Kundenanteile (VER-03B)
// ---------------------------------------------------------------------------

/** Eine Säule im Kundenanteilsdiagramm; `platz: null` ist der Rest. */
export interface Kundensaeule {
  platz: number | null;
  kunde: string;
  wert: number;
  anteil: number;
}

/**
 * Die sichtbaren Kunden und der Rest — wie `CustomerShareCard.tsx`.
 *
 * Grundlage sind alle Kunden, absteigend. Der Rest ist Gesamt minus sichtbare
 * Summe, nicht die Summe der unsichtbaren Kunden: beides ist dasselbe, solange
 * es keine Kunden mit negativer Nettosumme gibt, und so bleibt die Rechnung
 * die der Referenz. Ein Rest ≤ 0 und eine Grundlage ≤ 0 werden nicht gezeigt —
 * ein Anteil an einer negativen Summe sagt nichts.
 */
export function kundensaeulen(
  kunden: readonly KundenAnteil[],
  sichtbar: number,
): { saeulen: Kundensaeule[]; gesamt: number; restAnzahl: number } {
  const liste = kunden.map((k) => ({ kunde: k.kunde, wert: Number(k.wert) }));
  const gesamt = liste.reduce((s, k) => s + k.wert, 0);
  if (liste.length === 0 || gesamt <= 0) return { saeulen: [], gesamt: 0, restAnzahl: 0 };

  const oben = liste.slice(0, sichtbar);
  const saeulen: Kundensaeule[] = oben.map((k, i) => ({
    platz: i + 1,
    kunde: k.kunde,
    wert: k.wert,
    anteil: k.wert / gesamt,
  }));
  const restAnzahl = liste.length - oben.length;
  const rest = gesamt - oben.reduce((s, k) => s + k.wert, 0);
  if (restAnzahl > 0 && rest > 0) saeulen.push({ platz: null, kunde: "", wert: rest, anteil: rest / gesamt });
  return { saeulen, gesamt, restAnzahl };
}

/**
 * Farbe je Kunde über mehrere Diagramme (Index in die Palette).
 *
 * Derselbe Kunde hat überall dieselbe Farbe. Die besten Plätze wählen zuerst;
 * jeder nimmt eine noch ganz unbenutzte Farbe, und erst wenn keine mehr frei
 * ist, eine, die kein Kunde desselben Diagramms trägt. Geht auch das nicht,
 * bleibt der Kunde ohne Farbe (neutral) — die Nummer ordnet ihn trotzdem zu.
 */
export function kundenfarben(listen: readonly (readonly string[])[], plaetze = 8): Map<string, number> {
  const reihenfolge = listen
    .flatMap((liste, l) => liste.map((kunde, rang) => ({ kunde, rang, l })))
    .sort((a, b) => a.rang - b.rang || a.l - b.l);
  const mitglieder = listen.map((liste) => new Set(liste));
  const farbe = new Map<string, number>();
  const alle = Array.from({ length: plaetze }, (_, i) => i);

  for (const { kunde } of reihenfolge) {
    if (farbe.has(kunde)) continue;
    const benutzt = new Set(farbe.values());
    const nachbarn = new Set<number>();
    for (const m of mitglieder) {
      if (!m.has(kunde)) continue;
      for (const k of m) {
        const f = farbe.get(k);
        if (f !== undefined) nachbarn.add(f);
      }
    }
    const wahl = alle.find((f) => !benutzt.has(f)) ?? alle.find((f) => !nachbarn.has(f));
    if (wahl !== undefined) farbe.set(kunde, wahl);
  }
  return farbe;
}

// ---------------------------------------------------------------------------
// Umsatzverlauf mit Vergleichsreihe (VER-04A)
// ---------------------------------------------------------------------------

/**
 * Welche Reihe neben dem Umsatz läuft — wie `chartComparisonMode.ts`:
 * Monat und Quartal gegen die Vorperiode, Jahr gegen das Vorjahr, „Alles“
 * ohne. Den freien Zeitraum kennt die Referenz nicht mehr; er bekommt das
 * Vorjahr, weil dessen Buckets auf dieselben Kalendertage fallen.
 */
export function vergleichsart(zeitraum: Zeitraum): "vorperiode" | "vorjahr" | null {
  if (zeitraum === "monat" || zeitraum === "quartal") return "vorperiode";
  if (zeitraum === "jahr" || zeitraum === "frei") return "vorjahr";
  return null;
}

/** Die Buckets eines Fensters, so wie `date_trunc` sie in SQL bildet. */
export function zeitachse(von: string, bis: string, t: "day" | "week" | "month"): string[] {
  const ende = alsDatum(bis);
  const d = alsDatum(von);
  if (t === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (t === "month") d.setDate(1);
  const achse: string[] = [];
  while (d <= ende) {
    achse.push(alsIso(d));
    if (t === "day") d.setDate(d.getDate() + 1);
    else if (t === "week") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
  }
  return achse;
}

export interface VerlaufZeile {
  bucket: string;
  /** `null` heißt: kein Umsatz gebucht — keine Säule, keine erfundene Null. */
  umsatz: number | null;
  /** Nur mit Vergleichsreihe vorhanden. */
  vorher?: number | null;
  bucketVorher?: string | null;
}

/**
 * Aktuelle und Vergleichsreihe auf einer Achse.
 *
 * Wie die Referenz (`routers/kpis.py`, `get_chart_data`) paart sie das i-te
 * Bucket mit dem i-ten. Anders als dort über eine vollständige Achse beider
 * Fenster, nicht über die gelieferten Zeilen: fehlt dort ein Monat ohne
 * Umsatz, rutscht sonst die ganze restliche Vorjahresreihe um einen Monat.
 * Hat das Vergleichsfenster weniger Buckets (Februar gegen März), bleiben die
 * letzten ohne Vergleich.
 */
export function verlaufMitVergleich(
  aktuell: readonly VerlaufPunkt[],
  vorher: readonly VerlaufPunkt[] | null,
  fenster: Fenster | null,
  vorFenster: Fenster | null,
  t: "day" | "week" | "month",
): VerlaufZeile[] {
  const werte = (punkte: readonly VerlaufPunkt[]) =>
    new Map(punkte.map((p) => [String(p.bucket).slice(0, 10), Number(p.umsatz)]));
  const jetzt = werte(aktuell);

  let achse: string[];
  if (fenster) {
    achse = zeitachse(fenster.von, fenster.bis, t);
  } else {
    const buckets = [...jetzt.keys()].sort();
    if (buckets.length === 0) return [];
    achse = zeitachse(buckets[0], buckets[buckets.length - 1], t);
  }

  if (!vorher || !vorFenster) return achse.map((b) => ({ bucket: b, umsatz: jetzt.get(b) ?? null }));

  const frueher = werte(vorher);
  const achseVorher = zeitachse(vorFenster.von, vorFenster.bis, t);
  return achse.map((b, i) => {
    const bv = achseVorher[i] ?? null;
    return {
      bucket: b,
      umsatz: jetzt.get(b) ?? null,
      vorher: bv === null ? null : (frueher.get(bv) ?? null),
      bucketVorher: bv,
    };
  });
}

/** Der Zeitraum einer Reihe für Legende und Tooltip: „2025“, „August 2026“. */
export function zeitraumText(
  zeitraum: Zeitraum,
  f: Fenster,
  sprachTag: string,
  worte: Vergleichsworte,
): string {
  const anfang = alsDatum(f.von);
  const jahr = anfang.getFullYear();
  if (zeitraum === "monat") {
    return `${new Intl.DateTimeFormat(sprachTag, { month: "long" }).format(anfang)} ${jahr}`;
  }
  if (zeitraum === "quartal") return `${worte.quartal(Math.floor(anfang.getMonth() / 3) + 1)} ${jahr}`;
  if (zeitraum === "jahr") return String(jahr);
  const datum = new Intl.DateTimeFormat(sprachTag, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${datum.format(anfang)}–${datum.format(alsDatum(f.bis))}`;
}
