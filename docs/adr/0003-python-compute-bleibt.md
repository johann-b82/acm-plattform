# ADR-0003: Python bleibt als schlanker Compute-Dienst

Status: angenommen, 2026-09-09

## Kontext

Von 335 API-Operationen sind rund 130 echtes Python: 15 pandas-Parser für ERP-Exporte mit deutschen Locale-Eigenheiten und 60-Spalten-Altformaten, 18 Dokumentgeneratoren (LibreOffice/UNO, poppler, openpyxl, python-docx, qrcode/pyzbar), SNMP (pysnmp), Personio-REST, SMB (smbprotocol), MS-Graph-Mail. Rund 150 Operationen sind reines CRUD, rund 55 sind SQL-fähige KPI-Berechnungen. 125 Python-Testdateien sichern die Fachlogik.

## Entscheidung

FastAPI bleibt als Dienst `compute`. Er verliert CRUD (nach PostgREST/RLS) und KPI-Berechnung (nach Postgres-Views), behält Parsing, Dokumente und Integrationen. Auth-Prüfung wechselt auf Supabase-JWT (JWKS), die Gate-Dependencies bleiben konzeptionell.

## Konsequenzen

- Kein Rewrite von 40.000 Zeilen nach TypeScript (Schätzung 4 bis 6 Monate ohne fachlichen Gewinn).
- `compute` wird zustandslos: kein In-Process-Scheduler mit Fanout, kein SSE. Sync-Jobs (Personio, SNMP, ATR-Scan) bleiben als Jobs im Dienst, Retention geht nach `pg_cron`.
- pandas läuft in `run_in_threadpool`; Upload-Größen werden vor dem Lesen begrenzt.
- Ziel: unter 150 Routen nach Phase 4.
