# Stand des neuen Stacks

Stand 9. September 2026. Was läuft, was bewiesen ist, und wie das nächste Modul dazukommt.

## Was steht

| Baustein | Zustand |
|---|---|
| Supabase self-hosted | Upstream `v1.26.08` gepinnt, per `include:` eingebunden, Overrides in `infra/supabase/`. Analytics und Vector aus, Ports nur auf 127.0.0.1. |
| Rechtemodell | `apps`, `groups`, `user_groups`, `app_grants`. `custom_access_token_hook` schreibt den Claim `apps` in jedes Token. RLS auf jeder Tabelle. |
| Rechteverwaltung | `/platform`: Personen anlegen, Gruppen, Mitglieder, App-Rechte pflegbar. Schreibt über PostgREST, geprüft von den Policies; nur das Anlegen einer Person läuft über `compute`. |
| Next.js-Shell | Login, Launcher, Proxy (`src/proxy.ts`), Server Components lesen über die Nutzer-Session. |
| Compute-Dienst | FastAPI, prüft das Supabase-JWT, zwei Upload-Routen. Zustandslos, kein Scheduler, kein SSE. |
| Erstes Fachmodul | Vertrieb: zwei ERP-Uploads, vier KPI-Funktionen als SQL, Dashboard mit Recharts. |
| Signage | Eigenes Repo `acm-signage`, eigener Compose-Stack, eigene Datenbank, eigener Caddy. Die Verwaltung hängt als App-Kachel in der Plattform. |
| Aufräumen | `pg_cron`, täglich 3:30 Uhr, Upload-Protokolle 365 Tage. |
| Logging | `x-logging`-Anker auf jedem Dienst, Caddy `level ERROR`, uvicorn ohne Access-Log, Guard im CI. |

Tests: 55 in `compute`, 26 in `apps/web`. CI prüft Guards, Compute und Web.

## Was bewiesen ist

- **Deployments treffen keine Screens.** Nachgestellt mit offener Geräteverbindung: ein Player-Stream (`/api/signage/player/stream`) lief, währenddessen ging die Plattform komplett herunter (`docker compose down`, inklusive ihres Netzes) und wieder hoch. Die Verbindung blieb bestehen, die Heartbeat-Pings laufen über den Neustart hinweg durch, und eine danach geänderte Playlist erreichte denselben Stream. Die Signage-Container wurden nicht angefasst.
- **Rechte greifen in der Datenbank, nicht in der Oberfläche.** Wer kein Plattformrecht hat, sieht in `plattform_nutzer` null Zeilen und scheitert beim Schreiben auf `groups` und `app_grants` an der Policy. Wer `kpi: viewer` hat, sieht Kennzahlen, aber keine Upload-Historie, und bekommt beim Upload 403.
- **Der Claim folgt der Gruppe.** Nach Aufnahme in eine Gruppe liefert `custom_access_token_hook` das Recht der Gruppe. Es wirkt ab der nächsten Anmeldung.
- **Die Platte wächst nicht mehr im Leerlauf.** Alle zwölf Container tragen den Rotationsanker (`json-file`, 3×10 MB). Nach einem vollständigen Durchgang durch Launcher, Kennzahlen, Uploads, Signage und Verwaltung stehen im Caddy-Log 14 Zeilen, alle vom Start, keine einzige pro Anfrage. Der Compute-Dienst schrieb null Zeilen. Zum Vergleich: im Altprojekt kamen allein von einem Pi rund 13.000 Zeilen pro Tag.
- **Der Weg zurück ist gegangen worden, nicht nur beschrieben.** `scripts/backup.sh` erzeugt einen Abzug und prüft ihn mit `pg_restore --list`. Zurückgespielt in eine leere Datenbank kamen alle Tabellen, alle Zeilen und alle zehn Policies wieder, bei sieben harmlosen Meldungen.
- **Migrationen laufen beim Start.** Der Dienst `migrate` spielt Alembic ein und fordert danach den PostgREST-Schema-Cache neu an.

## Was bewusst fehlt

- **Datenübernahme aus `lumeapps`.** Auf Wunsch ans Ende gelegt. Betrifft die Fachtabellen und die Dateien aus `directus_uploads`.
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
