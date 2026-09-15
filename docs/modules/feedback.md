# App Feedback

Ein Knopf **App Feedback melden** unten rechts in jeder angemeldeten Ansicht:
beschreiben, was auf dieser Seite nicht stimmt, mit einem Bild des
Ausschnitts, den man gerade vor sich hat. Die Plattform-Verwaltung arbeitet
die Meldungen ab. (Bis September 2026 hieß das Modul „Meldungen“.)

Das Modul ist zugleich **der erste Verbraucher von Supabase Storage** im neuen
Stack. Was dabei über den Speicher zu lernen war, steht weiter unten — der
Newsletter wird denselben Weg gehen.

## Datenquelle und Ablage

| Was | Wo |
|---|---|
| Meldung | `public.feedback` (Migrationen `0019_feedback`, `0056_feedback_bearbeitung`) |
| Zuweisbare Konten | Sicht `plattform_nutzer` (Migration `0003_verwaltung`) |
| Bild | Eimer `feedback`, nicht öffentlich, 5 MB, `image/png,jpeg,webp` |
| Objektname | `<Kennung der meldenden Person>/<zufällige UUID>.jpg` |

Die Zeile hält nur den Pfad. Im Altprojekt steckt der Screenshot als `bytea`
in der Tabelle (`page_feedback.screenshot_data`); jede Liste, jede Sicherung
und jeder `pg_dump` schleppt ihn mit.

## Die Liste

`/platform/feedback` zeigt die Meldungen als Tabelle wie im Altsystem
(Datum, Von, Seite, Beschreibung, Screenshot, Status, Zugewiesen, Aktionen)
oder als Kanban (MEL-01). Beide Ansichten zeigen dieselbe Menge; Bild öffnen
und löschen geht in beiden.

**Status:** `neu` („offen“), `in_bearbeitung` („In Bearbeitung“),
`erledigt`. **Zugewiesen** ist ein Konto der Plattform (`zugewiesen`, Verweis
auf `auth.users`); geht das Konto, bleibt die Meldung ohne Zuweisung stehen.
Zuweisbar ist jedes Konto aus `plattform_nutzer` — wer Feedback abarbeitet,
braucht ohnehin einen Login.

**Kanban:** umschaltbar gruppiert nach Status (drei Spalten) oder nach Person
(„Nicht zugewiesen“ vorn, dann je Konto nach E-Mail). Status und Zuweisung
ändern sich durch Ziehen einer Karte in eine andere Spalte — mit der Maus
oder über den Griff mit der Tastatur (Leertaste, Pfeiltasten, Leertaste). Was
das Ablegen ändert, entscheidet `ablegen()` in `feedback-liste.tsx`. In der
**Tabelle** ist der Status eine Auswahlliste je Zeile; die Zuweisung steht
dort nur.

**In der rechten Leiste** steht für die Plattform-Verwaltung auf jeder Seite,
was zu genau diesem Pfad gemeldet und noch nicht erledigt ist (offen und In
Bearbeitung): Beschreibung, Status, Zuständige, Datum. Zugeordnet wird nach
dem Pfad ohne Suchteil, Unterseiten zählen nicht mit (`gehoertZurSeite`). Jeder
Eintrag führt zur Liste; ist nichts offen, fehlt der Abschnitt. Die Leiste
zeigt nur und hakt nichts als gesehen ab.

**Gesehen ist kein Status.** Ungesehen ist ein Punkt an der Meldung.
Abgehakt wird er, wenn jemand den Punkt anklickt, das Bild öffnet oder die
Karte in eine andere Spalte zieht — wie im
Altsystem, wo ein Klick auf die Zeile ihn abhakt. Das bloße Öffnen der Seite
hakt nichts ab; sonst wäre die Markierung beim nächsten Besuch weg, ohne dass
jemand die Meldung gelesen hat.

## Rechte

| | Recht |
|---|---|
| Melden (Zeile und Bild) | jede angemeldete Person |
| Lesen, Status ändern, zuweisen, Löschen | `app_mindestens('platform', 'admin')` |

Die Schranke ist mit Absicht schief. Ein Fehlerbericht, den nur Berechtigte
schreiben dürfen, erreicht die Fehler nicht, die es zu finden gilt. Gelesen
wird dagegen eng: eine Meldung trägt einen Seitenpfad und ein Bild einer
Ansicht, die der Lesende womöglich selbst nicht sehen darf.

Wer meldet, liest auch die eigene Meldung nicht zurück. Das ist keine
Nachlässigkeit, sondern hat eine Folge im Code: `insert ... returning` läuft
durch die Leseregel und würde scheitern. Deshalb gibt `feedbackApi.melden`
nichts als die Auskunft zurück, ob das Bild mitging.

## Was der Speicher verlangt

Vier Dinge, die beim Bauen aufgefallen sind und die für jedes weitere Modul
mit Dateien gelten.

