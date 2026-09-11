"use client";

import { useTexte } from "@/components/sprache/anbieter";
import type { Art, Stand } from "@/lib/dokumente";
import type { Intervall } from "@/lib/wartung";
import type { Dringlichkeit, Person } from "@/lib/schulungen";

/**
 * Tafeln, die mehrere Seiten brauchen: Datenbankschlüssel auf Namen.
 *
 * Als Konstante ginge das nicht mehr — die Namen hängen an der Sprache und
 * damit an einem Haken. Hier stehen sie einmal, statt in jeder Seite, die sie
 * anzeigt.
 */
export function useDringlichkeit(): Record<Dringlichkeit, string> {
  const t = useTexte();
  return {
    nie: t.offeneSchulungen.nie,
    ueberfaellig: t.offeneSchulungen.ueberfaellig,
    faellig_bald: t.offeneSchulungen.wirdFaellig,
    offen: t.offeneSchulungen.imTurnus,
  };
}

/** Woher eine Person in der Schulungsliste stammt. */
export function useHerkunft(): Record<Person["herkunft"], string> {
  const t = useTexte();
  return {
    personio: t.schulungsmatrix.personio,
    extern: t.schulungsmatrix.externGepflegt,
    ohne_zuordnung: t.schulungsmatrix.ohneTreffer,
  };
}

/** Die vier Bereiche der Kompetenzmatrizen. */
export function useKompetenzbereich(): Record<string, string> {
  const t = useTexte();
  return {
    produktion: t.kompetenzen.produktion,
    verwaltung: t.kompetenzen.verwaltung,
    safety: t.kompetenzen.safety,
    quality: t.kompetenzen.quality,
  };
}

/** Die Zeugnisarten. */
export function useZeugnisart(): Record<string, string> {
  const t = useTexte();
  return {
    qualifiziert: t.zeugnisse.qualifiziert,
    einfach: t.zeugnisse.einfach,
    zwischenzeugnis: t.zeugnisse.zwischenzeugnis,
    ausbildungszeugnis: t.zeugnisse.ausbildungszeugnis,
    praktikumszeugnis: t.zeugnisse.praktikumszeugnis,
  };
}

/** Was die fünf Anforderungsstufen bedeuten. */
export function useStufentext(): Record<number, string> {
  const t = useTexte();
  return {
    0: t.matrix.stufe0,
    1: t.matrix.stufe1,
    2: t.matrix.stufe2,
    3: t.matrix.stufe3,
    4: t.matrix.stufe4,
  };
}

/** Die Abschnitte und Bewertungsdimensionen eines Zeugnisses. */
export function useZeugnisworte(): Record<string, string> {
  const t = useTexte();
  return {
    fachwissen: t.zeugnis.fachwissen,
    auffassungsgabe: t.zeugnis.auffassungsgabe,
    arbeitsweise: t.zeugnis.arbeitsweise,
    belastbarkeit: t.zeugnis.belastbarkeit,
    arbeitserfolg: t.zeugnis.arbeitserfolg,
    sozialverhalten: t.zeugnis.sozialverhalten,
    fuehrung: t.zeugnis.fuehrung,
    einleitung: t.zeugnis.einleitung,
    taetigkeitsbeschreibung: t.zeugnis.taetigkeitsbeschreibung,
    leistungsbeurteilung: t.zeugnis.leistungsbeurteilung,
    schlussformel: t.zeugnis.schlussformel,
    personio: t.zeugnis.ausPersonio,
    profil: t.zeugnis.ausEinstellungen,
    keine: t.zeugnis.nichtHinterlegt,
    name: t.zeugnis.name,
    personalnummer: t.zeugnis.personalnummer,
    abteilung: t.zeugnis.abteilung,
    taetigkeit: t.zeugnis.taetigkeit,
    eintritt: t.zeugnis.eintritt,
    austritt: t.zeugnis.austritt,
    geburtsdatum: t.zeugnis.geburtsdatum,
    ausstellungsdatum: t.zeugnis.ausstellungsdatum,
    taetigkeit_stichpunkte: t.zeugnis.aufgaben,
    besondere_kompetenzen: t.zeugnis.kompetenzen,
    besondere_erfolge: t.zeugnis.erfolge,
  };
}

/** Stationen und Formblätter des Dokumentenlaufs. */
export function useDokumentworte(): { stand: Record<Stand, string>; art: Record<Art, string> } {
  const t = useTexte();
  return {
    stand: {
      erstellt: t.dokumentenlauf.erstellt,
      uebergeben: t.dokumentenlauf.uebergeben,
      zurueck: t.dokumentenlauf.zurueck,
      geprueft: t.dokumentenlauf.geprueft,
    },
    art: {
      einarbeitung: t.dokumentenlauf.einarbeitungsplan,
      schulung: t.dokumentenlauf.schulungsnachweis,
    },
  };
}

/** Auditstatus, Phasenstatus und Kategorien. */
export function useAuditworte(): Record<string, string> {
  const t = useTexte();
  return {
    geplant: t.audit.geplant,
    in_vorbereitung: t.audit.inVorbereitung,
    in_durchfuehrung: t.audit.inDurchfuehrung,
    berichtet: t.audit.berichtet,
    massnahmen_offen: t.audit.massnahmenOffen,
    abgeschlossen: t.audit.abgeschlossen,
    verschoben: t.audit.verschoben,
    abgesagt: t.audit.abgesagt,
    offen: t.audit.phaseOffen,
    in_arbeit: t.audit.phaseInArbeit,
    erledigt: t.audit.phaseErledigt,
    nicht_zutreffend: t.audit.phaseNichtZutreffend,
    system: t.audit.system,
    prozess: t.audit.prozess,
    produkt: t.audit.produkt,
    lieferant: t.audit.lieferant,
    intern: t.audit.intern,
    extern: t.audit.extern,
  };
}

/** Die Wartungsintervalle. */
export function useIntervall(): Record<Intervall, string> {
  const t = useTexte();
  return {
    taeglich: t.maschine.taeglich,
    woechentlich: t.maschine.woechentlich,
    monatlich: t.maschine.monatlich,
    quartalsweise: t.maschine.quartalsweise,
    alle_n_wochen: t.maschine.alleNWochen,
  };
}
