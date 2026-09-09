"""Übernahme der Daten aus dem Altprojekt `lumeapps`.

Zwei getrennte Läufe, beide für sich wiederholbar:

* `vertrieb` — Upload-Protokolle, Rechnungen und Aufträge.
* `nutzer`   — Personen aus `directus_users`, mit neuem Passwort.

Beide lesen aus der alten Datenbank über einen eigenen Verbindungsstring und
schreiben in die neue. Sie sind idempotent: ein zweiter Lauf ändert nichts,
was schon stimmt. Und beide können trocken laufen, dann wird nur gezählt.
"""
