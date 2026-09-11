"""Qualitätsdaten aus lumeapps übernehmen: Prüfberichte und das Auditmodul.

Zwei Stränge, die nichts miteinander zu tun haben und nur denselben Fachbereich
teilen:

* **Prüfberichte** (`quality_records`, `inspection_records`) sind eingelesene
  Dateien. Beide Seiten führen dieselben Spaltennamen — nur die Reihenfolge in
  der Tabelle unterscheidet sich, und die spielt beim Einfügen keine Rolle.
  Beide hängen über `upload_batch_id` am Protokoll; die Elterntabelle bringt
  `vertrieb_einkauf` mit, das vor diesem Modul läuft. Hier steht deshalb nur
  der Verweis, übersetzt wird er vom Motor.

* **Audit** ist Spalte für Spalte ins Deutsche umbenannt worden
  (`title → titel`, `created_at → erstellt_am`, `norm_reference_id → norm_id`).
  Die Form ist dieselbe geblieben, die Prüfbedingungen ebenfalls — mit einer
  Ausnahme: der Verlauf kennt neue Namen für seine Aktionen (siehe unten).

**Schlüssel.** Die Audit-Tabellen führen beidseitig `uuid`, also wandert der
alte Schlüssel mit (`id_aus="alt"`). Das ist hier mehr als bequem: dadurch
stimmt jeder Verweis zwischen den Audit-Tabellen ohne eine einzige Übersetzung
— auch `audit_verlauf.entitaet_id`, das auf Audits *und* Normen zeigt und für
das es gar keine Verweisspalte gäbe. Aus demselben Grund steht in `verweise`
nur `upload_batch_id`: ein Verweis auf eine Tabelle mit `id_aus="alt"` würde
vom Motor in der (leeren) Zuordnung nachgeschlagen und käme als `NULL` zurück.

Drei Tabellen weichen davon ab:

* `audit_kategorien` und `audit_normbezug` sind im neuen Stack echte
  Verknüpfungstabellen — der zusammengesetzte Schlüssel *ist* die Zeile, eine
  Spalte `id` gibt es nicht mehr. Also `id_aus=None` und `schluessel` auf den
  Primärschlüssel.
* `audit_verlauf` vergibt eine `bigint`-Identity statt einer UUID, also
  ebenfalls `id_aus=None`. Gelesen wird nach `occurred_at`, damit die neuen
  Nummern derselben Reihenfolge folgen wie die Zeit.

**Wiederholbarkeit.** Überall dort, wo es einen natürlichen Schlüssel gibt,
steht er in `schluessel`; ein zweiter Lauf fügt dann nichts doppelt ein.
`inspection_records` und `audit_verlauf` haben im neuen Stack keinen — dort
bleibt es beim Primärschlüssel, der bei einer Identity-Spalte nie kollidiert,
weil der Wert gar nicht mitgeschickt wird. Ein zweiter Lauf verdoppelt diese
beiden Tabellen also. Das ist keine Nachlässigkeit, sondern der Zustand der
Zieltabellen; ein Index nur für die Übernahme wäre der falsche Preis.
"""
from __future__ import annotations

from app.uebernahme.motor import Umzug

#: Der alte Verlauf nennt seine Aktionen englisch, der neue deutsch — und die
#: neue Prüfbedingung lässt nur die deutschen zu. Ohne diese Abbildung stünde
#: der ganze Lauf. Abgebildet werden alle fünf alten Werte, nicht nur die im
#: Abzug vorkommenden ('create'), damit ein späterer Lauf gegen einen frischeren
#: Abzug nicht an einem Wert scheitert, der heute zufällig fehlt.
AKTION = {
    "create": "angelegt",
    "update": "geaendert",
    "delete": "geloescht",
    "status_change": "status",
    "phase_skip": "uebersprungen",
}

#: Der alte Verlauf benennt die Entität nach dem Fachbegriff, der neue Trigger
#: schreibt dort den Tabellennamen (`tg_table_name`). Die Maske vergleicht
#: gegen `audits` — ohne diese Abbildung stünde neben den übernommenen Einträgen
#: „Phase", wo „Audit" gehört. Kein Prüfzwang der Datenbank, nur Lesbarkeit.
ENTITAET = {
    "audit": "audits",
    "audit_phase": "audit_phasen",
    "audit_norm_reference": "audit_normen",
    "audit_phase_template": "audit_vorlagen",
}


def _aktion(wert: str) -> str:
    return AKTION.get(wert, wert)


def _entitaet(wert: str) -> str:
    return ENTITAET.get(wert, wert)


