# ADR-0002: Digital Signage ist ein eigener Stack im eigenen Repo

Status: angenommen, 2026-09-09

## Kontext

Plattform-Deployments haben Signage-Screens ausfallen lassen. Vier belegte Mechanismen: geteilter API-Prozess mit `--reload` (kappt SSE, LISTEN, PPTX-Jobs), geteiltes `frontend/dist` mit `emptyOutDir` (löscht `dist/player`), geteilte Alembic-Kette (fremde Migration blockiert API-Start), geteilter Caddy (Reload kappt SSE, `depends_on directus`). Die 10 Signage-Tabellen haben keinen Fremdschlüssel nach außen; Device-Auth ist bereits eine eigene Trust-Domain.

## Entscheidung

Signage wird Repo `acm-signage` mit eigenem Compose-Projekt auf **demselben Host**, möglichst isoliert: eigenes Netz, eigene Postgres, eigene Alembic-Kette, eigene Caddy-Instanz auf eigenem Port, eigene Volumes unter `/srv/signage`, Player-Bundle im Image, Ressourcenlimits, eigener Scheduler.

Einzige Kopplung zur Plattform: Embeds als absolute, signierte URLs; Admin-Aufrufe prüfen das Plattform-JWT über JWKS. Player brauchen die Plattform nie.

## Konsequenzen

- `--workers 1` bleibt eine Invariante des Signage-Stacks, verschwindet aus `compute`.
- Signage-Admin-UI ruft REST der `signage-api` (die in Phase 68 bis 70 nach Directus verlagerten CRUD-Routen kommen zurück).
- Medien ziehen aus `directus_uploads/` in ein Signage-Volume.
- Grenze: ein Host, ein Docker-Daemon, eine Platte. Voller Datenträger oder Daemon-Neustart trifft beide Stacks. Akzeptiert.
- Pis ändern nur `SIGNAGE_API_URL`.
