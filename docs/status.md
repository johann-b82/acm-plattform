# Stand des neuen Stacks

Stand 10. September 2026. Was läuft, was bewiesen ist, und wie das nächste Modul dazukommt.

## Was steht

| Baustein | Zustand |
|---|---|
| Supabase self-hosted | Upstream `v1.26.08` gepinnt, per `include:` eingebunden, Overrides in `infra/supabase/`. Analytics und Vector aus, Ports nur auf 127.0.0.1. |
| Rechtemodell | `apps`, `groups`, `user_groups`, `app_grants`. `custom_access_token_hook` schreibt den Claim `apps` in jedes Token. RLS auf jeder Tabelle. |
| Rechteverwaltung | `/platform`: Personen anlegen, Gruppen, Mitglieder, App-Rechte pflegbar. Schreibt über PostgREST, geprüft von den Policies; nur das Anlegen einer Person läuft über `compute`. |
| Next.js-Shell | Login, Launcher, Proxy (`src/proxy.ts`), Server Components lesen über die Nutzer-Session. |
| Compute-Dienst | FastAPI, prüft das Supabase-JWT. Dreizehn Upload-Routen, zwei für Personen, zwei für den Personio-Abgleich. Zustandslos, kein Scheduler, kein SSE — der nächtliche Anstoß kommt von pg_cron. |
| Fachmodul Vertrieb | Vollständig: fünf ERP-Uploads, sechs KPI-Funktionen als SQL, Dashboard mit Kacheln, Umsatzverlauf, Kundenanteil, Auswertung je Erfasser und der Vertriebsaktivität je Kalenderwoche. |
| Fachmodul Einkauf | Vollständig: Liefertermintreue und Ladenhüter der Lagerbestände. |
| Fachmodul Produktion | Aufträge in Verzug: zwei ERP-Uploads (Text und Excel), Sicht `auftrag_verzug`, drei KPI-Funktionen, Dashboard mit Verzugsliste. |
| Fachmodul Qualität | Vollständig: Audit-Findings, Reklamationsquote (On Quality) und Prüfmengen mit Ausschussquote. |
| Fachmodul Finanzen | Vollständig: Materialkostenquote mit Preisliste als Sicht auf die Wareneingänge, Personalkostenquote aus dem Personio-Abgleich samt Aufteilung nach Abteilung. |
| Fachmodul Personal | Personio-Abgleich (Stammdaten, Anwesenheiten, Abwesenheiten aus zwei Quellen), Überstunden-, Krankheits- und Fluktuationsquote als SQL, nächtlich über pg_cron, Dashboard unter `/hr` mit Abgleichstand und Wochenbericht. Offen: Mitarbeitertabelle, Belegschafts-Kennzahlen, Kompetenzentwicklung. |
| Zielwerte | Eine Zeile je Ziel statt eines breiten Singletons. Pflegbar unter `/einstellungen`, gelesen von allen Dashboards. Dort auch die Personal-Einstellungen (Krankheitsarten, Produktionsabteilungen) als Listen. |
| Signage | Eigenes Repo `acm-signage`, eigener Compose-Stack, eigene Datenbank, eigener Caddy. Die Verwaltung hängt als App-Kachel in der Plattform. |
| Aufräumen | `pg_cron`, täglich 3:30 Uhr, Upload-Protokolle 365 Tage. |
| Zeitgesteuertes | `pg_cron` stößt an, `pg_net` ruft. Der Dienst bleibt zustandslos — das Altprojekt ist wegen seines Schedulers im Prozess auf `--workers 1` festgenagelt. |
| Logging | `x-logging`-Anker auf jedem Dienst, Caddy `level ERROR`, uvicorn ohne Access-Log, Guard im CI. |
| Sicherung | `scripts/backup.sh` für `public`, `auth` und `storage`, 14 Tage Aufbewahrung. Nicht eingeplant (Entscheidung F). |
| Datenübernahme | Läufe für Vertriebsdaten, Personen und Signage stehen bereit, gegen eine echte Alt-Datenbank geprüft. |

