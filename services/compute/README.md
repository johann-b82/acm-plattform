# services/compute — FastAPI (ab Phase 2)

Noch kein Code. Übernimmt aus `lumeapps/backend` nach `docs/inventory.md`:

- `app/parsing/*` (20 Parser), Dokument-Services (PDF/DOCX/XLSX/PPTX-Pipeline), `personio_*`, `snmp_poller`, `atr_*`, `graph_client`, `email_service`, `worldcup_feed`.
- Auth: eine Datei, prüft Supabase-JWT über JWKS (`aud`, `iss`, `exp` verpflichtend), liest Claim `apps`. Gate-Dependencies `require_app(app, level)` statt `require_admin`.
- Kein APScheduler-Fanout, kein SSE. Sync-Jobs als eigene Prozesse (`python -m compute.jobs.personio_sync`) oder per `pg_cron` + HTTP-Trigger.
- Dockerfile: Multi-Stage, non-root, kein `--reload`, `--no-access-log --log-level warning`, System-Deps: libreoffice, poppler-utils, libzbar0, Fonts.
- Tests: `conftest`-Riegel gegen Nicht-Test-DB übernehmen; `_auth.py` mintet Supabase-JWTs.
- Alembic startet mit einer Baseline-Migration aus dem bereinigten Ist-Schema.
