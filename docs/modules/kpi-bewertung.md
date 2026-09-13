# KPI-Bewertung & Maßnahmen

`/kpi/bewertung`, dazu die Bubble-Ebene auf den Dashboard-Seiten. Aufgebaut
wie `KpiReviewPage` und `KpiBubbleOverlay` im Altsystem (MAS-01).

## Datenquelle

| Was | Wo |
|---|---|
| Bubble | `public.kpi_kommentare` (Migrationen `0018_kpi_bewertung`, `0050_kpi_bubbles`) |
| Maßnahme | `public.kpi_massnahmen` |
| Kennzahlen der Auswahl | `public.zielwerte` über `kpi_bewertung_uebersicht()` |
| Verantwortliche | `kpi_verantwortliche()`: aktive Personen aus `personio_employees`, „Nachname, Vorname“ |

Eine **Bubble** gehört zu einem Bereich (der Dashboard-Seite), trägt eine
Nummer je Bereich, optional eine Ampel und optional ein Rechteck als Anteil
der Seite (0..1). Ein Kommentar aus der Zeit vor 0050 ist eine Bubble ohne
Position: er steht in der Liste, aber nicht auf der Seite, und gilt als
gesehen.

Eine **Maßnahme** hängt an einer Kennzahl, optional an einer Bubble ihres
Bereichs. Status `offen`, `laeuft` („in Arbeit“), `erledigt`, `verworfen`;
Priorität `niedrig`, `mittel` (Vorgabe), `hoch`. `erledigt_am` setzt ein
Trigger.

## Bereich und Seite

| Bereich | Seite |
|---|---|
| vertrieb | `/kpi/vertrieb` |
| personal | `/hr/kennzahlen` |
| qualitaet | `/kpi/qualitaet` |
| finanzen | `/kpi/finanzen` |
| einkauf | `/kpi/einkauf` |
| produktion | `/kpi/produktion` |

Die Ebene liegt in `app/(app)/kpi/layout.tsx` und
`app/(app)/hr/kennzahlen/layout.tsx` und findet den Bereich über die Adresse.
Die Dashboard-Seiten selbst wissen nichts von ihr.

## Abweichung vom Altsystem

Im Altsystem hängt eine Bubble am Dashboard (`kpi_key = "quality"`), eine
Maßnahme an der Kennzahl (`"quality.audit_findings"`); die Bubble-Auswahl im
Formular fragt die Bubbles der Kennzahl ab und findet deshalb nie eine. Hier
bietet das Formular die Bubbles des Bereichs der gewählten Kennzahl an.

Die Position ist wie im Altsystem ein Anteil der ganzen Seite. Ändert sich
die Seitenhöhe (anderer Zeitraum, andere Ansicht), steht die Bubble an
derselben relativen Stelle, nicht zwingend am selben Diagramm.

## Rechte

| | Recht |
|---|---|
| Maßnahmen und Bubbles lesen | ein `kpi`-Recht |
| Bubbles setzen, als gesehen markieren, löschen; Maßnahmen anlegen, ändern, löschen | `settings: editor` |
| Namen der Verantwortlichen | `settings: editor` (die Funktion prüft selbst) |

Im Altsystem ist beides „Admin“. Hier bleibt es bei der Schranke der
Zielwerte: wer entscheidet, was ein guter Wert ist, pflegt auch die
Maßnahmen. Die Übersicht mit Bubbles und das Formular sieht nur, wer
schreiben darf — wie im Altsystem nur der Admin.