Tests: 389 in `compute`, 53 in `apps/web`. CI prüft Guards, Compute und Web.

## Was bewiesen ist

- **Deployments treffen keine Screens.** Nachgestellt mit offener Geräteverbindung: ein Player-Stream (`/api/signage/player/stream`) lief, währenddessen ging die Plattform komplett herunter (`docker compose down`, inklusive ihres Netzes) und wieder hoch. Die Verbindung blieb bestehen, die Heartbeat-Pings laufen über den Neustart hinweg durch, und eine danach geänderte Playlist erreichte denselben Stream. Die Signage-Container wurden nicht angefasst.
- **Rechte greifen in der Datenbank, nicht in der Oberfläche.** Wer kein Plattformrecht hat, sieht in `plattform_nutzer` null Zeilen und scheitert beim Schreiben auf `groups` und `app_grants` an der Policy. Wer `kpi: viewer` hat, sieht Kennzahlen, aber keine Upload-Historie, und bekommt beim Upload 403.
- **Der Claim folgt der Gruppe.** Nach Aufnahme in eine Gruppe liefert `custom_access_token_hook` das Recht der Gruppe. Es wirkt ab der nächsten Anmeldung.
- **Die Platte wächst nicht mehr im Leerlauf.** Alle zwölf Container tragen den Rotationsanker (`json-file`, 3×10 MB). Nach einem vollständigen Durchgang durch Launcher, Kennzahlen, Uploads, Signage und Verwaltung stehen im Caddy-Log 14 Zeilen, alle vom Start, keine einzige pro Anfrage. Der Compute-Dienst schrieb null Zeilen. Zum Vergleich: im Altprojekt kamen allein von einem Pi rund 13.000 Zeilen pro Tag.
- **Der Weg zurück ist gegangen worden, nicht nur beschrieben.** `scripts/backup.sh` erzeugt einen Abzug und prüft ihn mit `pg_restore --list`. Zurückgespielt in eine leere Datenbank kamen alle Tabellen, alle Zeilen und alle zehn Policies wieder, bei sieben harmlosen Meldungen.
- **Die Vertriebsaktivität rechnet, was das Altprojekt rechnete.** Fünf Wochen-Diagramme über 465 Kontakte, 119 Angebote, 57 Interessenten und 86 Auftragszeilen. Stichprobe KW 33: die Karte zeigt 28 Erstkontakte, aufgeteilt KH 10 · MM 10 · SB 8 — dieselben Zahlen liefert eine direkte Abfrage auf `sales_contacts`. Angebotssumme KW 29 (440.428,39 €) und Auftragseingang KW 35 (41.939 €, Stornos gegengerechnet) ebenso gegengerechnet.
- **Der Wochenbericht prüft sein Recht selbst.** Er trägt Namen neben Stunden; die Zugriffsregeln an den Tabellen kennen aber nur „darf HR sehen". Ohne `hr:admin` gibt die Funktion keine Zeilen zurück — kein Fehler, keine Zeilen. Zwei Tests halten beide Richtungen fest.
- **Gehälter verlassen die Datenbank nicht als Einzelwerte.** Die Zeile je Person (`hr_personalkosten_je_person`) ist nicht an `authenticated` freigegeben; nur die Aggregatfunktionen dürfen sie rufen. Ein Test prüft, dass ein direkter Aufruf mit `permission denied` scheitert. Abteilungen mit weniger als drei beitragenden Personen werden zu „Übrige" zusammengefasst, und die Schwelle lässt sich nicht per Aufrufparameter unter drei drücken.
- **Eine abgewiesene Änderung meldet keinen Erfolg mehr.** In der Datenbank nachgestellt: weist eine Policy ein `update` ab, meldet Postgres `UPDATE 0` — keinen Fehler. PostgREST reicht das als Erfolg durch, und die Einstellungsseite sagte „Gespeichert", während sich nichts geändert hatte. Beide Schreibwege holen die geänderten Zeilen jetzt mit `.select()` zurück und werfen bei einer leeren Antwort.
- **Die HR-Rechenwege sind an echten Daten geprüft.** Aus dem LAN gegen die Produktionsdatenbank gerechnet (nur Aggregate, lesend): das Arbeitszeitmodell steckt bei allen 75 aktiven Personen und ist nicht flach — Mo–Do 8:45, Fr 5:00. Mit dem Modell ergibt die Überstundenquote über 90 Tage 4,93 %, mit einem flachen Tagessoll wären es 9,58 %. Und der Stundenzweig der Krankheitsquote springt im Altprojekt bei keiner der 250 Abwesenheiten an; über 90 Tage sind das 19.106 statt 17.665 Krankstunden.
- **Migrationen laufen beim Start.** Der Dienst `migrate` spielt Alembic ein und fordert danach den PostgREST-Schema-Cache neu an.
- **Das Altsystem ist abgesichert, solange es noch läuft.** 18 der 21 Befunde aus `docs/security-findings.md` sind in `lumeapps` abgearbeitet (PRs #145–#151): kein Dev-Server und kein root im Betrieb, JWT mit Aussteller und Pflicht-Ablauf, Kiosk-Einbettung ohne Personaldaten, Rumpf- und Archivgrenzen vor pandas, Nutzerdateien nicht mehr inline im eigenen Ursprung, CSRF-Riegel auf der Cookie-Sitzung, Produktionsbild ohne Testsuite. Drei bleiben bewusst offen, mit Begründung in derselben Datei. Zwei verlangen den Host: TLS und die Zertifikatsrotation.

## Was bewusst fehlt

- **Datenübernahme aus `lumeapps` — vorbereitet, nicht ausgeführt.** Die Läufe stehen und sind gegen eine echte Alt-Datenbank geprüft: `uebernahme-vertrieb` und `uebernahme-nutzer` hier (siehe `docs/setup.md`), `python -m app.uebernahme` im Signage-Repo. Alle drei sind wiederholbar und zuerst trocken fahrbar. Ausgeführt wird auf dem Host, mit den echten Daten.
- **Supabase Storage.** Kein Verbraucher im aktuellen Stack: Uploads landen in Tabellen, Signage hat einen eigenen Medienspeicher. Kommt mit Phase 3.
- **AD-Anbindung.** Vorbereitet über `groups.source` und `groups.external_id`, bewertet in ADR-0004, nicht gebaut.
- **TLS.** Lokal läuft alles über HTTP. Der Header-Block und `request_body max_size` stehen bereits im Caddyfile.

## Rezept für das nächste Modul

Das Vertriebsmodul ist die Vorlage. Für jedes weitere Modul in dieser Reihenfolge:

1. **Migration** in `services/compute/alembic/versions/`. Tabellen, Indizes, `enable row level security`, je eine Lese- und eine Schreibpolicy über `public.app_level('<app>')`. Die App-Kachel als Zeile in `apps`.
2. **Rechenweg als SQL-Funktion**, nicht als Python-Schleife. `docs/kpi-rechenwege.md` hält fest, was die alte Implementierung gerechnet hat; die Funktion muss dasselbe Ergebnis liefern.
3. **Compute nur, wenn es rechnet.** Datei-Parsen, Dokumenterzeugung, externe Systeme. Reines Lesen und Schreiben geht direkt über PostgREST.
4. **Seite unter `apps/web/src/app/(app)/<app>/`.** Server Component holt die Sitzung mit `requireApp`, Client-Insel lädt über TanStack Query.
5. **Tests**: Parser als reine Funktionen, Policies und SQL-Funktionen gegen die Testdatenbank (`docker-compose.test.yml`).
6. **Alte Route in `lumeapps` abschalten**, sobald die neue Seite trägt.

Reihenfolge der Module steht in `docs/plan.md`, Abschnitt 9, Phase 4. Was je Modul übernommen und was gelöscht wird, steht in `docs/inventory.md`.
