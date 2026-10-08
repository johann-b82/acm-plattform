# ODBC-Worker (Apollo → ACM-Plattform)

Liest Apollo (CONZEPT 16) per ODBC und füllt die Plattform-Tabellen über deren
API — als Live-Ersatz für die monatlichen Extrakt-Uploads. Gesteuert und
überwacht wird der Worker **von der Plattform** aus.

> **VM-Vorgabe und Einrichtung Schritt für Schritt: [vm-setup.md](vm-setup.md).**
> Diese README ist der Kurzüberblick + Artenspezifikation.

> **Hinweis zu `../`-Verweisen:** Die Apollo-Reverse-Engineering-Doku
> (`MAPPING.md`, `ERKENNTNISSE.md`, `compare.py`, `fetch-*.ps1`, `kpi/*.py`) liegt
> im separaten Analyse-Workspace `apollo-datenbankstruktur` (nicht in diesem
> Repo). `../`-Pfade unten beziehen sich darauf.

**Alle 14 Arten sind verdrahtet.** Sieben sind bestätigt (umsatz, auftraege,
angebote, lagerpreise, acht_d, kontakte, interessenten), sieben lauffähig und
vor dem Produktivbetrieb gegen einen echten Extrakt zu prüfen
(auftragspositionen, lieferscheine, wareneingaenge, materialpreise,
lagerbewegungen, pruefungen, liefertreue).

## Warum ein eigener Windows-Worker

Der CONZEPT-16-ODBC-Treiber ist **32-bit-Windows-only**; der `compute`-Dienst
der Plattform läuft unter Linux/Docker und kann ihn nicht nutzen. Der Worker
läuft deshalb auf einer **minimalen Windows-VM** (nur ODBC-Treiber + 32-bit-
Python + dieser Ordner) und braucht **nur ausgehende** Verbindungen:

```
Apollo ──(32-bit ODBC, read-only)──▶ worker.py ──POST /api/odbc/<art>──▶ Plattform (Caddy :80)
                                     Header X-ODBC-Token            compute: gleicher Parser
                                                                    wie beim Upload → Tabellen
                                                                    → KPI-SQL (unverändert)
```

Die Plattform entscheidet über den Umschalter `Einstellungen → Datenquelle`:
steht er auf **ODBC**, nimmt `/api/odbc/*` an und die manuellen Uploads sind
gesperrt (409); steht er auf **Extrakte**, ist es umgekehrt.

## Steuern und Überwachen (von der Plattform)

Die VM arbeitet ausgehend und nimmt keine Befehle an. Steuerung und Status
laufen deshalb spiegelbildlich über zwei weitere Endpunkte:

- **`GET /api/odbc/konfig`** — der Worker *holt* Intervall, aktive Arten und
  einen etwaigen „jetzt synchronisieren"-Auftrag.
- **`POST /api/odbc/status`** — der Worker *meldet* Herzschlag und je Art den
  letzten Lauf (Zeit, Zeilen, Dauer, Fehler).

In der Oberfläche steht beides unter *Einstellungen → Datenquelle → Worker*:
online/offline, Version, Host, letzte Läufe, Sync-Intervall, aktive Arten und
„Jetzt synchronisieren".

## Lauf

```
py -3-32 worker.py --art umsatz --dry-run   # nur Datei erzeugen, nicht senden
py -3-32 worker.py --art umsatz             # eine Art senden
py -3-32 worker.py --alle                   # alle verdrahteten Arten (einmalig)
py -3-32 worker.py --dienst                 # Dauerbetrieb: Konfig holen, zyklisch syncen
```

