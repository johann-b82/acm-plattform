"""Die eine Zeile `app_settings` auseinandernehmen.

Im Altprojekt steht alles Einstellbare in einer Zeile mit siebzig Spalten: die
Zielwerte der Kennzahlen, die Personio-Listen, das Logo, die ATR-Pfade, die
SMB-Zugangsdaten, die Farben. Im neuen Stack ist das aufgeteilt — Zielwerte in
`zielwerte`, die HR-Listen in `hr_einstellungen`, Geheimnisse in
`geheimnisse`, Pfade und Farben in die Umgebung.

Deshalb geht dieser Umzug nicht über den Motor: aus einer Zeile werden
zwanzig, und die Zielzeilen **gibt es schon** (die Migration legt sie mit
Vorgabewerten an). Geschrieben wird also aktualisierend, nicht einfügend.

Was hier **nicht** mitkommt und warum:

* `personio_client_id_enc` / `personio_client_secret_enc` — mit dem alten
  Schlüssel verschlüsselt, den dieser Dienst nicht hat. Die Zugangsdaten
  werden über Einstellungen → Personal neu eingetragen.
* `atr_smb_password_enc`, `worldcup_api_key_enc`, die E-Mail-Geheimnisse —
  dasselbe, und E-Mail und Tippspiel kommen ohnehin nicht mit.
* `logo_data` — 220 KB PNG in der Datenbank. Der neue Stack legt das Logo in
  den Speicher und merkt sich nur den Pfad; das ist ein Datei-Umzug und kein
  Zeilen-Umzug, er steht in `docs/cutover.md`.
* Farben, `app_name`, `timezone`, die ATR-Pfade und -Fristen — die stehen im
  neuen Stack in der Umgebung, nicht in der Datenbank.
"""
from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa

from app.db import SessionLocal

#: Alte Spalte → neuer Schlüssel in `zielwerte`. Was hier fehlt, hat im neuen
#: Stack keine Entsprechung; das steht unten in `OHNE_ZUHAUSE`.
ZIELWERTE = {
    "target_audit_findings_level1": "qualitaet_audit_level1",
    "target_audit_findings_level2": "qualitaet_audit_level2",
    "target_complaint_rate_customer": "qualitaet_reklamation_kunde",
    "target_complaint_rate_internal": "qualitaet_reklamation_intern",
    "target_complaint_rate_subcontractor": "qualitaet_reklamation_werkbank",
    "target_complaint_rate_supplier": "qualitaet_reklamation_lieferant",
    "target_fluctuation": "hr_fluktuation",
    "target_inspection_large": "qualitaet_pruefung_gross",
    "target_inspection_small": "qualitaet_pruefung_klein",
    "target_material_cost_ratio": "finanzen_materialkostenquote",
    "target_overtime_ratio": "hr_ueberstunden",
    "target_personnel_cost_ratio": "finanzen_personalkostenquote",
    "target_produktion_verzug": "produktion_verzug",
    "target_sales_angebote_eur": "vertrieb_angebote_eur",
    "target_sales_besuche": "vertrieb_besuche",
    "target_sales_erstkontakte": "vertrieb_erstkontakte",
    "target_sales_interessenten": "vertrieb_interessenten",
    "target_sales_orders_per_rep_eur": "vertrieb_auftraege_eur",
    "target_sick_leave_ratio": "hr_krankheit",
}

#: Zielwerte des Altprojekts ohne Gegenstück. `target_inspection_total` steht
#: dort leer; `target_revenue_per_employee` gehört zu einer Kennzahl, die der
#: neue Stack nicht führt.
OHNE_ZUHAUSE = ("target_inspection_total", "target_revenue_per_employee")

#: Alte Spalte → Schlüssel in `hr_einstellungen`. Die Werte stehen dort als
#: JSON-Liste und im Neuen als Textfeld-Liste.
HR_LISTEN = {
    "personio_sick_leave_type_id": "krank_typ_ids",
    "personio_production_dept": "produktion_abteilungen",
    "personio_skill_attr_key": "kompetenz_attribute",
}


def _liste(wert: Any) -> list[str]:
    """Die alte Spalte hält JSON — mal als Text, mal schon ausgepackt."""
    if wert is None:
        return []
    if isinstance(wert, str):
        try:
            wert = json.loads(wert)
        except ValueError:
            return [t.strip() for t in wert.split(",") if t.strip()]
    if isinstance(wert, list):
        return [str(e).strip() for e in wert if str(e).strip()]
    return [str(wert)]


async def uebernehmen(quelle: sa.engine.Engine) -> dict[str, int]:
    spalten = sorted({*ZIELWERTE, *HR_LISTEN})
    with quelle.connect() as verbindung:
        zeile = verbindung.execute(
            sa.text(f"select {', '.join(spalten)} from public.app_settings order by id limit 1")
        ).mappings().first()
    if zeile is None:
        return {"zielwerte": 0, "hr_einstellungen": 0}

    bericht = {"zielwerte": 0, "hr_einstellungen": 0}
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            for alte_spalte, schluessel in ZIELWERTE.items():
                wert = zeile[alte_spalte]
                if wert is None:
                    continue
                ergebnis = await sitzung.execute(
                    sa.text(
                        "update public.zielwerte set wert = :w, geaendert_am = now()"
                        " where schluessel = :s"
                    ),
                    {"w": wert, "s": schluessel},
                )
                bericht["zielwerte"] += ergebnis.rowcount
            for alte_spalte, schluessel in HR_LISTEN.items():
                werte = _liste(zeile[alte_spalte])
                ergebnis = await sitzung.execute(
                    sa.text(
                        "update public.hr_einstellungen set werte = :w, geaendert_am = now()"
                        " where schluessel = :s"
                    ),
                    {"w": werte, "s": schluessel},
                )
                bericht["hr_einstellungen"] += ergebnis.rowcount
    return bericht
