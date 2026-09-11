"""Die festen Begriffe des Zeugnismoduls.

Sie stehen im Code und nicht in der Datenbank: es sind keine Einstellungen,
sondern die Struktur des Dokuments. Wer eine Dimension ergänzt, ergänzt auch
Bausteine und Reihenfolge — das ist eine Änderung, keine Pflege.
"""

#: Bewertungsdimensionen; die Reihenfolge ist die Reihenfolge im Zeugnis.
#: `fuehrung` nur bei Führungskräften.
DIMENSIONEN = (
    "fachwissen",
    "auffassungsgabe",
    "arbeitsweise",
    "belastbarkeit",
    "arbeitserfolg",
    "sozialverhalten",
    "fuehrung",
)

ARTEN = (
    "qualifiziert",
    "einfach",
    "zwischenzeugnis",
    "ausbildungszeugnis",
    "praktikumszeugnis",
)

#: Die erzeugten Abschnitte — die Schlüssel im Feld `abschnitte`.
ABSCHNITTE = (
    "einleitung",
    "taetigkeitsbeschreibung",
    "leistungsbeurteilung",
    "sozialverhalten",
    "schlussformel",
)
