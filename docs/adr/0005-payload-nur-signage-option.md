# ADR-0005: Payload CMS nur als Option für den Signage-Stack

Status: offen (Spike nach Phase 1), 2026-09-09

## Kontext

Payload 3 läuft im Next.js-Prozess, bringt Admin-UI, Upload-Collections, Zugriffsregeln, Jobs-Queue und eigene Auth-Strategien. Als Plattform-Basis wurde es nicht gewählt (ADR-0001). Für Signage (Medien, Playlists, Zeitpläne, Geräte) könnte ein fertiges Content-Admin Code ersetzen.

## Entscheidung

Zeitlich begrenzter Spike (eine Woche) **nach** Phase 1. Phase 1 zieht Signage zuerst mit bestehender Python-API und React-Admin-UI um, weil das der kürzeste Weg zur Entkopplung ist.

Kriterien:

1. Codeabbau: ersetzt Payload mehr (React-Signage-Admin ~3.000 Zeilen, Directus-Medienpfad, Upload-Helfer), als es hinzufügt (Custom Endpoints für Pairing, Device-JWT, SSE, Resolver, PPTX-Konvertierung)?
2. Redaktion: sollen Nicht-Entwickler Inhalte pflegen? Nur dann zählt das Admin-UI.
3. Laufzeit: zwei Laufzeiten (Node + Python für soffice/pdftoppm) im isolierten Stack, oder Konvertierung in Node?
4. Betrieb: Payload pinnt die Next.js-Version; weiteres Framework.

Ohne klaren Vorteil bei Kriterium 1 oder 2 bleibt Payload draußen.

## Erwartung

Vorteil nur bei echtem Redaktionsbedarf. Sonst kein Codeabbau.
