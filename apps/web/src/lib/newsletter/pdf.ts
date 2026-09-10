/**
 * Newsletter als mehrseitiges PDF, deckungsgleich zur Leseransicht.
 *
 * Der übergebene Knoten enthält je Seite ein Element mit `data-seite`. Jedes
 * davon wird einzeln zu einem JPEG gerendert und als eigene A4-Seite gesetzt —
 * so beginnt jedes Kapitel auf einer neuen Seite, statt mittendurch
 * geschnitten zu werden. Ein Block, der höher als eine Seite ist, läuft auf
 * Folgeseiten über.
 *
 * JPEG statt PNG ist bewusst: jsPDF legt PNGs praktisch unkomprimiert ab.
 * Im Altprojekt ergab das bei neun Seiten in doppelter Auflösung ein PDF von
 * über 200 MB — groß genug, um den Tab-Speicher zu sprengen und den Download
 * stumm scheitern zu lassen. Jede Seite hat einen deckenden Hintergrund, also
 * ist JPEG hier verlustarm genug.
 *
 * Gemessen dauert eine A4-Seite in doppelter Auflösung rund sechs Sekunden;
 * fünf Seiten sind eine halbe Minute. Deshalb der Rückruf `fortschritt`: eine
 * halbe Minute ohne Rückmeldung sieht aus wie ein Fehler.
 *
 * Aus `lumeapps` übernommen (`frontend/src/lib/newsletterPdf.ts`).
 */
const A4_BREITE = 210;
const A4_HOEHE = 297;

export async function alsPdf(
  knoten: HTMLElement,
  dateiname: string,
  fortschritt?: (seite: number, gesamt: number) => void,
): Promise<void> {
  const [{ toJpeg }, { jsPDF }] = await Promise.all([
    import("html-to-image"),
    import("jspdf"),
  ]);

  const seiten = Array.from(knoten.querySelectorAll<HTMLElement>("[data-seite]"));
  const zuSetzen = seiten.length ? seiten : [knoten];

  const pdf = new jsPDF({ unit: "mm", format: [A4_BREITE, A4_HOEHE] });
  const breite = pdf.internal.pageSize.getWidth();
  const hoehe = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < zuSetzen.length; i++) {
    fortschritt?.(i + 1, zuSetzen.length);
    const datenUrl = await toJpeg(zuSetzen[i], {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      quality: 0.92,
      skipFonts: true,
    });
    const bild = new Image();
    bild.src = datenUrl;
    await bild.decode();
    const bildHoehe = bild.height * (breite / bild.width);

    if (i > 0) pdf.addPage();

    // Passt auf eine Seite (kleine Toleranz gegen Rundung).
    if (bildHoehe <= hoehe + 1) {
      pdf.addImage(datenUrl, "JPEG", 0, 0, breite, bildHoehe);
      continue;
    }
    // Höher als A4: über Folgeseiten verteilen.
    let rest = bildHoehe;
    let oben = 0;
    pdf.addImage(datenUrl, "JPEG", 0, oben, breite, bildHoehe);
    rest -= hoehe;
    while (rest > 0) {
      oben -= hoehe;
      pdf.addPage();
      pdf.addImage(datenUrl, "JPEG", 0, oben, breite, bildHoehe);
      rest -= hoehe;
    }
  }

  pdf.save(dateiname);
}
