"""Alt gegen neu zählen: steht in jeder Tabelle dasselbe?

Die Übernahme ist erst fertig, wenn die Zahlen stimmen. Dafür braucht es eine
Liste, welche alte Tabelle welcher neuen entspricht — die Namen sind übersetzt
(`machines` → `maschinen`), ein paar Tabellen sind zusammengelegt, und drei
sind bewusst nicht mitgekommen. Diese Liste steht hier, einmal, und ist
zugleich die Antwort auf die Frage „was fehlt noch".

Gezählt wird nur; geschrieben wird hier nichts. Die alte Datenbank wird
ausschließlich lesend geöffnet.
"""
from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa

from app.db import SessionLocal


@dataclass(frozen=True)
class Paar:
    """Eine alte Tabelle und ihr Gegenstück — oder das Fehlen eines solchen."""

    modul: str
    alt: str | None
    neu: str | None
    hinweis: str = ""
    #: Warum die beiden Zahlen **nicht** gleich sein dürfen. Steht hier etwas,
    #: ist die Abweichung gewollt und kein Befund — der Grund gehört in den
    #: Text, sonst wäre es eine Ausnahme ohne Begründung.
    erwartet: str = ""


#: Alt → neu. `neu=None` heißt: bewusst nicht portiert. `alt=None` heißt: im
#: neuen Stack dazugekommen, im Alten gibt es dafür keine Zeilen.
PAARE: list[Paar] = [
    # --- Vertrieb -----------------------------------------------------------
    Paar("Vertrieb", "upload_batches", "upload_batches",
         erwartet="ein Protokoll der Sorte „tippspiel“ kommt nicht mit"),
    Paar("Vertrieb", "revenues", "revenues"),
    Paar("Vertrieb", "auftraege", "auftraege"),
    Paar("Vertrieb", "auftrag_positionen", "auftrag_positionen"),
    Paar("Vertrieb", "sales_contacts", "sales_contacts"),
    Paar("Vertrieb", "interessenten", "interessenten"),
    Paar("Vertrieb", "offers", "offers"),
    Paar("Vertrieb", "sales_records", None, "im neuen Stack in revenues aufgegangen"),
    # --- Einkauf und Material ----------------------------------------------
    Paar("Einkauf", "delivery_records", "delivery_records"),
    Paar("Einkauf", "delivery_reliability", "delivery_reliability"),
    Paar("Einkauf", "goods_receipt_records", "goods_receipt_records"),
    Paar("Einkauf", "material_movements", "material_movements"),
    Paar("Einkauf", "stock_article_prices", "stock_article_prices"),
    Paar("Einkauf", "material_prices", "material_prices"),
    # --- Qualität -----------------------------------------------------------
    Paar("Qualität", "quality_records", "quality_records"),
    Paar("Qualität", "inspection_records", "inspection_records"),
    Paar("Qualität", "audits", "audits"),
    Paar("Qualität", "audit_phases", "audit_phasen"),
    Paar("Qualität", "audit_phase_templates", "audit_vorlagen"),
    Paar("Qualität", "audit_phase_template_steps", "audit_vorlage_schritte"),
    Paar("Qualität", "audit_category_links", "audit_kategorien"),
    Paar("Qualität", "audit_norm_references", "audit_normen"),
    Paar("Qualität", "audit_norm_links", "audit_normbezug"),
    Paar("Qualität", "audit_trail_entries", "audit_verlauf"),
    # --- Personal -----------------------------------------------------------
    Paar("Personal", "personio_employees", "personio_employees"),
    Paar("Personal", "personio_attendance", "personio_attendance"),
    Paar("Personal", "personio_absences", "personio_absences"),
    Paar("Personal", "personio_sync_meta", "personio_sync_meta"),
    Paar("Personal", "schulung_katalog", "schulung_katalog"),
    Paar("Personal", "schulung_pflicht", "schulung_pflicht",
         erwartet="das Kürzel-System entfällt: nur die grobe Personio-Ebene "
         "wandert als Geltung „abteilung“ mit, die feinen Kürzel-Pflichten "
         "nicht — im Neuen stehen also weniger Zeilen"),
    Paar("Personal", "schulung_rolle", "schulung_rollen"),
    Paar("Personal", "schulung_teilnahme", "schulung_teilnahmen"),
    Paar("Personal", "schulung_import", "schulung_importe"),
    Paar("Personal", "schulung_unterlage", "schulung_unterlagen"),
    Paar("Personal", "schulung_dokument", None,
         "zählt in dokumentvorgaenge mit — dort als Art „schulung“"),
    Paar("Personal", "schulung_zertifikat", "dokument_nachweise"),
    Paar("Personal", "onboarding_dokument", None,
         "der Einarbeitungsplan wird jetzt gerechnet statt abgelegt"),
    Paar("Personal", "kompetenz_matrix", "kompetenz_matrizen"),
    Paar("Personal", "kompetenz_kategorie", "kompetenz_kategorien"),
    Paar("Personal", "kompetenz_qualifikation", "kompetenz_qualifikationen"),
    Paar("Personal", "kompetenz_person", "kompetenz_personen"),
    Paar("Personal", "kompetenz_bewertung", "kompetenz_bewertungen"),
    Paar("Personal", "einarbeitung_katalog", "einarbeitung_katalog"),
    Paar("Personal", "einarbeitung_pflicht", "einarbeitung_pflicht"),
    Paar("Personal", "einarbeitung_dokument", "dokumentvorgaenge",
         erwartet="beide Vorgangsarten stehen neu in einer Tabelle — dazu "
         "kommen die Vorgänge aus schulung_dokument"),
    Paar("Personal", "onboarding_abteilung", "onboarding_abteilung"),
    Paar("Personal", "onboarding_paket_download", "onboarding_paket"),
    Paar("Personal", "onboarding_extern", "externe_personen"),
    Paar("Personal", "zeugnis", "zeugnisse"),
    Paar("Personal", "zeugnis_aussteller", "zeugnis_aussteller"),
    Paar("Personal", "zeugnis_vorlage", "zeugnis_notenvorlagen"),
    Paar("Personal", "zeugnis_baustein", "zeugnis_bausteine"),
    Paar("Personal", "zeugnis_bewertung", "zeugnis_bewertungen"),
    # --- ATR ----------------------------------------------------------------
    Paar("ATR", "atr_part", "atr_teile"),
    Paar("ATR", "atr_template", "atr_vorlagen"),
    Paar("ATR", "atr_delivery", "atr_lieferungen"),
    Paar("ATR", "atr_delivery_item", "atr_positionen"),
    # --- Produktion und Technik --------------------------------------------
    Paar("Produktion", "machines", "maschinen"),
    Paar("Produktion", "maintenance_tasks", "wartungsaufgaben"),
    Paar("Produktion", "maintenance_files", "wartungsdateien"),
    Paar("Produktion", "sensors", "sensoren"),
    Paar("Produktion", "sensor_readings", "sensor_messungen"),
    Paar("Produktion", "sensor_poll_log", "sensor_versuche"),
    # --- FAIR ---------------------------------------------------------------
    Paar("FAIR", "fair_projects", "fair_zeichnungen"),
    Paar("FAIR", "fair_balloons", "fair_ballons"),
    # --- Querschnitt --------------------------------------------------------
    Paar("Querschnitt", "newsletter", "newsletter"),
    Paar("Querschnitt", "newsletter_eintrag", "newsletter_eintrag"),
    Paar("Querschnitt", "newsletter_eintrag_bild", "newsletter_bild"),
    Paar("Querschnitt", "page_feedback", "feedback"),
    Paar("Querschnitt", "kpi_comment", "kpi_kommentare"),
    Paar("Querschnitt", "kpi_measure", "kpi_massnahmen"),
    Paar("Querschnitt", "app_settings", "hr_einstellungen",
         "aufgeteilt auf hr_einstellungen, zielwerte und geheimnisse",
         erwartet="aus einer Zeile mit siebzig Spalten werden drei Listen und "
         "neunzehn Zielwerte"),
    # --- bewusst nicht portiert --------------------------------------------
    Paar("Nicht portiert", "tippspiel_tips", None, "Tippspiel wird nicht übernommen"),
    Paar("Nicht portiert", "signage_media", None, "Signage liegt im Repo acm-signage"),
    Paar("Nicht portiert", "signage_playlists", None, "Signage liegt im Repo acm-signage"),
    Paar("Nicht portiert", "signage_devices", None, "Signage liegt im Repo acm-signage"),
    Paar("Nicht portiert", "signage_schedules", None, "Signage liegt im Repo acm-signage"),
    Paar("Nicht portiert", "signage_playlist_items", None, "Signage liegt im Repo acm-signage"),
    Paar("Nicht portiert", "signage_device_tags", None, "Signage liegt im Repo acm-signage"),
    Paar("Nicht portiert", "signage_device_tag_map", None, "Signage liegt im Repo acm-signage"),
    Paar("Nicht portiert", "signage_playlist_tag_map", None, "Signage liegt im Repo acm-signage"),
    Paar("Nicht portiert", "signage_pairing_sessions", None, "Signage liegt im Repo acm-signage"),
    Paar("Nicht portiert", "signage_heartbeat_event", None, "Signage liegt im Repo acm-signage"),
]


