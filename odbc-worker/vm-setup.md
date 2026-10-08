# ODBC-Worker-VM: Vorgabe und Einrichtung

Die KPIs der ACM-Plattform können direkt aus Apollo (CONZEPT 16) kommen statt
aus monatlichen Extrakt-Uploads. Weil der CONZEPT-ODBC-Treiber **nur als
32-bit-Windows-Treiber** existiert, der `compute`-Dienst aber unter Linux läuft,
erledigt das eine kleine **Windows-VM**: Sie liest Apollo per ODBC und schickt
die Daten an die Plattform-API. Gesteuert und überwacht wird sie **von der
Plattform** (Einstellungen → Datenquelle).

```
Apollo ──32-bit ODBC (nur lesend)──▶  Worker-VM (Windows)
                                        │  POST /api/odbc/<art>   (Daten)
                                        │  GET  /api/odbc/konfig  (Steuerung)
                                        │  POST /api/odbc/status  (Herzschlag)
                                        ▼
                               ACM-Plattform (compute) ──▶ kpi_* (unverändert)
```

Die VM baut **nur ausgehende** Verbindungen auf (Apollo-TCP + HTTPS zur
Plattform). Sie nimmt keine Verbindungen an, öffnet keine Ports, hält keine
Datenbank-Zugangsdaten der Plattform.

---

## 1. VM-Vorgabe (Spezifikation)

| Punkt            | Vorgabe |
|------------------|---------|
| Betriebssystem   | Windows 10/11 Pro oder Windows Server 2019/2022 (x64) |
| CPU / RAM / Disk | 2 vCPU, 4 GB RAM, 40 GB — der Worker ist leichtgewichtig |
| Software         | CONZEPT-16-Client mit ODBC-Treiber; **Python 3.12** + die Pakete aus `requirements.txt`. Treiber und Python **in derselben Architektur** — entweder beide 32-bit **oder** beide 64-bit (beide Treiber bringt der Client mit) |
| ODBC-DSN         | System-DSN, Server `192.9.200.134`, DB `apollo`. Je nach Architektur im passenden ODBC-Administrator anlegen: 32-bit über `C:\Windows\SysWOW64\odbcad32.exe`, 64-bit über `C:\Windows\System32\odbcad32.exe`. Name frei, muss aber mit `APOLLO_DSN` in `worker.env` übereinstimmen |
| Konto            | ein eigenes, **lesendes** Apollo-Konto; Windows-Dienstkonto nur mit „als Dienst/Batch anmelden" |
| Netz (ausgehend) | TCP zu `192.9.200.134` (Apollo) und HTTPS/HTTP zur Plattform (`ACM_BASE_URL`) |
| Netz (eingehend) | **keine** Freigabe nötig |

> **32-bit oder 64-bit?** Der CONZEPT-16-Client bringt **beide** ODBC-Treiber mit
> (32- und 64-bit). Entscheidend ist nur: **Python-Architektur = Treiber-/DSN-
> Architektur**, sonst scheitert das Laden der Treiber-DLL (`architecture
> mismatch`). **64-bit ist das einfachere Setup** (normales Python, der
> 64-bit-ODBC-Administrator liegt unter `System32`) und wird empfohlen; der
> ursprüngliche Aufbau nutzte 32-bit (DSN `Apollo 32 Bit`), das funktioniert
> weiterhin. Unten sind beide Wege aufgeführt — einen wählen und durchziehen.

---

## 2. Einrichtung Schritt für Schritt

### 2.1 CONZEPT-Client + ODBC-Treiber (DSN)
1. CONZEPT-16-Client installieren (bringt beide ODBC-Treiber mit:
   „CONZEPT 16 ODBC-Treiber (32 bit)" und „… (64 bit)").
2. Den zur gewählten Architektur passenden ODBC-Administrator öffnen und unter
   **System-DSN → Hinzufügen** den CONZEPT-16-Treiber wählen, Server
   `192.9.200.134`, Datenbank `apollo`:
   - **64-bit (empfohlen):** `C:\Windows\System32\odbcad32.exe`, DSN-Name z. B.
     `Apollo 64 Bit`.
   - **32-bit:** `C:\Windows\SysWOW64\odbcad32.exe`, DSN-Name z. B. `Apollo 32 Bit`.
