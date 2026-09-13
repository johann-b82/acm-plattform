/**
 * Zwei Initialen aus der Anmeldeadresse — das Token trägt keinen Namen.
 *
 * „vorname.nachname@…“ ergibt die Anfänge beider Teile, ein einteiliger Name
 * die ersten zwei Buchstaben. Ziffern zählen nicht; ohne Buchstaben ein „?“.
 */
export function initialen(email: string | null | undefined): string {
  const lokal = (email ?? "").split("@")[0] ?? "";
  const teile = lokal
    .split(/[._\-+\s]+/)
    .map((teil) => teil.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  if (teile.length === 0) return "?";
  // Erster und letzter Teil: aus „anna-lena_berg“ wird AB, nicht AL.
  const zeichen =
    teile.length >= 2 ? [teile[0][0], teile[teile.length - 1][0]] : Array.from(teile[0]).slice(0, 2);
  return zeichen.join("").toLocaleUpperCase("de");
}
