## Projekt

**ACM-Plattform** — Nachfolger von `lumeapps`. Next.js 16 (App Router) + Supabase self-hosted (Auth, PostgREST, Storage) + FastAPI-Dienst `compute` (Parsing, Dokumente, SNMP, Personio, SMB). Digital Signage ist ein eigener Stack im Repo `acm-signage`.

**Status: produktiv seit 24.09.2026** auf `acm@192.9.201.9`, Port 80. Vor jeder Arbeit am laufenden System `docs/status.md` lesen — dort stehen die Adressen, die offenen Punkte und die Fallstricke des Betriebs. Plan in `docs/plan.md`, Entscheidungen in `docs/adr/`, der Stichtag in `docs/cutover.md`.

Zwei Dinge, die im Betrieb teuer sind: **Die Adresse `http://192.9.201.9` ist ein Vertrag** — Schema, Host und Port ändern entkoppelt jede Signage-Tafel, weil deren Gerätetoken am Origin hängt. Und **`API_EXTERNAL_URL` ist der Aussteller im Token**; er muss mit `PLATFORM_JWT_ISSUER` im Signage-Stack übereinstimmen. Beides zieht `cutover.sh schritt port80` gemeinsam.

## Prinzipien

Bias zu Vorsicht vor Tempo. Annahmen benennen, bei Mehrdeutigkeit nachfragen. Minimaler Code für das gestellte Problem, keine spekulativen Features. Nur ändern, was der Auftrag verlangt. Ziel-getrieben: erst Test, dann Code; fertig heißt grün.

## Invarianten

- **Alembic ist alleiniger DDL-Eigentümer von `public.*`.** Supabase verwaltet nur `auth`, `storage`, `realtime`. Nie `create_all()`, nie Studio-Schemaänderungen in Produktion.
- **RLS auf jeder Tabelle, die PostgREST sieht.** Neue Tabelle ⇒ Policy im selben Commit.
- **`service_role` nie im Browser.** Nur in `compute` und Server-Code. CI greppt das Web-Bundle.
- **Rechte kommen aus dem JWT-Claim `apps`** (`{"sales":"viewer"}`). Middleware, RLS und `compute` prüfen denselben Claim. Keine zweite Rollenquelle.
- **Same-Origin über Caddy.** Kein CORS. Keine Host-Ports außer Caddy.
- **`compute` ist zustandslos.** Kein In-Process-Fanout, kein SSE, mehrfach startbar. Retention in `pg_cron`.
- **Logging nach `docs/logging.md`.** Jeder Compose-Dienst mit `x-logging`-Anker, kein Access-Log auf Erfolg, kein `log.info` in kurzen Schleifen ohne Bedingung.
- **Tests laufen nie gegen eine DB ohne `test` im Namen.** Der `conftest`-Riegel aus `lumeapps` wird übernommen.
- **Dateien liegen im Speicher, nicht in der Zeile.** Objektname beginnt mit der Kennung der hochladenden Person (die Regel auf `storage.objects` prüft sie), gelöscht wird über die Storage-API — ein direktes `delete` auf `storage.objects` weist Postgres ab und ließe die Datei liegen. Siehe `docs/modules/feedback.md`.
- **Kein Host-Pfad wird mit dem Signage-Stack geteilt.**

## Konventionen

- Sprache in Doku und Commits: Deutsch. Code und Bezeichner: Englisch.
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`).
- Arbeit im Worktree, Lieferung per Pull Request, nie direkt auf `main`.
- Jedes Fachmodul hat `docs/modules/<modul>.md` mit Datenquelle, Rechenweg, Rechten. `docs/kpi-rechenwege.md` ist die Vorlage für KPI-Views.
- Übernahme aus `lumeapps` nur nach `docs/inventory.md`; jede übernommene Datei wird auf Directus-Referenzen, `sales_records` und tote Settings geprüft.

## Stack (Zielversionen, bei Projektstart Phase 2 verifizieren)

Next.js 16, React 19, TypeScript 5, Tailwind 4, shadcn/ui, TanStack Query 5, Recharts 3, `@supabase/ssr`; Python 3.12, FastAPI, SQLAlchemy 2 async, asyncpg, Alembic, pandas 3, openpyxl; Postgres 17 (Supabase-Image), Caddy 2, Docker Compose v2.
