# Sensoren — Temperatur und Luftfeuchte per SNMP

Ein Messgerät im Netz wird alle fünf Minuten gefragt; was es liefert, wird zur
Zeitreihe und zur Kachel. Mehr ist es nicht — und genau deshalb lohnt es sich,
die drei Stellen aufzuschreiben, an denen es im Altprojekt anders war.

| Teil | Ort |
|---|---|
| Zeitreihe und Kachel | `/sensoren` (Recht `sensors`) |
| Geräte einrichten | `/einstellungen#sensoren` (Plattform-Verwaltung) |
| Abfrage, Verschlüsselung | `compute`, `app/sensoren/` |
| Schema, Takt, Aufräumen | Migration `0026_sensoren` |

## Drei Tabellen, nicht zwei

Eine gescheiterte Abfrage ist keine Messung. Sie gehört trotzdem festgehalten:
ohne sie sieht ein stiller Ausfall aus wie ein Gerät, das gerade nichts zu
melden hat. Messwerte stehen deshalb in `sensor_messungen`, jeder Versuch in
`sensor_versuche`.

Die Sicht `sensor_stand` legt beides nebeneinander — letzter Messwert, letzter
Versuch, je Gerät eine Zeile aus zwei `lateral`-Abfragen. Im Altprojekt holt die
Oberfläche dafür je Gerät eine eigene Antwort und rechnet den Zustand im
Browser.

Die Sicht läuft mit `security_invoker = true`: sie gibt nur her, was die
Policies der beiden Tabellen ohnehin hergeben würden. Ohne das wäre eine Sicht
ein Weg, RLS zu umgehen.

## Die Community steht verschlüsselt in der Zeile

Beim ATR-Dateiserver liegt das Passwort in der Umgebung — es gibt genau eines.
Hier hat jedes Gerät sein eigenes Geheimnis, und eine Umgebungsvariable je
Gerät wäre eine Verwaltungsaufgabe mehr. Also Fernet: der Geheimtext in der
Spalte, der Schlüssel (`GEHEIM_SCHLUESSEL`, früher `SENSOR_SCHLUESSEL` — der
gilt weiter) in der Umgebung von `compute`. Ein Abzug der Datenbank allein gibt
die Community nicht her. Denselben Weg gehen inzwischen die
Personio-Zugangsdaten aus den Einstellungen; der gemeinsame Helfer heißt
`app/geheim.py`.

Dazu zwei Riegel, die zusammengehören:

- **Das Spaltenrecht gibt sie gar nicht erst frei.** `grant select (…)` zählt
  die erlaubten Spalten auf; `community` fehlt darin. PostgREST kann sie
  deshalb auch verschlüsselt nicht ausliefern — und ein `select *` scheitert,
  statt still etwas mitzunehmen.
- **Geschrieben wird nur über `compute`.** `authenticated` hat kein
  `insert`/`update`/`delete` auf `sensoren`. Jede Änderung kann die Community
  tragen, und verschlüsseln kann sie nur, wer den Schlüssel hat.

Angezeigt wird sie nirgends. Wer sie ändern will, trägt eine neue ein.

## Wohin der Dienst fragen darf

`SNMP_ERLAUBT` gibt Namen und Subnetze vor, `app/netz.py` prüft jede aufgelöste
Adresse. Das ist derselbe Riegel wie `ATR_SMB_ERLAUBT` und derselbe Befund 16:
im Altprojekt trägt ein Admin in der Maske ein Ziel ein, und der Dienst meldet
sich dort mit einem Geheimnis an. Geprüft wird vor dem Anlegen, vor dem Ändern
des Rechners und vor jeder Abfrage.

## Grenzwerte je Gerät

Im Altprojekt stehen sie als vier Spalten im Einstellungs-Singleton und gelten
für alle Geräte gleich. Ein Serverraum und ein Lager haben aber nicht dieselbe
Vorstellung von „zu warm". Hier hängen `temperatur_min`/`_max` und
`feuchte_min`/`_max` am Gerät; die Kachel färbt den Wert, das Diagramm zieht
zwei gestrichelte Linien.

## Der Takt kommt aus der Datenbank

`pg_cron` stößt alle fünf Minuten über `pg_net` `/api/sensoren/geplant` an,
abgesichert mit `SENSOR_TOKEN` (verglichen mit `hmac.compare_digest`). Im
Altprojekt hält ein Thread in der API den Zeitplan — das ist der Grund, warum
der dortige Dienst auf `--workers 1` festgenagelt ist.

Das Token muss zusätzlich in der Datenbank stehen, und zwar als
**`supabase_admin`** — `postgres` darf den Parameter nicht setzen:

```bash
docker compose exec db psql -U supabase_admin -d postgres \
  -c "alter database postgres set acm.sensor_token = '<derselbe Wert>';"
```

Fünf Minuten statt einer Minute wie im Altprojekt: für Raumtemperatur ist das
feiner, als irgendjemand ablesen kann, und macht die Zeitreihe fünfmal so
groß. Aufgeräumt wird nachts — Messwerte nach drei Jahren, Versuche nach
vierzehn Tagen. Die Versuchsliste ist Betriebsprotokoll, kein Messwert.

## Was ein Durchgang aushält

- **Ein Gerät hält die anderen nicht auf.** Alle Abfragen laufen nebeneinander
  (`asyncio.gather(..., return_exceptions=True)`); ein Fehler bleibt bei seinem
  Gerät und wird zu einer Zeile in `sensor_versuche`.
- **Ein Lauf von Hand und der geplante Lauf können sich treffen.** Die
  Eindeutigkeit über `(sensor_id, gemessen_am)` und `on conflict do nothing`
  sorgen dafür, dass die Zeitreihe nicht doppelt zählt.
- **Ein Wert, der keine Zahl ist, wird nicht still zu Null.** Er wird als
  Hinweis gemeldet und der Versuch als gescheitert festgehalten.

## Der Faktor

Manche Geräte liefern Zehntelgrad als ganze Zahl: 235 statt 23,5. Dafür trägt
jedes Gerät `temperatur_faktor` und `feuchte_faktor`. Die Probe beim Einrichten
(„Ausprobieren") zeigt den **Rohwert** — daran erkennt man, welcher Faktor
nötig ist.