def _wer(rolle: str | None) -> str | None:
    """Aus der alten Rolle eine lesbare Spur machen.

    Die alte Tabelle weiß nur die Rolle — in der Produktion durchgehend
    `admin` — und dazu eine Platzhalter-UUID, die in keinem der beiden Systeme
    eine Person ist. `wer_email` ist die Spalte, die die Maske anzeigt; dort
    „admin" allein hinzuschreiben sähe aus wie eine Adresse. Der Zusatz sagt,
    woher der Eintrag kommt und dass dahinter kein Konto steht.
    """
    return f"{rolle} (Altsystem)" if rolle else None


UMZUEGE: list[Umzug] = [
    # --- Prüfberichte -------------------------------------------------------
    # Namensgleich auf beiden Seiten. `imported_at` gibt es nur neu und bleibt
    # bei der Vorgabe der Datenbank: wann die Zeile eingelesen wurde, weiß die
    # alte Tabelle nicht, und `now()` ist wenigstens ehrlich der Zeitpunkt der
    # Übernahme. Gelesen wird nach alter `id`, damit die neu vergebenen
    # Nummern in derselben Reihenfolge stehen — das macht den Vergleich
    # zwischen den Systemen lesbar.
    Umzug(
        alt="quality_records",
        neu="quality_records",
        # Natürlicher Schlüssel: die Berichtsnummer ist auf beiden Seiten
        # eindeutig. Damit ist ein zweiter Lauf folgenlos.
        schluessel=("report_nr",),
        sortierung="id",
        verweise={"upload_batch_id": "upload_batches"},
        spalten={
            "report_nr": "report_nr",
            "report_date": "report_date",
            "art": "art",
            # Die Prüfbedingung auf `level` (NULL, 1 oder 2) steht beidseitig
            # gleich; im Abzug kommen nur NULL, 1 und 2 vor.
            "level": "level",
            "issuer": "issuer",
            "customer_name": "customer_name",
            "customer_id": "customer_id",
            "designation": "designation",
            "status_code": "status_code",
            "problem_description": "problem_description",
            "root_cause": "root_cause",
            "quantity": "quantity",
            "accepted_quantity": "accepted_quantity",
            # Alt: nicht null. Neu: nullbar mit `on delete set null`. Findet
            # der Motor das Protokoll nicht, verliert die Zeile nur den
            # Verweis — die Nutzlast bleibt.
            "upload_batch_id": "upload_batch_id",
            "raw": "raw",
        },
    ),
    Umzug(
        alt="inspection_records",
        neu="inspection_records",
        # Kein natürlicher Schlüssel in der neuen Tabelle (siehe Modulkopf),
        # deshalb der Primärschlüssel — der bei einer Identity-Spalte nie
        # kollidiert.
        sortierung="id",
        verweise={"upload_batch_id": "upload_batches"},
        spalten={
            "pruef_datum": "pruef_datum",
            "pruef_zeit": "pruef_zeit",
            "benutzer": "benutzer",
            "fa": "fa",
            "artikel": "artikel",
            "bezeichnung": "bezeichnung",
            "buchungs_menge": "buchungs_menge",
            "ausschuss_menge": "ausschuss_menge",
            "produktgruppe": "produktgruppe",
            "typ": "typ",
            # Prüfbedingung beidseitig `large` oder `small`; im Abzug kommt
            # auch nichts anderes vor.
            "size_class": "size_class",
            "rsc": "rsc",
            "excluded": "excluded",
            "upload_batch_id": "upload_batch_id",
            "raw": "raw",
        },
    ),
    # --- Audit-Stammdaten ---------------------------------------------------
    # Normen zuerst: `audit_normbezug` verweist darauf, und der Fremdschlüssel
    # steht auf `restrict`.
    Umzug(
        alt="audit_norm_references",
        neu="audit_normen",
        id_aus="alt",
        spalten={
            "regelwerk": "regulation",
            "revision": "revision",
            "klausel": "clause",
            "kurztext": "short_text",
            "gueltig_ab": "valid_from",
            "gueltig_bis": "valid_to",
            "geprueft": "verified",
            "aktiv": "active",
            "erstellt_am": "created_at",
            "geaendert_am": "updated_at",
        },
    ),
    Umzug(
        alt="audit_phase_templates",
        neu="audit_vorlagen",
        id_aus="alt",
        spalten={
            "name": "name",
            # Alt prüft „NULL oder eine der vier", neu nur „eine der vier" —
            # gleichbedeutend, weil eine Prüfbedingung über NULL nicht
            # verletzt wird und die Spalte nullbar ist. Die einzige Vorlage im
            # Abzug führt hier NULL.
            "kategorie": "audit_category",
            "beschreibung": "description",
            "aktiv": "active",
            "erstellt_am": "created_at",
            "geaendert_am": "updated_at",
        },
    ),
    Umzug(
        alt="audit_phase_template_steps",
        neu="audit_vorlage_schritte",
        id_aus="alt",
        # `vorlage_id` kommt unübersetzt durch: die Vorlagen wandern mit ihrem
        # alten Schlüssel (siehe Modulkopf).
        spalten={
            "vorlage_id": "template_id",
            "position": "position",
            "titel": "title",
            "beschreibung": "description",
            "pflicht": "mandatory",
        },
    ),
    # --- Audits und was an ihnen hängt --------------------------------------
    Umzug(
        alt="audits",
        neu="audits",
        id_aus="alt",
        spalten={
            "nummer": "audit_number",
            "titel": "title",
            # Prüfbedingung beidseitig `intern` oder `extern`.
            "art": "audit_type",
            "bereich": "scope_label",
            "ziel": "objective",
            "leitender_auditor": "lead_auditor",
            "team": "audit_team",
            "geplant_von": "planned_start",
            "geplant_bis": "planned_end",
            # 1 bis 3 auf beiden Seiten.
            "prioritaet": "priority",
            # Die acht Statuswerte sind wörtlich dieselben geblieben.
            "status": "status",
            "vorlage_id": "template_id",
            "erstellt_am": "created_at",
            "geaendert_am": "updated_at",
        },
    ),
    Umzug(
        alt="audit_phases",
        neu="audit_phasen",
        id_aus="alt",
        # Nicht `id`, sondern die Position im Audit. Grund: an `audits` hängt
        # im neuen Stack der Trigger `audit_phasen_aus_vorlage` — ein Audit mit
        # Vorlage bekommt seine Phasen beim Einfügen von selbst, und alle 21
        # Audits im Abzug haben eine Vorlage. Die übernommenen Phasen treffen
        # deshalb auf bereits vorhandene mit derselben (audit_id, position).
        # Über den Primärschlüssel liefe das in eine Verletzung der
        # Eindeutigkeit und risse den Lauf ab; über die Position greift
        # `do nothing`, und es bleibt bei den vom Trigger erzeugten Zeilen.
        # Inhaltlich sind das dieselben — die alten Phasen sind unveränderte
        # Kopien derselben Vorlage. Was dabei verloren geht, steht im Bericht.
        schluessel=("audit_id", "position"),
        spalten={
            "audit_id": "audit_id",
            "position": "position",
            "titel": "title",
            "beschreibung": "description",
            "pflicht": "mandatory",
            # Vier Statuswerte, wörtlich gleich; die Bedingungen „erledigt
            # braucht ein Datum" und „Pflichtphase entfällt nur mit Grund"
            # stehen beidseitig gleich.
            "status": "status",
            "verantwortlich": "responsible",
            "faellig_am": "due_date",
            "erledigt_am": "completed_on",
            "kommentar": "comment",
            "uebersprungen_warum": "skip_reason",
            "erstellt_am": "created_at",
            "geaendert_am": "updated_at",
        },
    ),
    Umzug(
        alt="audit_category_links",
        neu="audit_kategorien",
        # Verknüpfungstabelle ohne eigene `id`: der zusammengesetzte Schlüssel
        # ist die Zeile. Der alte Schlüssel hat damit kein Ziel und fällt weg.
        id_aus=None,
        alt_id=True,
        schluessel=("audit_id", "kategorie"),
        spalten={
            "audit_id": "audit_id",
            # Dieselben vier Kategorien wie alt; im Abzug nur `prozess` und
            # `produkt`.
            "kategorie": "category",
        },
    ),
    Umzug(
        alt="audit_norm_links",
        neu="audit_normbezug",
        id_aus=None,
        alt_id=True,
        schluessel=("audit_id", "norm_id"),
        spalten={
            "audit_id": "audit_id",
            "norm_id": "norm_reference_id",
        },
    ),
    # --- Verlauf ------------------------------------------------------------
    # Zuletzt, obwohl kein Fremdschlüssel es verlangt: `entitaet_id` zeigt auf
    # Audits und Normen, und ein Verlauf, der vor seinem Gegenstand dasteht,
    # wäre beim Nachsehen wertlos.
    Umzug(
        alt="audit_trail_entries",
        neu="audit_verlauf",
        # Neu eine bigint-Identity statt einer UUID. Gelesen wird nach
        # Zeitpunkt, damit die vergebenen Nummern der Reihenfolge der
        # Ereignisse folgen.
        id_aus=None,
        sortierung="occurred_at",
        wandler={"aktion": _aktion, "entitaet": _entitaet, "wer_email": _wer},
        spalten={
            "audit_id": "audit_id",
            "entitaet": "entity_type",
            "entitaet_id": "entity_id",
            "aktion": "action",
            "feld": "field",
            "alt": "old_value",
            "neu": "new_value",
            "grund": "reason",
            # `wer` (neu: die echte Kennung aus dem Token) bleibt leer — siehe
            # `_wer`. Die Rolle ist alles, was der alte Eintrag über den
            # Handelnden hergibt, und sie landet in der Spalte, die die Maske
            # zeigt.
            "wer_email": "actor_role",
            "wann": "occurred_at",
        },
    ),
]
