# Inventur: Übernahme, Umbau, Löschen aus `lumeapps`

Grundlage für die saubere Codebasis (Plan, Entscheidung G). Pfade beziehen sich auf `lumeapps @ ffc9ba0`.

## 1. Fachmodule

| Modul | Alt | Entscheidung | Ziel in `acm-plattform` |
|---|---|---|---|
| Sales-KPIs | `routers/kpis.py`, `sales_kpis.py`, `services/kpi_aggregation.py`, `sales_kpi_aggregation.py` | Umbau | SQL-Views + Server Components. `compute_contacts_weekly` und `compute_orders_distribution` werden `GROUP BY`. |
| HR-KPIs | `hr_kpis.py`, `hr_overtime.py`, `hr_weekly.py`, `hr_belegschaft.py`, `hr_kpi_aggregation.py` | Umbau | Views; Overtime-Ratio mit `jsonb`-Lateral. Wochenbericht-PDF bleibt `compute`. |
| Quality / Audit | `quality_kpis.py`, `audit.py`, 3 Aggregations-Services, `audit_status.py`, `audit_trail.py` | Umbau | Views; Audit-CRUD nach PostgREST; Audit-Trail als DB-Trigger. |
| Finance | `finance_kpis.py`, `material_cost_aggregation.py`, `personnel_cost_aggregation.py` | Umbau | Views (`DISTINCT ON` portiert direkt). |
| Procurement (OTD) | `procurement_kpis.py`, `otd_aggregation.py` | Umbau | View. |
| Production / Wartung | `production_kpis.py`, `maintenance.py`, `maintenance_pdf.py`, `maintenance_files.py` | Umbau | Verzug-View; Wartungs-CRUD nach PostgREST; PDF bleibt `compute`; Dateien nach Storage. |
| Uploads + Parser | `uploads.py` (17 Routen), `parsing/*` (20 Dateien) | Übernehmen | `compute`. Parsing in `run_in_threadpool`. Größenlimit vor `file.read()`. |
| Schulungen, Onboarding, Kompetenzen, Einarbeitung, Zeugnisse | 5 Router, ~108 Routen, ~5.000 Zeilen + Dokument-Services | Umbau | ~70 % CRUD nach PostgREST/RLS; Dokumente, QR-Scan, Personio-Writeback bleiben `compute`. Indizes ergänzen. |
| Newsletter, Feedback, KPI-Review | `newsletter.py`, `feedback.py`, `kpi_review.py` | **Umgebaut** (PRs #31, #32, #33) | Alles über PostgREST, Bilder in Storage. Zwei Annahmen von hier haben nicht gehalten: das Newsletter-PDF bleibt im Browser (im Altprojekt läuft es schon dort, ein Weg über den Server hieße das Layout ein zweites Mal nachzubauen), und die Prüfung magischer Bytes entfällt — der Eimer lässt nur Bildtypen zu und `nosniff` liegt auf dem ganzen Ursprung. Siehe `docs/modules/`. |
| Settings | `settings.py` (67-Spalten-Singleton) | Umbau | PostgREST + RLS; Scheduler-Reschedule als Trigger/NOTIFY an `compute`; Logo-SVG-Sanitizing bleibt `compute`. |
| Sensoren (SNMP) | `sensors.py`, `snmp_poller.py` | Übernehmen | `compute`. `/status` als eine `DISTINCT ON`-Query. Retention per `pg_cron`. |
| Personio-Sync | `sync.py`, `hr_sync.py`, `personio_client.py`, `personio_writeback.py` | Übernehmen | `compute`, Job bleibt APScheduler oder `pg_cron` + HTTP-Trigger. |
| ATR | `atr.py`, `atr_delivery.py`, 9 Services, SMB | Übernehmen | `compute`. Nur `atr_part`-Katalog nach PostgREST. `_unc()` lehnt `..` ab. |
| FAIR | `fair.py`, `fair_files.py`, Frontend-Canvas mit tesseract/pdf-lib | Übernehmen | CRUD nach PostgREST; Dateien nach Storage; Frontend als Client-only-Insel. |
| E-Mail (MS Graph) | `email.py`, `email_service.py`, `graph_client.py` | Übernehmen | `compute`. |
| World Cup / Tippspiel | `worldcup.py`, `worldcup_feed.py`, `tippspiel_*` | Übernehmen, prüfen | `compute` (Upstream-Proxy mit Cache). Embed-Routen bekommen signierte Tokens. Relevanz nach Turnierende prüfen. |
| HR-Embeds (Geburtstage, Neueinsteiger) | `hr_embed.py` | Umbau | Signierter Embed-Token, Geburtsdatum raus, Foto-Proxy cachen. |
| Signage | `signage_admin/*`, `signage_player.py`, `signage_pair.py`, 6 Services, `frontend/src/signage`, `frontend/src/player`, `pi-sidecar/`, `scripts/{provision-pi.sh,lib,systemd,polkit,labwc}` | Auslagern | Eigenes Repo `acm-signage`. Nicht Teil von `acm-plattform`. |

## 2. Querschnitt

| Bereich | Alt | Entscheidung |
|---|---|---|
| Auth | `security/directus_auth.py`, `roles.py`, `device_auth.py`, `rate_limit.py` | Neu: Supabase-JWT-Prüfung in `compute` (eine Datei), Gate-Dependencies bleiben konzeptionell. Rate-Limit hinter Proxy mit `X-Forwarded-For`. `device_auth.py` geht nach Signage. |
| Scheduler | `scheduler.py` (7 Jobs) | Sensor-Poll, Personio, ATR-Scan bleiben in `compute`. Retention und Pairing-Cleanup nach `pg_cron`. Signage-Jobs nach Signage. |
| Modelle / Schemas | `models/_base.py` (1.160 Z.), `schemas/_base.py` (1.315 Z.) | Übernehmen, in Domänen-Dateien aufteilen. `sales_records` (42 Spalten, Legacy seit v1.54) entfällt, sobald die Auftragstabelle auf `auftraege` umgestellt ist (17 Referenzen). |
| Alembic | 105 Revisionen | Neu starten mit **einer** Baseline-Migration aus dem Ist-Schema (minus Signage, minus `sales_records`, minus Directus-Spalten). Historie bleibt im Altrepo. |
| Frontend-Basis | shadcn `components/ui/*` (27), Tailwind v4, `lib/utils.ts`, `index.css` | Übernehmen 1:1. |
| Dashboards | `components/dashboard/*` (48), `components/sensors/*`, Recharts | Übernehmen als Client Components. |
| Datenzugriff | `lib/apiClient.ts` (Modul-Singleton-Token), 14 `lib/*Api.ts`, TanStack Query | `apiClient` neu (Cookie-Session, kein Modul-Token). `*Api.ts` und Query-Keys übernehmen. |
| i18n | `locales/de.json`, `en.json` (1.951 Keys), Paritäts-Checks | Übernehmen. Du-Ton-Check übernehmen. |
| Docs im Frontend | `src/docs/{de,en}` (22 Markdown), `?raw`-Registry | Inhalte übernehmen; Rendering als Server Components mit `generateStaticParams`. |
| Theme, Bootstrap | `index.html`-Inline-Script, `bootstrap.ts` mit Top-Level-Await | Neu: Root-Layout-Script, Server-seitiges Settings-Fetch mit `HydrationBoundary`. |
| Tests Backend | 125 Dateien, 37 mit Directus-Kopplung, `tests/_auth.py` mintet Directus-JWTs | Übernehmen, `_auth.py` mintet Supabase-JWTs. `conftest`-Riegel gegen Prod-DB übernehmen. |
| Tests Frontend | 51 Vitest, Contract-Fixtures, 1 Playwright | Übernehmen; Directus-Fixtures (`readMe_minimal.json`, `signage_*.json`) entfallen. |
| CI | 24 Schritte, 8 Phase-Grep-Guards, Guards A–E | Neu: Lint, Tests, `service_role`-Guard, Log-Guard, Alembic-Head-Check. Phase-Guards und Directus-Guards entfallen. |
| Doku | `docs/architecture.md`, `api.md`, `setup.md`, `operator-runbook.md`, `kpi-rechenwege.md`, `docs/modules/*` | `kpi-rechenwege.md` und `docs/modules/*` übernehmen und pflegen. Runbook neu aus den relevanten Abschnitten (Backup/Restore, Restore-Pairing entfällt hier). `api.md` wird aus OpenAPI generiert. |

## 3. Konkrete Löschliste (kommt nicht mit)

| Pfad | Grund |
|---|---|
| `directus/` (Snapshots, Bootstrap-Skripte, Permissions-SQL, Fixtures) | Directus entfällt |
| `docker-compose.yml`: `directus`, `directus-schema-apply`, `directus-bootstrap-roles`, `directus-bootstrap-permissions` | Directus entfällt |
| `scripts/ci/check_schema_hash.sh`, `check_directus_snapshot_diff.sh`, `check_db_exclude_tables_superset.sh` | Directus-Guards |
| `backend/tests/test_db_exclude_tables_directus_collections.py`, `tests/signage/test_admin_directus_crud_smoke.py`, `test_permission_field_allowlists.py` | Directus-Guards |
| `backend/app/routers/auth_forward.py` (199 Z.) | Forward-Auth für entfernte Tool-Apps, keine Caddy-Route mehr |
| `.github/workflows/ci.yml`: `mkdir paperless_*`, 8 Phase-66-bis-73-Grep-Guards | Historie |
| `.gitignore`: `paperless_*`, `stirling_data`, `openproject_data` | Historie |
| `sample_export.csv` (14 MB im Repo-Root) | Testdaten gehören nicht ins Repo; als Fixture nur ein Ausschnitt |
| `backend/app/models`: `sales_records` + `upload_batches`-Kaskade, `frontend`: `SalesTable` auf `sales_records` | Legacy seit v1.54 (nach Umstellung der Auftragstabelle) |
| `frontend/src/bootstrap.ts`: `kpi.cache_purge_v22` | Sunset v1.24, nie entfernt |
| `frontend/src/lib/directusClient.ts`, `@directus/sdk`, `toApiError.ts` (Directus-Fehlerform) | Directus entfällt |
| `frontend/scripts/check-phase-57-guards.mts`, `check-phase-59-guards.mts` | Phase-Historie |
| `frontend/scripts/check-player-*.mjs`, `check-signage-invariants.mjs`, `player.html`, Vite-Player-Mode | gehen ins Signage-Repo |
| `docs/superpowers/` (Phasenpläne und Specs), `docs/status.md`, README-Changelog (55 KB) | Historie, bleibt im Altrepo lesbar |
| `docs/adr/0001-directus-fastapi-split.md` | Ersetzt durch ADR-0001 in diesem Repo |
| `.env.example`: alle `DIRECTUS_*`, `SIGNAGE_DEVICE_JWT_SECRET` | Directus entfällt, Signage separat |
| `certs/internal.key` | Private Key im Repo (Security-Befund), Zertifikate werden je Umgebung erzeugt |
| `backend/Dockerfile`: `requirements-dev.txt` im Prod-Image | Multi-Stage-Build |
| `Makefile`-Ziele `schema-fixture-update`, `test-authz`, `test-allowlists` | Directus |
| `.claude/skills/ui-ux-pro-max/` (vendorierte CSV-Daten) | Werkzeug-Cache, nicht Projektcode |

## 4. Was bewusst bleibt, obwohl es alt aussieht

- `docs/kpi-rechenwege.md`: die einzige belastbare KPI-Spezifikation, Vorlage für alle Views.
- `backend/tests/conftest.py`-Riegel gegen Nicht-Test-Datenbanken (zwei Datenverluste 2026).
- Router-Level-Auth-Konzept und `test_admin_gate_audit.py` (mit den zwei bekannten Lücken behoben).
- `--workers 1`-Invariante: nur noch im Signage-Repo relevant. In `compute` entfällt sie, sobald der Scheduler und SSE draußen sind.