Für den Dauerbetrieb `--dienst` per **Aufgabenplanung** („Bei Systemstart")
oder **NSSM** als Windows-Dienst starten — Takt und aktive Arten kommen dann
aus der Plattform. Details in [vm-setup.md](vm-setup.md).

## Sicherheit

- Nur ausgehend: Apollo-TCP (ODBC) und HTTPS/HTTP zur Plattform. Keine offenen
  Ports auf der VM.
- Apollo wird **nur lesend** abgefragt.
- Authentifizierung gegen die Plattform allein über `X-ODBC-Token` (Shared
  Secret); kein Datenbank-/`service_role`-Zugang auf der Windows-Seite.
- `worker.env` enthält Geheimnisse → nicht einchecken (Apollo-Passwort ggf.
  per Windows-DPAPI statt im Klartext).

## Spezifikation der 14 Arten

Jede Art erzeugt die Datei im Format des jeweiligen Plattform-Parsers
(`services/compute/app/parsing/*.py`) und POSTet an `/api/odbc/<art>`.
Belegtypen/Felder sind in `../MAPPING.md` hergeleitet.

Status: **✅** bestätigt gegen Plattform/Extrakt · **🟡** lauffähig, Format aus
dem Parser abgeleitet — vor dem Scharfschalten mit `../compare.py` gegen einen
echten Extrakt prüfen · **⚠️** Mapping offen, Stub liefert bewusst nichts.

| Art | Apollo-Quelle (Abfrage) | Zielformat / Datei | Status |
|---|---|---|---|
| `umsatz` | `kpf_std` typ 6+7, md 1 | AswKpf_RG (typ→RG/GS) | ✅ |
| `auftraege` | `kpf_std` typ 1, md 1 | AswKpf_AUF (Kopf) | ✅ |
| `angebote` | `kpf_std` typ 2, md 1 | AswKpf_ANG | ✅ |
| `lagerpreise` | `stm_std.stm_sk_kalk` <> 0 (Lagerbewertung) | AswLagBew-Preiskonditionen | ✅ |
| `acht_d` | `rek_std` (`rek_art`; Level über `rek_stm_id`→`stm_artnr` 39777/39778) | 8D | ✅ |
| `auftragspositionen` | `pos_std` typ 1 ⋈ `kpf_std` (Vorgang Nr.) | AswKpf_AUF (Positionen) | 🟡 ME-Code, UPos |
| `lieferscheine` | `pos_std` typ 5 ⋈ Vaterbeleg (Auftrag Nr.) | AswKpf_LS (**.xlsx**) | 🟡 Vater-Join |
| `wareneingaenge` | `pos_std` typ 8 ⋈ `kpf_std`, `pos_wgr` | AswKpf_WE | 🟡 WGR-Code |
| `materialpreise` | dieselbe WE-Datei (eigener Zielimport) | AswKpf_WE | 🟡 wie WE |
| `lagerbewegungen` | `bestand_std` (vater_typ, delta) ⋈ `stm_artnr` | AswLagBew | 🟡 Buchtyp/Vorzeichen |
| `pruefungen` | `meld_std` ⋈ `rsc_std`→`stm_artnr` (RSC), `stm` | AswQs2151 | 🟡 RSC-Karte teuer |
| `liefertreue` | Auftrag (typ 1) ⋈ Lieferschein (typ 5) über `pos_vater_*`; Verzug = Arbeitstage | dev_excel_Liefertreue_Einkauf | 🟡 Vertrieb, Verzug=Arbeitstage |
| `kontakte` | `vrg_std`; Kontaktart = 1. `Typ` über `VRG_TYP_TEXT` (vrg_typ-ID→Text); ERP-Link = `vrg_kpf_typ` | Kontakte/AswVrg | ✅ (Verteilung 2026 = Extrakt) |
| `interessenten` | `adr_std` `adr_typ = 8`; `adr_nr`/`adr_name1`/`adr_datum_save` | dev_excel_INT | ✅ (Maske filtert minimal zusätzlich) |

Die 🟡-Arten vor dem Scharfschalten je einzeln gegen einen echten Extrakt
prüfen — `worker.py --art <x> --dry-run`, dann `worker_abgleich.py <x>
<extrakt>` (zeilengenauer Abgleich, kein ODBC nötig; `vm-setup.md`, Abschnitt 4).
Mapping-Herleitung aller Arten in
`../ERKENNTNISSE.md` / `../MAPPING.md`; On-Quality-WGR-Split bleibt separat offen.

## Verhältnis zu den `kpi/`-Modulen

Die Lese-Logik je Art entspricht den Apollo-Abfragen aus `../fetch-*.ps1` und
`../kpi/*.py` (dort validiert). Der Worker rechnet **keine** KPIs — er liefert
nur die Rohzeilen; gerechnet wird in der Plattform (SQL). So gibt es genau eine
KPI-Rechenlogik.
