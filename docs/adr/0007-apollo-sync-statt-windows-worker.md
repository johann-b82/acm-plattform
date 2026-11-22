# ADR-0007: Apollo nativ lesen (`apollo-sync`) statt Windows-Worker mit ODBC-Treiber

Status: vorgeschlagen, 2026-11-22

## Kontext

Die 14 Apollo-Lieferungen kommen bisher vom `odbc-worker` auf einer eigenen Windows-VM, weil der
CONZEPT-16-ODBC-Treiber nur unter Windows läuft. Der Treiber ist langsam (676 Frames Verbindungsaufbau,
ein Round-Trip je Satz, ganze Sätze statt Spalten; `kpf_std`-Vollscan ~490 s) und hat Eigenheiten
(keine Integer-Parameter, einseitige JOINs hängen).

Das CONZEPT-16-Protokoll ist inzwischen vollständig dokumentiert und der Server-Abfragepfad
(0x92/0x93/0xb1) mit serverseitiger Projektion, optionalem Filter und gepipelinten Fetches nachgebaut.
Verifiziert gegen den Treiber: `stm_std` vollständig (31,3 Mio. Zellen), 0 Abweichungen.

## Entscheidung

Ein neuer Dienst `apollo-sync` (Python, nur Standardbibliothek + `requests`/`openpyxl`) liest Apollo
direkt und ersetzt den Windows-Worker. Er läuft als Container im Plattform-Stack und spricht **denselben
Vertrag** (`/api/odbc/konfig`, `/api/odbc/<art>`, `/api/odbc/status`, `X-ODBC-Token`). `compute`, die
Parser und die KPI-SQL bleiben unverändert. Die 14 Lieferungen sind 1:1 aus `worker.py` (`main`)
portiert; nur die Datenquelle wechselt. `kunden` (`build_kunden_bestellungen`) ist eine gezielte
Einzelkundenabfrage ohne Plattform-Import und wird nicht übernommen. Kein Apollo-Spiegel in `public.*` — Alembic bleibt alleiniger
DDL-Eigentümer, RLS unberührt. Der SQLite-Spiegel des Werkzeugs dient nur Analysen außerhalb der Plattform.

## Konsequenzen

- Die Windows-VM entfällt. Voraussetzung: Der Plattform-Host erreicht `192.9.200.134:4722`.
- Umschaltung bewusst: Der Dienst hängt am Compose-Profil `apollo-sync`; vorher den Worker auf der VM
  stoppen, sonst liefern zwei Quellen.
- Ein Lauf liest jede Tabelle einmal, nur die nötigen Spalten, in **einer** Sitzung, und meldet sich ab,
  bevor er hochlädt.
- **Betriebsrisiko Sitzungssperre:** Bricht der Server eine Sitzung ab, sperrt er neue Anmeldungen des
  Benutzers ~30 min. Ein eigener technischer Benutzer steht nicht zur Verfügung — der Dienst läuft mit
  dem persönlichen Konto. Deshalb wird die Sperre **vermieden**, nicht nur behandelt:
  - nur schmale Projektionen (≤ 19 Spalten je Tabelle); der bekannte Auslöser (`Statistiken`, alle 595
    Spalten in einer Projektion) wird in Spaltengruppen gelesen;
  - Quarantäne: Eine Tabelle, die einmal abbricht, wird danach nur in kleineren Gruppen gelesen bzw.
    übersprungen — dieselbe Tabelle kann keine zweite Sperre auslösen;
  - Vorprüfung jeder Lieferungs-Tabelle auf der Testdatenbank vor dem Scharfschalten;
  - nie hart beenden: SIGTERM beendet den laufenden Lauf mit Abmeldung, `stop_grace_period: 15m`;
  - eine Sitzung, kurz gehalten (Lesen → Abmelden → erst dann Hochladen);
  - tritt eine Sperre doch ein, wartet der Dienst 35 min (`guard.json`) statt es weiter zu versuchen.
- **Keine Client-Registrierung:** Der Treiber meldet sich zusätzlich mit Host/IP/Windows-Benutzer an
  (`k`-Frame, vermutlich ODBC-Lizenzplatz). Ein so belegter Platz blieb nach einem hart beendeten
  Treiberprozess stundenlang gesperrt. `apollo-sync` registriert sich nicht und belegt damit keinen
  Platz, der hängen bleiben kann. Eine Klärung mit vectorsoft ist nicht möglich; die Entscheidung ist
  bewusst getroffen (einziger ODBC-Nutzer ist der Kontoinhaber).
- Nach einem Apollo-Update muss `wire_schema.json` einmal auf einem Windows-Rechner mit Treiber neu
  geerntet werden (Tests prüfen die Frames danach).