@dataclass
class Zeile:
    modul: str
    alt: str | None
    neu: str | None
    alt_zeilen: int | None
    neu_zeilen: int | None
    hinweis: str
    erwartet: str = ""

    @property
    def stimmt(self) -> bool:
        """Zwei Zahlen, die beide dastehen, müssen gleich sein. Fehlt eine
        Seite absichtlich, gibt es nichts zu vergleichen — und eine begründet
        erwartete Abweichung ist kein Befund, sondern eine Entscheidung."""
        if self.alt is None or self.neu is None or self.erwartet:
            return True
        return self.alt_zeilen == self.neu_zeilen

    @property
    def weicht_ab(self) -> bool:
        """Ob die Zahlen auseinandergehen — auch dann, wenn es so gewollt ist."""
        if self.alt is None or self.neu is None:
            return False
        return self.alt_zeilen != self.neu_zeilen


def _zaehle_alt(quelle: sa.engine.Engine, tabelle: str) -> int | None:
    with quelle.connect() as verbindung:
        da = verbindung.execute(
            sa.text("select to_regclass(:t) is not null"), {"t": f"public.{tabelle}"}
        ).scalar()
        if not da:
            return None
        return verbindung.execute(sa.text(f"select count(*) from public.{tabelle}")).scalar()


async def _zaehle_neu(tabelle: str) -> int | None:
    async with SessionLocal() as sitzung:
        da = (
            await sitzung.execute(
                sa.text("select to_regclass(:t) is not null"), {"t": f"public.{tabelle}"}
            )
        ).scalar()
        if not da:
            return None
        return (await sitzung.execute(sa.text(f"select count(*) from public.{tabelle}"))).scalar()


async def vergleiche(quelle: sa.engine.Engine) -> list[Zeile]:
    zeilen: list[Zeile] = []
    for p in PAARE:
        zeilen.append(
            Zeile(
                modul=p.modul,
                alt=p.alt,
                neu=p.neu,
                alt_zeilen=_zaehle_alt(quelle, p.alt) if p.alt else None,
                neu_zeilen=await _zaehle_neu(p.neu) if p.neu else None,
                hinweis=p.hinweis,
                erwartet=p.erwartet,
            )
        )
    return zeilen