3. Den DSN-Namen in `worker.env` als `APOLLO_DSN` eintragen (Schritt 2.4).

### 2.2 Python + Pakete (gleiche Architektur wie der DSN)
```powershell
# 64-bit (empfohlen): normales Python 3.12 von python.org.
py -3 -m pip install -r requirements.txt
py -3 -c "import struct; print(struct.calcsize('P')*8, 'bit')"   # 64

# 32-bit (nur wenn der 32-bit-DSN genutzt wird): „Windows installer (32-bit)".
py -3-32 -m pip install -r requirements.txt
py -3-32 -c "import struct; print(struct.calcsize('P')*8, 'bit')"   # 32
```
`pyodbc` muss in **derselben** Python-Architektur installiert sein wie der DSN.

### 2.3 Apollo-Zugang (verschlüsselt, nicht im Klartext)
Die Zugangsdaten gehören **nicht** fest in eine Datei. Zwei Wege:
- **Variante A (einfach):** `APOLLO_UID`/`APOLLO_PWD` in `worker.env` (Datei nur
  für das Dienstkonto lesbar machen: Rechte über `icacls` einschränken).
- **Variante B (wie das Reverse-Engineering):** DPAPI-verschlüsselte
  `%USERPROFILE%\apollo-cred.xml` (einmalig `..\set-apollo-cred.ps1`), und einen
  kleinen Vorspann, der sie entschlüsselt und als `APOLLO_UID/PWD` in die
  Umgebung legt, bevor `worker.py` startet. DPAPI bindet die Datei an das
  Windows-Konto — sie ist auf keiner anderen Maschine lesbar.

### 2.4 worker.env anlegen
`config.example.env` nach **`worker.env`** kopieren und ausfüllen:
```ini
ACM_BASE_URL=http://192.9.201.9
ODBC_SYNC_TOKEN=<dasselbe Geheimnis wie in der compute-.env der Plattform>
APOLLO_DSN=Apollo 64 Bit      # exakt der in 2.1 angelegte DSN-Name
APOLLO_UID=<leer lassen bei Variante B>
APOLLO_PWD=
APOLLO_MANDANT=1
```
Das `ODBC_SYNC_TOKEN` muss **identisch** mit `ODBC_SYNC_TOKEN` in der
`compute`-Umgebung der Plattform sein — sonst weist die API mit 403 ab.

### 2.5 Probelauf (ohne zu senden)
```powershell
py worker.py --art umsatz --dry-run   # schreibt _dryrun_AswKpf_RG.txt, sendet nicht
py worker.py --art umsatz             # sendet an die Plattform
# (bei 32-bit-Setup jeweils py -3-32 statt py)
```
Erscheint der Worker danach in **Einstellungen → Datenquelle → Worker** als
„online" mit einem Lauf für „umsatz", stimmt die Verbindung.

### 2.6 Als Dauerdienst einrichten
Der Dauerbetrieb (`--dienst`) holt sich Intervall und aktive Arten **von der
Plattform** und synct zyklisch. Zwei Wege, ihn am Leben zu halten:

**Aufgabenplanung (Task Scheduler), empfohlen fürs Erste**
- Aktion: Programm `py`, Argumente `C:\Pfad\odbc-worker\worker.py --dienst`
  (32-bit-Setup: `-3-32 C:\Pfad\odbc-worker\worker.py --dienst`),
  Start in `C:\Pfad\odbc-worker`.
- Trigger: „Bei Systemstart", Option „Neu starten, wenn die Aufgabe fehlschlägt".
- Konto: das lesende Dienstkonto, „Unabhängig von der Benutzeranmeldung
  ausführen".

**NSSM (echter Windows-Dienst)**
```powershell
nssm install ACM-ODBC-Worker "C:\...\python.exe" "C:\...\worker.py --dienst"
nssm set ACM-ODBC-Worker AppDirectory C:\...\odbc-worker
nssm start ACM-ODBC-Worker
```

