# Lieferungen: Spaltenherkunft und Abgleich mit den Apollo-Listen

Stand 23.11.2026. Referenz sind die Apollo-Listen, mit denen die Plattform bisher von Hand befüllt
wurde (Oktober 2026, `KPIs/2026/Rohdaten/Oktober_26`, Stand 04.11.2026). Jede Spalte, die ein
Plattform-Parser liest (`services/compute/app/parsing/*.py`), wurde Zeile für Zeile auf ihre
Apollo-Quelle zurückgeführt. Die Regeln stehen in `apollo_sync/feeds.py`, die Tests in
`tests/test_feeds_mapping.py`.

## Warum nicht mehr der alte Worker

Die erste Portierung übernahm `odbc-worker/worker.py` 1:1. Der Worker war nie in Betrieb, und seine
Dateien weichen von den Apollo-Listen ab:

- Namen, Orte, Artikelbezeichnungen, Mengeneinheiten, Fremdnummern leer → Kundenanteil nicht
  berechenbar, Lieferanten/Werkbänke nicht trennbar.
- `Adr Nr.` = interne Adress-ID statt Adressnummer; `Pos Typ 2`, `WGR` = interne IDs statt Codes.
- Unterpositionen (`UPos`) fest `0` → doppelte Schlüssel, 1.355 Auftragspositionen verworfen.
- Interessenten: Tabulator im Namen verschiebt die Spalten, die Datei ist nicht lesbar.
- Liefertreue Einkauf aus **Verkaufs**aufträgen statt aus Bestellungen (OTD-Quote weit über dem Wert der Apollo-Liste).

## Schlüsseltabelle `nvs_std`

Codefelder sind Satz-IDs oder laufende Nummern in `nvs_std`. Das Datenwörterbuch `dic_std` nennt je
Feld den Schlüsseltyp (`dic_typ` = `nvs_typ`). Deutsch ist `nvs_sprache = 2`; mandantenbezogene
Einträge gehen vor Mandant 0.

| Feld | Typ | Nachschlagen über | Beispiel |
|---|---:|---|---|
| `pos_einh` (ME) | 13 | `nvs_nr` | 1 → `STK` |
| `pos_wgr` (WGR) | 14 | `nvs_id` | 338037 → `DIENST` |
| `kpf_waehrung` (WAHR) | 7 | `nvs_nr` | 11 → `USD` |
| `kpf_art` (AA) | 250 | `nvs_nr` | 1 → `STD` |
| `kpf_art2` (Typ 2) | 48 | `nvs_nr` | |
| `kpf_rabatt_aktion` | 74 | `nvs_nr` | |
| `vrg_typ`, `vrg_art` (Kontakte) | 69 | `nvs_id` | 340521 → `ERS` |

`pos_typ2` (`Pos Typ 2`) zeigt auf keine Tabelle, die der Server ausliefert (alle kleinen Tabellen nach
den IDs durchsucht). Zuordnung per Korrelation: 337647 `AV-P`, 337648 `AV-F`, 337650 `AB`, 338094 `OWB`,
340358 `AV-S`. Keine Kennzahl liest das Feld (`SERIENGESCHAEFT_POS_TYP_2` ist leer).

## Spalten je Lieferung

**AswKpf_ANG/AUF/RG (Köpfe):** `Adr Nr.`, `Name 1–3`, `Ort` aus `adr_std` über `kpf_adr_id`;
`Erfasst durch` = `kpf_user_save`; `Geändert durch` = `kpf_user_edit`; `Anz Pos` = Anzahl aller
Positionszeilen des Belegs (378/378 Rechnungen); `eigene Währung` = EUR.

**AswKpf_AUF/LS/WE (Positionen):** `UPos` = `pos_unterpos`; `Bezeichnung 1` = `pos_bez1`;
`Fremdnr` = `pos_artnr_kd`; `Restmenge` = `pos_menge_rest`; `Sperre manuell`/`Sperre K-Limit` =
`kpf_sperre`/`kpf_sperrkz`. Lieferschein zusätzlich `Auftrag`, `Pos` (Auftrag und Position der
Auftragszeile, 1.906/1.909). Wareneingang zusätzlich `Bestellung`, `Datum` (Bestellkopf, 222/222),
`WGR`, `EK Konto` = `stm_konto_ek` des Artikels (222/222).

**Gesperrte Artikel** (`stm_sperr_date`): Lieferscheine blenden eine Zeile aus, wenn das Sperrdatum am
oder nach dem Lieferdatum liegt; Wareneingänge und Liefertreue blenden jeden Artikel mit Sperrdatum
aus (2/2 bzw. 7/7 im Abgleich); Auftragspositionen filtern nicht.

**8D:** Aussteller, Teamleiter, Teammitglieder, Nr. extern, akzeptiert/abgelehnt (J/N), akzeptiert am,
Bemerkung, Merkmal 1–10, Problembeschreibung, Sofortmaßnahme, Ursache, Abschluss aus `rek_std`;
`Adress Nr.`/`Adressen` aus `adr_std`; `Bezeichnung` = `stm_bez1` + `stm_bez2`; `Vorgang` = Belegnummer
zu `rek_kpf_id`; `Status` = Ampel (`0` rot, `1` gelb, `2` blau, `3` weiß, `4` grün). Zeilenumbrüche in
Memos werden zu Leerzeichen wie im Export.