**Der Pfad trägt das Recht.** Die Regel auf `storage.objects` prüft
`(storage.foldername(name))[1] = auth.uid()::text`. Wer hochlädt, schreibt
damit in den eigenen Ordner und kann kein fremdes Bild überschreiben. Ein
Objektname ohne Ordner fällt durch.

**Gelöscht wird über den Dienst, nie über die Tabelle.** `storage.objects`
trägt einen Trigger, der ein direktes `delete` abweist — auch mit vollem
Recht. Geht man daran vorbei, bliebe die Datei im Eimer liegen. Die
Oberfläche löscht deshalb mit `storage.remove()`, und zwar das Bild vor der
Zeile: bleibt die Zeile stehen, weil der Speicher klemmt, ist nichts verloren
— umgekehrt bliebe ein Bild ohne Zeile zurück, das niemand mehr findet.

**Die Dateien liegen in einem benannten Volume, nicht im Upstream-Baum.** Der
Supabase-Upstream hängt `upstream/volumes/storage` als Bind-Mount ein. Dieses
Verzeichnis gehört `fetch-upstream.sh` und ist nicht eingecheckt — hochgeladene
Dateien lägen dort, wo ein Werkzeug sie jederzeit wegräumen darf. Der Override
in `infra/supabase/docker-compose.override.yml` setzt stattdessen das Volume
`speicher`. Nebeneffekt: der Speicher-Dienst legt Inhaltstyp und
Cache-Vorgabe als erweiterte Attribute an der Datei ab (`user.supabase.*`),
und ein Bind-Mount vom Mac kann das nicht — der Upload scheiterte mit
`ENOTSUP`.

**Die Sicherung braucht beide Teile.** Das Schema `storage` hält nur die
Zeilen; ein Abzug allein ergäbe Verweise auf Dateien, die es nicht mehr gibt.
`scripts/backup.sh` zieht deshalb zusätzlich einen `tar` des Volumes — mit
GNU tar und `--xattrs`, weil das busybox-tar des Speicher-Abbilds die
erweiterten Attribute nicht mitnimmt.

## Das Bild

Aufgenommen wird mit `html-to-image`, und zwar **der sichtbare Ausschnitt**,
nicht das ganze Dokument. Auf einer Seite mit langer Tabelle machte die
Tabelle sonst neunzehn Zwanzigstel des Bildes aus, und das, worauf der Melder
schaut, war ein unlesbarer Streifen: nachgemessen 1,3 MB gegen 93 KB für
denselben Bericht.

Zwei weitere Stellschrauben, beide gemessen:

- `skipFonts: true` — das Einbetten der Schriften ist der teuerste Schritt.
  Ohne ihn dauerte die Aufnahme auf der Einkaufsseite über zehn Sekunden, mit
  ihm wenige.
- Über die Leinwand statt `toBlob`: dessen `type` wird nicht beachtet, und ein
  PNG einer vollen Ansicht wiegt schnell zwei Megabyte.

Der Dialog geht sofort auf, die Aufnahme läuft daneben weiter. Auf einen
Knopfdruck hin sekundenlang gar nichts zu zeigen, wäre die Meldung nicht wert;
getippt wird in der Zeit ohnehin. Der Sendeknopf wartet, bis das Bild da ist.

Die Aufnahme ist freiwillig. Misslingt sie, oder ist sie größer als der Eimer
zulässt, geht der Bericht ohne Bild und sagt es im Hinweis. Ein Bericht ohne
Bild ist besser als keiner.

## Gleichzeitig arbeiten

App Feedback gehört zur Phase 1 von ADR-0006. Status, Zuweisung und Löschen
gehen nur mit der geladenen `version`: ziehen zwei dieselbe Karte in
verschiedene Spalten, gewinnt nicht still der Letzte — der Zweite erfährt, dass
jemand schneller war, und sieht den neuen Stand. Vor dem Löschen einer Meldung
mit Bild prüft die Oberfläche die Version zuerst; das Bild ist sonst weg.

**Gesehen ist keine Änderung am Inhalt.** Die Liste hakt ab, was angezeigt
wurde, und oft im selben Zug mit einem Statuswechsel. Zählte das die Version
hoch, scheiterte der Statuswechsel an der eigenen Markierung. Der Trigger lässt
die Version deshalb stehen, wenn sich nur `gesehen_am` ändert; gemeldet wird
die Änderung trotzdem, damit die Glocke überall stimmt.

Liste, Glocke und „App Feedback zu dieser Seite“ bleiben live
(`tabelle:feedback`) — der Kanal verlangt dasselbe Recht wie das Lesen, also
die Plattform-Verwaltung.

## Was es nicht gibt

Keine Antwortfunktion, keine Zuweisung, keine Benachrichtigung. Eine Meldung
ist entweder offen oder erledigt. Wird daraus eine Aufgabe, gehört sie in die
KPI-Maßnahmen oder ins Ticketsystem — nicht in ein zweites, halbes davon.
