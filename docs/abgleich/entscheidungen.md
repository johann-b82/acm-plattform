# Technische Entscheidungen im Systemvergleich

Entscheidungen, die bei der Umsetzung selbst getroffen wurden — innerhalb der Nutzervorgaben, mit Begründung. Nutzerentscheidungen stehen in der Übergabe; hier steht nur, was dort offen war oder der Referenz widerspricht.

## E-01 Vergleichszeiträume folgen dem Kalender (KPI-05, VER-02, PRO-01)

**Referenz:** Die Vertriebskacheln des Altsystems vergleichen „Dieser Monat“ bis zum 12. mit dem Vormonat vom 1. bis 12. (`frontend/src/lib/prevBounds.ts`), das Vorjahr kalendergleich. Einkauf, Produktion und Finanzen rechnen im Backend dagegen „gleich lang, endet am Tag davor“ (am 12. September: 20.–31. August) — bei gleicher Beschriftung „vs. August“.

**Entscheidung:** Alle Kacheln vergleichen nach Kalender: Monat mit Vormonat bis zum selben Tag, Quartal mit Vorquartal bis zum selben Abstand, Jahr nur mit dem Vorjahr, freier Zeitraum mit dem gleich langen Zeitraum davor, Vorjahr immer kalendergleich.

**Begründung:** Die Nutzerentscheidung KPI-05 verlangt die Beschriftung „zum August“; sie muss dem tatsächlich gerechneten Zeitraum entsprechen. Ein Fenster 20.–31. August ist nicht „der August“. Die Vertriebsseite der Referenz rechnet bereits so, und dort hat der Nutzer die Abweichung VER-02 beanstandet.

**Auswirkung:** Vertrieb stimmt mit der Referenz überein. In Einkauf, Produktion und Finanzen weichen Vorperiodenprozente von der Referenz ab, weil die Referenz dort ein anderes Fenster rechnet; das ist beabsichtigt und im Paritätsbericht je Kachel belegt.

**Bewusste Abweichungen vom Altsystem:** Am Monatsende bleibt das Vormonatsfenster im Vormonat (dort lief `addDays(1. Februar, 30)` in den März). Der 29. Februar wird im Vorjahr zum 28.

## E-02 Veränderung der Verzugsquote wird an der Quote gemessen (PRO-01)

**Referenz:** `ProductionVerzugCardGrid.tsx` rechnet die Veränderung der Verzugsquote im Komplement (1 − Quote), damit ein Rückgang grün wird. Aus 82,4 % gegen 93,4 % wird so „+164,7 %“.

**Entscheidung:** Die Veränderung ist die relative Änderung der Quote selbst. Die Farbe kommt aus der fachlichen Richtung (weniger ist besser), nicht aus einer umgerechneten Zahl.

**Begründung:** KPI-06 trennt Pfeilrichtung (numerisch) und Farbe (fachlich). Eine Komplement-Veränderung zeigt nach oben, obwohl die Quote gesunken ist, und ihre Größe hat mit der angezeigten Quote nichts zu tun.

## E-03 „Alles“ ist wirklich alles (PRF-01)

**Referenz:** Einkauf, Produktion, Finanzen und die Findings-Liste fallen bei „Gesamter Zeitraum“ auf den laufenden Kalendermonat zurück (`_month_bounds(today)` in `routers/procurement_kpis.py`, `production_kpis.py`, `finance_kpis.py`, `quality_kpis.py`), während die Von/Bis-Felder leer bleiben.

**Entscheidung:** Nicht nachgebaut. „Alles“ rechnet über den ganzen Bestand. Die Personalkostenquote braucht einen Zeitraum, weil Monatsgehälter anteilig über Tage verteilt werden; dort bleibt „Alles“ ohne Wert mit Hinweis.

## E-04 Zentrale Seitengröße gilt für alle Personen (TAB-01)

Die Einstellungsseite gehört der Plattform-Verwaltung; persönliche Einstellungen gibt es in der Plattform nicht. Die Seitengröße steht deshalb systemweit in `plattform_einstellungen` und wirkt für alle.
