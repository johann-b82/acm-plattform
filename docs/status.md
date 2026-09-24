# Stand des neuen Stacks

**Produktiv seit 24. September 2026.** Der Stichtag ist gefahren, die Plattform trägt den Betrieb. Was hier steht, gilt für den laufenden Stand; der Ablauf des Stichtags selbst und seine Fallstricke stehen in `docs/cutover.md`.

## Wo was läuft

Host `acm@192.9.201.9`, drei Compose-Projekte nebeneinander:

| | Adresse | Verzeichnis | Rolle |
|---|---|---|---|
| **Plattform** | `http://192.9.201.9` (Port 80) | `/home/acm/acm-plattform` | produktiv |
| **Signage** | Port 8080 | `/home/acm/acm-signage` | fünf Bildschirme |
| **Altprojekt** | Port 8082 | `/home/acm/lumeapps-neu` | Rückfall, **nicht abgeschaltet** |

Das Altprojekt läuft bewusst weiter. Es kostet wenig und ist der Rückweg, solange niemand bestätigt hat, dass nichts fehlt. Abschalten ist eine eigene, spätere Entscheidung.

### Was man wissen muss, bevor man etwas anfasst

- **Die Adresse ist der Vertrag.** Die Bildschirme halten ihr Gerätetoken im `localStorage`, und der hängt am Origin. Ändert sich Schema, Host oder Port von `http://192.9.201.9`, zeigt jede Tafel einen Kopplungscode. Aus demselben Grund reicht Caddy den Player-Weg (`/player/*`, `/api/signage/player/*`, `/api/signage/pair/*`) direkt an den Signage-Stack durch, statt ihn über `web` zu führen — siehe `infra/caddy/Caddyfile`, Snippet `signage_direkt`.
- **`API_EXTERNAL_URL` ist der Aussteller im Token.** Er muss Zeichen für Zeichen mit `PLATFORM_JWT_ISSUER` in `acm-signage/.env` übereinstimmen, sonst antwortet die Signage-Verwaltung mit 401. `cutover.sh schritt port80` zieht beides gemeinsam.
- **`docker-compose.override.yml` liegt nur auf dem Host**, nicht im Repo. Sie gibt `compute` echte DNS-Server (`192.9.200.1`, `.2`) — ohne sie löst `acm.local` im Container nicht auf und die AD-Anmeldung scheitert mit 503. `git archive`/`tar -x` löscht sie nicht, sie überlebt also das Ausliefern von Code.
- **Nach jedem Neustart der Plattform** brechen die Verbindungen der Bildschirme ab. Sie verbinden sich neu, aber ein hängender Anzeigebrowser braucht gelegentlich `systemctl --user restart signage-player` auf dem Pi.
- **Neuen Code ausliefern** geht weiter über `cutover.sh schritt 3`; der Schritt erkennt den erledigten Portwechsel und lässt die Adressen stehen (seit #142/#143).

## Was am Stichtag gefunden wurde

Sieben Fehler fielen erst im echten Lauf auf. Alle sind behoben und als PR im Baum — die Liste steht hier, weil jeder davon beim nächsten Mal wieder zuschlagen könnte:

| PR | Was es war |
|---|---|
| [#136](https://github.com/johann-b82/acm-plattform/pull/136) | Die Datenübernahme brach bei `einarbeitung_pflicht` ab: Migration 0065 hatte das Schema geändert, der Umzug nicht |
| [#137](https://github.com/johann-b82/acm-plattform/pull/137) | **Schritt 5 hätte jede Tafel entkoppelt.** Der Origin-Wechsel auf `:8080` leert den `localStorage` — der Schritt entfällt seither |
| [#138](https://github.com/johann-b82/acm-plattform/pull/138) | Digital Signage stand nicht in `public.apps`: keine Kachel, und die Stufe ließ sich gar nicht vergeben |
| [#139](https://github.com/johann-b82/acm-plattform/pull/139) | Der Portwechsel hatte kein Werkzeug — jetzt `schritt port80` mit Rückweg |
| [#140](https://github.com/johann-b82/acm-plattform/pull/140) | Dessen Prüfung urteilte über den Anlauf des Signage-Stacks statt über das Ergebnis |
| [#141](https://github.com/johann-b82/acm-plattform/pull/141) | `ports: !reset` **löscht** die Bindung, statt sie zu ersetzen — der Rückfall war eine halbe Stunde unerreichbar, ohne dass es auffiel |
| [#142](https://github.com/johann-b82/acm-plattform/pull/142), [#143](https://github.com/johann-b82/acm-plattform/pull/143) | `schritt 3` drehte den Portwechsel zurück und schaltete damit alle Tafeln ab |

Dazu im Signage-Repo [acm-signage#3](https://github.com/johann-b82/acm-signage/pull/3): Ein PDF, das nicht lädt, hielt die ganze Wiedergabeliste an — `<Document>` hatte kein `onLoadError`.

## Was offen ist

**Bei ms4it (Dienstleister), am 24.09. per PDF übergeben:**

1. **LDAPS-Zertifikate erneuern — das einzige verbliebene Sicherheitsrisiko.** `acm_dc01` und `acm_dc02` präsentieren Zertifikate vom 08.11.2016 mit einem Jahr Laufzeit, **abgelaufen am 08.11.2017**. Deshalb steht `ad_konfiguration.tls_pruefen` auf `false`: Der Verkehr ist verschlüsselt, aber nicht überprüfbar, und wer im LAN mitschneidet, liest die Windows-Kennwörter aller Anmeldenden. Nach der Erneuerung ist das Scharfschalten ein Einzeiler (`update public.ad_konfiguration set tls_pruefen = true`), danach gehört der 401-Test aus `docs/cutover.md` § 3a gefahren.
2. **`mail`-Attribute im AD**: 101 von 249 Konten ohne (Stand 17.09., bitte gegenzählen). Fehlt es, bekommt die Person ein Konto auf `name@acm.local` statt der Firmenadresse — und zwar bei der **ersten** Anmeldung, danach hilft nur noch Bereinigen von Hand.

**Im Haus:**

3. **Bildschirme an den Pis.** `Entrance` (192.9.201.12) und `Production Sewing` (192.9.201.36) hatten zeitweise beide HDMI-Ausgänge auf `disconnected`; ohne Display startet der Anzeigebrowser nur unvollständig (vier statt zehn Prozesse) und meldet sich nie. Erkennbar an `cat /sys/class/drm/card*/status`.
4. **Die CI in `acm-signage` ist kaputt.** Seit dem 16.09. scheitert jeder PR-Lauf nach zwei Sekunden, ohne einen einzigen Schritt auszuführen — ein Einstellungsproblem der GitHub Actions, kein Code. Der Player-Fix wurde deshalb mit lokal grünen Tests gemerged.
5. **`PptxPlayer` ungeprüft.** Er dürfte dieselbe Lücke haben wie `PdfPlayer` vor acm-signage#3 — ein Ladefehler könnte die Liste anhalten. Nicht nachgestellt.
6. **Fotos in der Neuzugänge-Tafel**: `/api/anzeige/foto/<id>` antwortet mit 404. Die Tafel selbst läuft, nur die Bilder fehlen. Kosmetisch.
7. **Schritt 2 des Stichtags — Zertifikat rotieren — wurde nie gefahren.** Der private Schlüssel aus `certs/internal.key` steht weiter in der Historie des Altprojekts und gilt als kompromittiert, falls er je ausgeliefert wurde. Betrifft das Altprojekt, nicht die Plattform.

## Zugänge und Sicherungen

- **Break-Glass-Admin** der Plattform: `bechtold@acm-aerospace.com`, Passwort in `/home/acm/zugang-admin.csv` (0600). Die AD-Anmeldung nutzt dasselbe Konto, weil das `mail`-Attribut darauf zeigt.
- **AD-Rechte** kommen aus `scripts/ad-rechte-mapping.sql` (25 Zuweisungen über 19 Gruppen, `grp_IT` → `platform: admin`). Das Skript ist wiederholbar und überspringt noch nicht gespiegelte Gruppen — es gehört mehrfach gefahren, während sich die Belegschaft nach und nach erstmals anmeldet. **Signage fehlt darin noch**, weil die App erst mit #138 entstand.
- **Sicherungen** unter `/home/acm/acm-plattform/backups/`, erzeugt von `scripts/backup.sh` (Datenbank als `.dump`, Dateien als `.tar.gz`). Am 24.09. zuletzt gelaufen und mit `pg_restore --list` lesbar.
- **Nach der Datenübernahme** liegt eine Sicherung der gelöschten WM-Medien in `/home/acm/wm-medien-geloescht-2026-09-24.txt`.

## Was steht

| Baustein | Zustand |
|---|---|
| Supabase self-hosted | Upstream `v1.26.08` gepinnt, per `include:` eingebunden, Overrides in `infra/supabase/`. Analytics und Vector aus, Ports nur auf 127.0.0.1. |
| Rechtemodell | `apps`, `groups`, `user_groups`, `app_grants`. `custom_access_token_hook` schreibt den Claim `apps` in jedes Token. RLS auf jeder Tabelle. |
| Rechteverwaltung | `/einstellungen#zugaenge`: Personen anlegen, Gruppen, Mitglieder, App-Rechte pflegbar. Schreibt über PostgREST, geprüft von den Policies; nur das Anlegen einer Person läuft über `compute`. |
| Next.js-Shell | Login, Launcher, Proxy (`src/proxy.ts`), Server Components lesen über die Nutzer-Session. |
| Compute-Dienst | FastAPI, prüft das Supabase-JWT. Dreizehn Upload-Routen, zwei für Personen, zwei für den Personio-Abgleich. Zustandslos, kein Scheduler, kein SSE — der nächtliche Anstoß kommt von pg_cron. |
| Fachmodul Vertrieb | Vollständig: fünf ERP-Uploads, sechs KPI-Funktionen als SQL, Dashboard mit Kacheln, Umsatzverlauf, Kundenanteil, Auswertung je Erfasser und der Vertriebsaktivität je Kalenderwoche. |
| Fachmodul Einkauf | Vollständig: Liefertermintreue und Ladenhüter der Lagerbestände. |
| Fachmodul Produktion | Aufträge in Verzug: zwei ERP-Uploads (Text und Excel), Sicht `auftrag_verzug`, drei KPI-Funktionen, Dashboard mit Verzugsliste. Dazu die Wartung unter `/produktion`: Maschinen, wiederkehrende Aufgaben, Herstellerpläne und der Nachweisbogen als PDF je Halbjahr. |
| Fachmodul Qualität | Kennzahlen: Audit-Findings, Reklamationsquote (On Quality), Prüfmengen mit Ausschussquote. Dazu das Audit-Modul unter `/qualitaet`: Planung, Phasen-Checkliste aus Vorlagen, Normbezug und ein Verlauf, den die Datenbank selbst schreibt und niemand mehr ändern kann. |
| Fachmodul Finanzen | Vollständig: Materialkostenquote mit Preisliste als Sicht auf die Wareneingänge, Personalkostenquote aus dem Personio-Abgleich samt Aufteilung nach Abteilung. |
| Zeugnisse | Arbeitszeugnis aus Schulnoten und Stichpunkten: Baukasten ohne Netz, KI-Formulierung mit Datensparsamkeit (kein Name, kein Geburtsdatum, keine Personalnummer), DOCX auf der echten ACM-Briefvorlage und PDF. Die fachliche Unterschrift löst sich je Person aus Personios Organisationsstruktur auf, die personalseitige steht im Ausstellerprofil unter `/einstellungen#zeugnisse`; beide sind vor dem Erzeugen sichtbar. |
| Einarbeitung | Inhalte mit Ansprechpartner, Abteilungsmatrix und der persönliche Einarbeitungsplan als PDF (ACM-Formblatt mit Logo). |
| Onboarding | Eintritte aus Personio und extern gepflegte Personen in einer Liste, der Schulungsplan als Datenbankfunktion (Soll gegen Ist, beide Ebenen der Matrix), Abteilungs-Übersteuerung und die Zuordnung Position → Abteilungskürzel. Dazu die Papiere: Schulungsübersicht (Formblatt 71) einzeln und das Onboarding-Paket (Einarbeitungsplan + Übersicht) als ein PDF — dessen Abruf vermerkt die Übergabe. |
| Schulungen | Katalog mit Turnus und Frist, Anforderungsmatrix auf zwei Ebenen, Teilnahmen und eine Liste „was offen ist" nach Dringlichkeit. Fälligkeiten rechnet die Sicht `schulung_stand`, sie stehen nirgends gespeichert. Dazu die Matrix unter `/hr/schulungen/matrix`: alle Personen gegen alle Schulungen, auch die ohne jede Teilnahme. Der Import ergänzt und verwirft keine Zeile, die sich Personio nicht zuordnen lässt. |
| Kompetenzen | Qualifikationsmatrix je Bereich unter `/hr/kompetenzen`: Bereichsdatei einlesen (mit Vorschau), Raster mit stehender Kopfspalte, Lücken in Warnfarbe, Zeilendurchschnitt aus der Sicht statt aus einer Excel-Formel. |
| Fachmodul Personal | Personio-Abgleich (Stammdaten, Anwesenheiten, Abwesenheiten aus zwei Quellen), Überstunden-, Krankheits- und Fluktuationsquote als SQL, nächtlich über pg_cron, Vollständig: Dashboard unter `/hr` mit Abgleichstand, drei Quoten, Belegschaft, Kompetenzentwicklung, Mitarbeitertabelle und Wochenbericht. |
| Anzeigen für die Bildschirme | Geburtstage der Woche und Neuzugänge als Tafeln unter `/embed/*`, ohne Anmeldung, aber mit signiertem und ablaufendem Token je Playlist-Eintrag (Befund 4). Kein Geburtsdatum, kein Alter; das Foto antwortet nur für gerade gezeigte Personen, mit Zwischenspeicher und Ratsperre. Adressen erzeugt `/einstellungen#anzeigen`. |
| Dokumentenlauf | Blätter mit QR-Code unter `/hr/dokumente`: erzeugen, aushändigen, ausgefüllt zurücknehmen, Scan hochladen. Die Prüfung misst je Pflichtfeld die Tinte gegen das leere Blatt und sagt, was fehlt; das Urteil ist von Hand überstimmbar. Eine Tabelle für beide Formblätter statt zweier wie im Altprojekt. |
| Hilfe | 22 Seiten unter `/hilfe`, für jeden Angemeldeten: Einstieg, Kennzahlen, Arbeiten, Fachanwendungen, Administration. Mit Volltextsuche. Für diesen Stand geschrieben, nicht aus dem Altprojekt abgeschrieben. |
| Erscheinungsbild | Hell, dunkel oder wie das System — drei Felder in der Kopfzeile. Die Wahl steht im Gerät, nicht am Konto, und wird vor dem ersten Bild angewandt (kein Aufblitzen). Mehrere Tabs gleichen sich über `useSyncExternalStore` ab. |
| Sprachen | Deutsch und Englisch, umschaltbar in der Kopfzeile. Die Wahl steht in einem Cookie, damit der Server die Seite gleich richtig setzt; `lang` am `<html>` geht mit. Das englische Wörterbuch ist über den Typ des deutschen getippt — eine fehlende Übersetzung ist ein Übersetzungsfehler, kein leerer Kasten. Übersetzt sind die Schale, die Kennzahlen, Personal mit allen Unterseiten, Uploads und die Seitentitel im Browser; Zahlen, Beträge und Datumsangaben folgen der Sprache. Alle Seiten sind in acht Teilen übersetzt. Deutsch bleiben drei Dinge, die Inhalt sind und keine Oberfläche: die 22 Hilfeseiten (die Hilfe sagt das in anderen Sprachen ausdrücklich), der Newsletter, und die Zielwerte samt ihren Beschreibungen — die stehen in der Datenbank. |
| Organigramm | Wer wem berichtet, unter `/hr/organigramm` — aus Personios Vorgesetztenkette, ohne eigene Pflege. Suche behält die Kette eines Treffers; Kreise und verwaiste Verweise lassen niemanden verschwinden. |
| Brotkrumenpfad | In der Kopfzeile, rechts neben dem Logo: der Weg von der Übersicht zur aktuellen Seite; in ihrer Mitte steht der Name der Seite. Die Kette entsteht aus der Adresse, nicht aus einer ausgeschriebenen Tabelle; ein Test besteht darauf, dass jede Seite einen Titel hat. Detailseiten enden bei ihrer Liste. |
| Zahlen in der Kopfzeile | Glocke für ungesehene Seitenmeldungen (Plattform-Verwaltung), Hakenliste für offene Maßnahmen über alle Kennzahlen — rot, sobald eine überfällig ist. Beide zeigen nur, was größer als null ist, und beide nur denen, die etwas damit anfangen können. |
| Info-Knopf je Kachel | Ein „i“ neben dem Kacheltitel zeigt den Rechenweg — ausgeschnitten aus der Hilfe, nicht zweitgeschrieben. Ein Test prüft jeden der 28 Verweise, denn eine umbenannte Überschrift ließe den Knopf lautlos verschwinden. |
| Datenstand je Dashboard | Unter der Überschrift steht, wie alt die Daten sind — das Datum der **ältesten** Datei, auf der die Seite steht, und was sie einzeln sagen in der Beschriftung. Fehlt eine, sagt die Zeile welche. |
| Zeitraumwahl | Monat, Quartal, Jahr, Alles — dazu ein freies Fenster aus zwei Datumsfeldern. Ein verdrehtes Fenster wird nicht abgefragt. Eine Komponente für alle sechs Dashboards statt sechs Kopien. |
| Vergleichswerte | Vorperiode und Vorjahr als Abzeichen an den Kacheln, über alle sechs Dashboards. Die Farbe folgt der Bedeutung, nicht dem Vorzeichen: ein Rückgang der Krankheitsquote ist grün. Ohne Vergleichswert erscheint gar kein Abzeichen. |
| Zielwerte | Eine Zeile je Ziel statt eines breiten Singletons. Pflegbar unter `/einstellungen`, gelesen von allen Dashboards. Dort auch die Personal-Einstellungen (Krankheitsarten, Produktionsabteilungen, Kompetenzfelder) als Listen — anklickbar aus Personio-Vorschlägen statt abgetippt. |
| Einstellungen | Eine Seite für alles Einstellbare, nach Bereich gruppiert: Kennzahlen, Personal, ATR, Nutzer und Gruppen. Sie gehört der Plattform-Verwaltung — was dort steht, gilt für alle und hängt an keiner Person. Erklärungen hängen am Fragezeichen neben Überschrift und Feld, nicht als Fließtext dazwischen. |
| KPI-Bewertung | Kommentar und Maßnahme zu jeder Kennzahl mit Zielwert. Die Liste ist `zielwerte` selbst — kein zweites Register, das hinter den Dashboards zurückbleiben kann. Lesen mit `kpi`-Recht, Schreiben ab `settings: editor`. |
| Newsletter | Eine Ausgabe je Quartal mit Kapiteln, Markdown und Bildern; Leseransicht und PDF unter `/newsletter`, Redaktion unter `/newsletter/redaktion`. Belegschaftszahlen und Neuzugänge werden je Ausgabe eingefroren, nicht live gelesen. |
| FAIR | Erstmusterprüfung: Zeichnung hochladen, Maße ballonieren, Prüfliste neben der Zeichnung mit Drag-and-drop, OCR je Zeile (lokal ausgeliefert), Ausgabe als CSV und PDF. Nummerierung gehört der Datenbank — lückenlos, auch über PostgREST (siehe `docs/modules/fair.md`). |
| ATR | Vollständig: Teilekatalog, Vorlage, Lieferschein einlesen und durchsehen, Mappe, PDF und Container-Etikett erzeugen, Scan eines Eingangsordners auf dem Dateiserver. Gegen die **echten** Vorlagen aus der Produktion und am echten Ordner geprüft. |
| Sensoren | Temperatur und Luftfeuchte per SNMP: Zeitreihe, Kacheln mit Grenzwerten je Gerät, Verlauf über 6 h bis 7 Tage. Geräte werden unter `/einstellungen#sensoren` gepflegt, die Community liegt Fernet-verschlüsselt in der Zeile und wird nie angezeigt. |
| App Feedback | Knopf „App Feedback melden“ in jeder Ansicht, Bild des sichtbaren Ausschnitts im Eimer `feedback`. Melden darf jede angemeldete Person, abarbeiten die Plattform-Verwaltung unter `/platform/feedback`: Status offen, In Bearbeitung, erledigt; Zuweisung an ein Konto; Kanban nach Status oder Person, geändert wird per Ziehen. Erster Verbraucher von Supabase Storage. |
| Signage | Eigenes Repo `acm-signage`, eigener Compose-Stack, eigene Datenbank, eigener Caddy. Die Verwaltung hängt als App-Kachel in der Plattform. |
| Aufräumen | `pg_cron`, täglich 3:30 Uhr, Upload-Protokolle 365 Tage. |
| Zeitgesteuertes | `pg_cron` stößt an, `pg_net` ruft. Der Dienst bleibt zustandslos — das Altprojekt ist wegen seines Schedulers im Prozess auf `--workers 1` festgenagelt. |
| Logging | `x-logging`-Anker auf jedem Dienst, Caddy `level ERROR`, uvicorn ohne Access-Log, Guard im CI. |
| Sicherung | `scripts/backup.sh`, zwei Teile: Abzug von `public`, `auth`, `storage` und ein `tar` des Datei-Volumes. 14 Tage Aufbewahrung, nicht eingeplant (Entscheidung F). |
| Datenübernahme | Läufe für Vertriebsdaten, Personen und Signage stehen bereit, gegen eine echte Alt-Datenbank geprüft. |

Tests: 757 in `compute`, 97 in `apps/web`. CI prüft Guards, Compute und Web.

## Was bewiesen ist

- **Deployments treffen keine Screens.** Nachgestellt mit offener Geräteverbindung: ein Player-Stream (`/api/signage/player/stream`) lief, währenddessen ging die Plattform komplett herunter (`docker compose down`, inklusive ihres Netzes) und wieder hoch. Die Verbindung blieb bestehen, die Heartbeat-Pings laufen über den Neustart hinweg durch, und eine danach geänderte Playlist erreichte denselben Stream. Die Signage-Container wurden nicht angefasst.
- **Rechte greifen in der Datenbank, nicht in der Oberfläche.** Wer kein Plattformrecht hat, sieht in `plattform_nutzer` null Zeilen und scheitert beim Schreiben auf `groups` und `app_grants` an der Policy. Wer `kpi: viewer` hat, sieht Kennzahlen, aber keine Upload-Historie, und bekommt beim Upload 403.
- **Der Claim folgt der Gruppe.** Nach Aufnahme in eine Gruppe liefert `custom_access_token_hook` das Recht der Gruppe. Es wirkt ab der nächsten Anmeldung.
- **Die Platte wächst nicht mehr im Leerlauf.** Alle zwölf Container tragen den Rotationsanker (`json-file`, 3×10 MB). Nach einem vollständigen Durchgang durch Launcher, Kennzahlen, Uploads, Signage und Verwaltung stehen im Caddy-Log 14 Zeilen, alle vom Start, keine einzige pro Anfrage. Der Compute-Dienst schrieb null Zeilen. Zum Vergleich: im Altprojekt kamen allein von einem Pi rund 13.000 Zeilen pro Tag.
- **Der Weg zurück ist gegangen worden, nicht nur beschrieben.** `scripts/backup.sh` erzeugt einen Abzug und prüft ihn mit `pg_restore --list`. Zurückgespielt in eine leere Datenbank kamen alle Tabellen, alle Zeilen und alle zehn Policies wieder, bei sieben harmlosen Meldungen.
- **Die Vertriebsaktivität rechnet, was das Altprojekt rechnete.** Fünf Wochen-Diagramme über 465 Kontakte, 119 Angebote, 57 Interessenten und 86 Auftragszeilen. Stichprobe KW 33: die Karte zeigt 28 Erstkontakte, aufgeteilt KH 10 · MM 10 · SB 8 — dieselben Zahlen liefert eine direkte Abfrage auf `sales_contacts`. Angebotssumme KW 29 (440.428,39 €) und Auftragseingang KW 35 (41.939 €, Stornos gegengerechnet) ebenso gegengerechnet.
- **Tabelle und Kachel rechnen dasselbe.** Die Summe der Mitarbeiterzeilen ergibt genau die Überstunden-Kachel (54.291,00 Ist und 3.023,50 Überstunden auf beiden Seiten, an Testdaten gemessen). Im Altprojekt weichen sie um den Faktor zehn ab, weil die Tabelle dort je Anwesenheitssegment und mit pauschalem Tagessoll rechnet: 89,6 gegen 926,3 Stunden über 90 Tage, auf den echten Daten gemessen.
- **Der Wochenbericht prüft sein Recht selbst.** Er trägt Namen neben Stunden; die Zugriffsregeln an den Tabellen kennen aber nur „darf HR sehen". Ohne `hr:admin` gibt die Funktion keine Zeilen zurück — kein Fehler, keine Zeilen. Zwei Tests halten beide Richtungen fest.
- **Gehälter verlassen die Datenbank nicht als Einzelwerte.** Die Zeile je Person (`hr_personalkosten_je_person`) ist nicht an `authenticated` freigegeben; nur die Aggregatfunktionen dürfen sie rufen. Ein Test prüft, dass ein direkter Aufruf mit `permission denied` scheitert. Die Aufteilung zeigt jede Abteilung einzeln (Nutzerentscheidung FIN-05), aber nur als Summe.
- **Eine abgewiesene Änderung meldet keinen Erfolg mehr.** In der Datenbank nachgestellt: weist eine Policy ein `update` ab, meldet Postgres `UPDATE 0` — keinen Fehler. PostgREST reicht das als Erfolg durch, und die Einstellungsseite sagte „Gespeichert", während sich nichts geändert hatte. Beide Schreibwege holen die geänderten Zeilen jetzt mit `.select()` zurück und werfen bei einer leeren Antwort.
- **Die HR-Rechenwege sind an echten Daten geprüft.** Aus dem LAN gegen die Produktionsdatenbank gerechnet (nur Aggregate, lesend): das Arbeitszeitmodell steckt bei allen 75 aktiven Personen und ist nicht flach — Mo–Do 8:45, Fr 5:00. Mit dem Modell ergibt die Überstundenquote über 90 Tage 4,93 %, mit einem flachen Tagessoll wären es 9,58 %. Und der Stundenzweig der Krankheitsquote springt im Altprojekt bei keiner der 250 Abwesenheiten an; über 90 Tage sind das 19.106 statt 17.665 Krankstunden.
- **Die Maßnahmenliste kann nicht auf eine Kennzahl zeigen, die es nicht gibt.** Der Fremdschlüssel geht auf `zielwerte.schluessel`; ein Eintrag auf einen unbekannten Schlüssel scheitert in der Datenbank, und wird ein Ziel gelöscht, gehen Kommentare und Maßnahmen mit. Das Erledigungsdatum setzt ein Trigger, nicht die Oberfläche: über das echte Formular auf „erledigt" gestellt, stand `erledigt_am` in der Zeile, ohne dass der Browser ein Datum geschickt hätte.
- **Eine gelöschte Meldung lässt kein Byte liegen.** Im Browser durchgespielt: gemeldet, Bild angesehen, auf erledigt gesetzt, gelöscht — danach null Zeilen in `public.feedback`, null in `storage.objects` und null Dateien im Volume. Der Weg dorthin war nicht selbstverständlich: `storage.objects` weist ein direktes `delete` ab, auch mit vollem Recht, damit niemand die Zeile entfernt und die Datei stehen lässt. Gelöscht wird über den Dienst, Bild vor Zeile.
- **Der Speicher liegt jetzt dort, wo er hingehört.** Der Upstream hängt die Dateien als Bind-Mount in `upstream/volumes/storage` — ein Verzeichnis, das `fetch-upstream.sh` gehört und das nicht eingecheckt ist. Der Override setzt ein benanntes Volume. Aufgefallen ist es an einem harten Fehler: der Dienst legt den Inhaltstyp als erweitertes Attribut an der Datei ab, und ein Bind-Mount vom Mac kann das nicht (`ENOTSUP`). Die Sicherung zieht das Volume seitdem mit, mit GNU tar und `--xattrs` — busybox-tar hätte die Attribute stillschweigend verloren.
- **Eine Archiv-Ausgabe sagt, was sie damals sagte.** Belegschaftszahlen und Neuzugänge stehen als eingefrorener Stand am Kapitel, nicht als Verweis auf `personio_employees`. Nachgestellt: Stand eingefroren, danach eine Person eingestellt — die Zahl in der Ausgabe blieb. Das ist nicht nur Archivtreue, sondern auch eine Rechtefrage: die Tabelle ist für Newsletter-Leser nicht lesbar, und die beiden Einfrier-Funktionen prüfen selbst, dass der Einfrierende die Quelle sehen dürfte — Aggregate verlangen `kpi`, Namen verlangen `hr`.
- **Eine gelöschte Ausgabe lässt keine Datei zurück.** Im Browser durchgespielt: Ausgabe mit drei Bildern angelegt, ein Bild einzeln gelöscht (3 → 2 Dateien), dann die ganze Ausgabe — danach null Zeilen in allen vier Tabellen, null Objekte und null Dateien im Volume. Die Kaskade räumt die Zeilen, die Dateien muss die Oberfläche selbst nehmen.
- **Ballonnummern können keine Lücke bekommen.** Nummer vergeben, Lücke schließen und Umsortieren hängen an Triggern und einer Funktion, nicht an einem Router — über PostgREST gibt es keinen Weg daran vorbei. Im Browser durchgespielt: drei Ballons gesetzt, die erste gelöscht, aus 2 und 3 wurden 1 und 2, in Zeichnung und Liste gleichzeitig. Möglich wird das einfache `update` durch eine aufgeschobene Eindeutigkeitsbedingung; das Altprojekt braucht dafür zwei Durchgänge mit einem Zwischenwert oberhalb einer Million.
- **Die ATR-Erzeugung ist an den echten Vorlagen geprüft.** Beide Gerüste aus der Produktion (A350 und A380) gefüllt und nachgesehen: Kopfblock unangetastet, MSN links aufgefüllt in der dreigeteilten Bestellzeile, Bestellpositionen normiert, Gewicht mal Menge, Summe und Höchstgewicht, Zertifizierungsblock samt Unterschrift und Datum. Dabei kamen vier Fehler heraus, die eine nachgebaute Vorlage nicht gezeigt hätte — darunter ein `_x000a_` quer über der Druckkopfzeile und ein amerikanisch gesetztes `=TODAY()` im PDF. Beide behoben, beide mit einem Test festgehalten. Die echten Vorlagen liegen nicht im Repository: sie tragen Kundenspezifikationen, Teilenummern und ein Firmenlogo.
- **Der Ordner-Scan ist am echten Dateiserver gelaufen.** Vor Ort gegen `\\acm_file\Dateiablage\0900 - EDV\Test_ATR` geprüft, aus der Oberfläche angestoßen: ein echter Diehl-Lieferschein im Eingang, 8 Positionen erkannt, alle 8 im Katalog gefunden, Lieferung angelegt, Datei ins Archiv verschoben. Dabei fiel die Entdeckung an, dass ein Katalog aus einer einzelnen Referenzmappe zu wenig ist — die Produktion führt 287 Teile aus neun Mappen, und dafür gibt es jetzt `uebernahme-atr`. Die Archiv-Abwehr gegen gleiche Namen hat auf echten Daten ausgelöst und `… (1).pdf` geschrieben statt zu überschreiben.
- **Der Dienst kann sich nicht an einem beliebigen Rechner anmelden.** Das Scan-Ziel steht in der Datenbank, die Erlaubnis in `ATR_SMB_ERLAUBT`; `pruefe_ziel()` löst den Namen auf und prüft jede zurückgegebene Adresse. Damit ist Befund 16 aus dem Altprojekt geschlossen, wo ein Admin über die Einstellungsmaske jedes Ziel im Netz eintragen konnte. Das Passwort bleibt aus demselben Grund in der Umgebung und nicht in der Tabelle: was in der Datenbank steht, steht in jeder Sicherung. Wer den Eingang durchsehen darf, darf deshalb noch lange nicht eintragen, worauf er zeigt — `atr: editor` gegen `platform: admin`, mit vier Tests an den Policies.
- **Ein Sensorziel ist nicht frei wählbar, und die Community verlässt die Datenbank nicht.** Im Browser durchgespielt: ein Gerät auf `8.8.8.8` wird beim Anlegen abgewiesen („zeigt auf 8.8.8.8 — das liegt in keinem freigegebenen Netz"), ein erlaubtes wird angelegt und steht mit 100 Byte Geheimtext in der Zeile, in dem die Community nicht mehr vorkommt. Das Spaltenrecht gibt sie auch der Plattform-Verwaltung nicht heraus (`permission denied`), und `authenticated` hat auf `sensoren` gar kein Schreibrecht. Ein Messlauf gegen ein Gerät, das nicht antwortet, endet als Hinweis und als Zeile in `sensor_versuche` — nicht als Absturz.
- **Der Audit-Verlauf lässt sich nicht mehr fälschen.** Im Altprojekt hält seine Unveränderlichkeit die Absprache, dass kein Router ein `UPDATE` anbietet — die dortige Doku sagt das selbst. Hier ist das Recht entzogen (`select`/`insert`, sonst nichts) und ein Trigger weist Ändern und Löschen zusätzlich ab: nachgemessen scheitert sogar `postgres` daran. Und er weiß jetzt, wer gehandelt hat: im Browser eine Pflichtphase mit Begründung übersprungen, danach stand die Änderung mit `admin@acm.local` und dem Grund in der Zeile — im Altprojekt steht dort nur eine UUID, weil das Token keine echte Adresse trug.
- **Migrationen laufen beim Start.** Der Dienst `migrate` spielt Alembic ein und fordert danach den PostgREST-Schema-Cache neu an.
- **Das Altsystem ist abgesichert, solange es noch läuft.** 18 der 21 Befunde aus `docs/security-findings.md` sind in `lumeapps` abgearbeitet (PRs #145–#151): kein Dev-Server und kein root im Betrieb, JWT mit Aussteller und Pflicht-Ablauf, Kiosk-Einbettung ohne Personaldaten, Rumpf- und Archivgrenzen vor pandas, Nutzerdateien nicht mehr inline im eigenen Ursprung, CSRF-Riegel auf der Cookie-Sitzung, Produktionsbild ohne Testsuite. Drei bleiben bewusst offen, mit Begründung in derselben Datei. Zwei verlangen den Host: TLS und die Zertifikatsrotation.

## Was bewusst fehlt

- **World Cup und Tippspiel kommen nicht mit** (Entscheidung 2026-09-10). Ein Upstream-Proxy mit Cache und sieben Embed-Seiten für ein einmaliges Turnier — das Turnier ist vorbei, der Code bleibt im Altrepo lesbar.
- **Datenübernahme aus `lumeapps` — am 24.09.2026 ausgeführt.** Alle 83 Tabellenpaare stimmen überein; der Abgleich lief mit Rückgabewert 0. Übernommen wurden unter anderem 192.874 Materialbewegungen, 31.922 Prüfsätze, 14.245 Sensormessungen, 18 FAIR-Zeichnungen mit 439 Ballons, dazu 416 Dateien und die neun `signage_*`-Tabellen. Die Läufe bleiben wiederholbar.
- **AD-Anbindung — seit dem 24.09.2026 im Produktivbetrieb** (#94): Anmeldung gegen das lokale AD über LDAPS. Der Browser schickt Benutzer+Passwort an `compute`, das gegen AD bindet und dem Web-Server ein Einmalpasswort zurückgibt; „Lokal anmelden“ bleibt als Rückfall für lokale Konten. Gruppen-Abbildung über `groups.source`/`groups.external_id`, bewertet in ADR-0004.
- **TLS — wartet auf eine Subdomain.** Auch im Produktivbetrieb läuft alles über HTTP im LAN; scharf geschaltet wird erst, wenn ein fester Hostname steht. **Achtung:** Ein Wechsel auf `https://` ändert den Origin und entkoppelt damit jede Tafel (siehe oben) — er gehört mit demselben Werkzeug gefahren wie der Portwechsel, nicht von Hand. Der Header-Block und `request_body max_size` liegen schon im Caddyfile; dann noch `SITE_URL`/`API_EXTERNAL_URL` auf `https://…`.

## Rezept für das nächste Modul

Das Vertriebsmodul ist die Vorlage. Für jedes weitere Modul in dieser Reihenfolge:

1. **Migration** in `services/compute/alembic/versions/`. Tabellen, Indizes, `enable row level security`, je eine Lese- und eine Schreibpolicy über `public.app_level('<app>')`. Die App-Kachel als Zeile in `apps`.
2. **Rechenweg als SQL-Funktion**, nicht als Python-Schleife. `docs/kpi-rechenwege.md` hält fest, was die alte Implementierung gerechnet hat; die Funktion muss dasselbe Ergebnis liefern.
3. **Compute nur, wenn es rechnet.** Datei-Parsen, Dokumenterzeugung, externe Systeme. Reines Lesen und Schreiben geht direkt über PostgREST.
4. **Seite unter `apps/web/src/app/(app)/<app>/`.** Server Component holt die Sitzung mit `requireApp`, Client-Insel lädt über TanStack Query.
5. **Tests**: Parser als reine Funktionen, Policies und SQL-Funktionen gegen die Testdatenbank (`docker-compose.test.yml`).
6. **Alte Route in `lumeapps` abschalten**, sobald die neue Seite trägt.

Reihenfolge der Module steht in `docs/plan.md`, Abschnitt 9, Phase 4. Was je Modul übernommen und was gelöscht wird, steht in `docs/inventory.md`.