**Kontakte:** `Typ`/`Art` über `nvs_id`; `Textfeld` = `vrg_memo`; zweites `Typ` = Belegart (`BES` für
Bestellungen ergänzt).

**Lagerbewegungen:** `Bezeichnung 1` = `stm_bez1`, `Benutzer` = `bestand_user`. `Kommentar` bleibt leer:
die Apollo-Liste setzt ihn aus dem Buchungsbeleg zusammen, `bestand_kommentar` enthält interne Marker.
Keine Kennzahl liest ihn.

**Interessenten:** `adr_typ = 8` des Mandanten **ohne gelöschte** Adressen (1.876 = 1.876).

**Liefertreue Einkauf:** eine Zeile je Wareneingangsposition mit der Bestellzeile, die sie bucht.
`Lieferdatum` = Wunschtermin der Bestellzeile, sonst ihr Liefertermin; `Verzug (Tage)` = Arbeitstage
(Mo–Fr) bis zum Wareneingang (730/734); ohne Bestellung `Auftrag 0`, `Pos 0`, Verzug 0. Sortiert nach
Wareneingang/Position wie die Liste — die Plattform behält je Bestellzeile die erste Zeile. Zeitraum:
Wareneingänge des laufenden Jahres, wie die Liste; mit Vorjahreszeilen zählte eine über den
Jahreswechsel gelieferte Bestellzeile mit ihrem alten Wareneingang.

## Abgleich Oktober 2026

Beide Seiten mit den Plattform-Parsern gelesen, Feld für Feld je Schlüssel im Zeitraum der Liste
(`tools/extrakt_abgleich.py`, für jeden weiteren Monat wiederholbar).

| Lieferung | Ergebnis |
|---|---|
| Angebote, Wareneingänge, Materialpreise | alle Felder identisch |
| Liefertreue Einkauf | 619 = 619 Schlüssel; 3 Verzugswerte ±1 Tag |
| Rechnungen, Aufträge, Auftragspositionen | Abweichungen nur in Belegen, die nach dem 04.11. geändert wurden (alle 307 Positionswerte) |
| Kontakte | 326 von 331 identisch; Rest nachträglich verknüpft/umbenannt |
| 8D | 8 Texte: Apollo behält oder entfernt Anführungszeichen uneinheitlich; apollo-sync liefert den gespeicherten Text |
| Lagerbewegungen | 9.962 identisch; Mehrzeilen = nach dem 04.11. rückdatierte Buchungen |

Kennzahlen Oktober 2026 (Plattform-Rechenwege): Angebote, Erstkontakte, Audit-Findings, OTD-Quote
(Positionen, Quote, Ø Verzug) und die Nenner von On Quality Lieferanten/Werkbänke stimmen
exakt. Umsatz und Aufträge weichen nur um die später geänderten Belege ab.

## Hinweis an die Plattform (nicht apollo-sync)

Die Lieferschein-Excel aus Apollo enthält echte Datums- und Zahlzellen. Der Parser liest sie als Text
(`2026-09-01 00:00:00`, `552.12`) und deutet sie deutsch: kein Lieferdatum, Werte ×100. Folge in der
Plattform für Oktober: gelieferte Menge 0, On Quality Kunde ohne Quote, fast alle Aufträge gelten als überfällig.
apollo-sync schreibt Text im deutschen Format und ist davon nicht betroffen; die Korrektur gehört in
`services/compute/app/parsing/positionen.py` bzw. `german.parse_date`.

## Test-Datenbank

Alle Spalten, die die Lieferungen lesen, wurden auf `Test` gegen die Produktion geprüft (gleiche
Satz-ID, 23.11.2026): `adr_std`, `meld_std`, `nvs_std`, `rek_std`, `stm_std`, `vrg_std`, `fa_std` 100 %
gleich; `kpf_std`/`pos_std` 93–100 % (Belege, die nach der Kopie im Oktober geändert wurden);
`bestand_std` inhaltlich gleich, aber in der Produktion nach der Kopie umorganisiert (andere Satz-IDs
und Zeilenzahl). Test-Läufe sind also für Datenprüfungen brauchbar.

Nur die Projektion **aller 790 Spalten** von `stm_std` liefert auf Test ab Feld 82 Werte aus anderen
Feldern (Projektionsstelle 82 liefert, was in der Produktion an Stelle 279 steht). Stelle 279 liegt
etwa am Anfang des zweiten Frames, in die das Projektionsprogramm aufgeteilt wird (4.468 Byte, 16 Byte
je Feld) — vermutlich die Ursache, nicht bewiesen. Mit wenigen Spalten (wie in den Lieferungen) stimmt
alles; das Lesen dieser einen Breite auf Test bricht mit Incident ab.
