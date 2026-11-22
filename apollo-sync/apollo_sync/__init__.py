"""apollo-sync: read Apollo (CONZEPT 16) natively — no Windows ODBC driver.

Layers:
  protocol  wire protocol, session, server query path (0x92/0x93/0xb1)
  schema    exact wire schema of all tables (bundled wire_schema.json)
  guard     cool-down after server refusals/aborts (protects the production server)
  client    projection-first fetches (`Apollo`, `CachedSource`)
  mirror    local SQLite mirror for analyses/development (`Mirror`)
  feeds     the 14 ACM platform feeds (port of odbc-worker)
  acm       konfig/status/upload contract of the platform + service loop
"""
__version__ = "0.1.0"
