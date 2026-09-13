/**
 * Eine Abfrage vollständig laden, auch über die Seitengrenze von PostgREST.
 *
 * PostgREST gibt je Anfrage höchstens 1000 Zeilen heraus (`max-rows`). Wer
 * einmal fragt, bekommt eine still abgeschnittene Menge — und eine Tabelle, die
 * „1–25 von 1000“ sagt, obwohl es mehr gibt (TAB-01, UPL-02).
 *
 * Deshalb Seite für Seite über `.range(von, bis)`, bis eine Seite leer bleibt.
 * Eine kurze Seite ist kein Ende: liefert der Server weniger als erbeten, weil
 * sein Maximum kleiner ist, ginge sonst der Rest verloren. Weiter geht es ab
 * der Zahl der tatsächlich erhaltenen Zeilen. Die Abfrage muss eindeutig
 * sortiert sein, sonst verschieben sich Zeilen zwischen den Seiten.
 */
export async function ladeAlle<T>(
  holen: (von: number, bis: number) => Promise<T[]>,
  seite = 1000,
): Promise<T[]> {
  const alle: T[] = [];
  for (;;) {
    const zeilen = await holen(alle.length, alle.length + seite - 1);
    if (zeilen.length === 0) return alle;
    alle.push(...zeilen);
  }
}