Statt `--dienst` geht auch ein **einfacher Zeitplan** (Aufgabenplanung alle N
Minuten `worker.py --alle`); dann steuert der Zeitplan den Takt statt die
Plattform. `--dienst` ist aber der Sinn der Fernsteuerung.

---

## 3. Betrieb: Steuern und Überwachen über die Plattform

Alles unter **Einstellungen → Datenquelle** (nur Plattform-Verwaltung):

- **Umschalter Extrakte / ODBC.** Steht er auf ODBC, sind die manuellen Importe
  gesperrt (die Upload-Seite sagt das, die API weist mit 409 ab). Der Worker
  füllt dann dieselben Tabellen; die KPI-Berechnung bleibt unverändert.
- **Worker-Status.** Herzschlag (online/offline), Version, Host, letzter Fehler
  und je Art der letzte Lauf (Zeit, Zeilen, Dauer, Status). „Online" heißt:
  Herzschlag jünger als das Doppelte des Intervalls.
- **Sync-Intervall.** Wie oft der Worker einen vollen Lauf macht (5–1440 min).
- **Aktive Arten.** Welche Exporte gezogen werden — einzeln an/aus.
- **Jetzt synchronisieren.** Löst außer der Reihe einen Lauf aus; der Worker
  greift ihn beim nächsten Minuten-Poll auf und bestätigt über den Herzschlag.

Die VM muss dafür **nichts** entgegennehmen: Sie *holt* die Konfiguration
(`GET /konfig`) und *meldet* den Status (`POST /status`).

---

## 4. Arten und ihr Reifegrad

`worker.py` kennt dieselben 14 Arten wie die Upload-Seite. Elf sind verdrahtet,
drei haben noch offenes Mapping:

| Status | Arten |
|--------|-------|
| ✅ bestätigt | umsatz, auftraege, angebote, lagerpreise, acht_d |
| 🟡 lauffähig, gegen echten Extrakt prüfen | auftragspositionen, lieferscheine, wareneingaenge, materialpreise, lagerbewegungen, pruefungen |
| ⚠️ Mapping offen (Stub, liefert nichts) | kontakte, interessenten, liefertreue |

**Bevor eine 🟡-Art scharf geschaltet wird:** einen Worker-Lauf (`--dry-run`)
gegen einen am selben Zeitpunkt gezogenen echten Extrakt halten. Dafür gibt es
`worker_abgleich.py` (vergleicht zeilengenau je Geschäftsschlüssel; liest nur
Dateien, braucht kein ODBC):
```powershell
py worker.py --art wareneingaenge --dry-run    # erzeugt _dryrun_AswKpf_WE.txt (32-bit: py -3-32)
python worker_abgleich.py wareneingaenge ..\extrakte\AswKpf_WE.txt
```
Zeigt Schlüssel nur-im-Worker / nur-im-Extrakt und je Mengen-/Wert-/Datumsspalte
die Abweichungen. Stimmt es überein, die Art in „Aktive Arten" einschalten.
(Je Art einzeln dry-run + abgleichen — einige Arten teilen sich im Dry-Run
denselben Dateinamen.) Die drei ⚠️-Arten bleiben aus, bis ihr Mapping geklärt ist
(`..\MAPPING.md`); bis dahin kommen diese KPIs weiter aus den Extrakten (für
reinen ODBC-Betrieb sind sie noch nicht vollständig).

---

## 5. Sicherheit

- **Nur lesend** auf Apollo; kein Schreibzugriff, keine personenbezogenen Felder
  über das Nötige hinaus.
- Die VM kennt **keine** DB-Zugangsdaten der Plattform — nur das Shared-Secret
  `ODBC_SYNC_TOKEN` für HTTP. `compute` bleibt alleiniger Schreiber der Tabellen.
- `worker.env` und `apollo-cred.xml` nicht einchecken; Dateirechte auf das
  Dienstkonto beschränken (`icacls`). DPAPI (Variante B) bindet die Datei an das
  Konto.
- Kein eingehender Port; Firewall der VM darf alles eingehende blocken.
