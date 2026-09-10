/**
 * Bilderraster: packt Bilder mit Zellenspanne (spalten × zeilen) dicht in ein
 * vierspaltiges Raster und liefert die Platzierung samt benötigter Zeilenzahl.
 *
 * Damit rendert ein CSS-Grid mit quadratischen Zellen. Wichtig ist, dass die
 * Anordnung deterministisch ist: das PDF entsteht aus der gerenderten Ansicht,
 * und ein Raster, das bei jedem Rendern anders fällt, ergäbe ein anderes PDF
 * als die Seite davor.
 *
 * Aus `lumeapps` übernommen (`frontend/src/lib/puzzle.ts`), unverändert im
 * Verhalten.
 */
export interface RasterTeil {
  spalten: number;
  zeilen: number;
}

export interface RasterPlatz {
  spalteVon: number;
  zeileVon: number;
  spalten: number;
  zeilen: number;
}

export function packeRaster(
  teile: RasterTeil[],
  spaltenGesamt = 4,
): { platz: RasterPlatz[]; zeilen: number } {
  const belegt: boolean[][] = [];
  const sorgeFuer = (zeile: number) => {
    while (belegt.length <= zeile) {
      belegt.push(new Array<boolean>(spaltenGesamt).fill(false));
    }
  };

  const platz: RasterPlatz[] = [];
  for (const teil of teile) {
    const breite = Math.max(1, Math.min(spaltenGesamt, teil.spalten));
    const hoehe = Math.max(1, teil.zeilen);
    let gesetzt = false;
    for (let z = 0; !gesetzt; z++) {
      sorgeFuer(z + hoehe - 1);
      for (let s = 0; s + breite <= spaltenGesamt && !gesetzt; s++) {
        let frei = true;
        for (let zz = z; zz < z + hoehe && frei; zz++) {
          for (let ss = s; ss < s + breite && frei; ss++) {
            if (belegt[zz][ss]) frei = false;
          }
        }
        if (frei) {
          for (let zz = z; zz < z + hoehe; zz++) {
            for (let ss = s; ss < s + breite; ss++) belegt[zz][ss] = true;
          }
          platz.push({ spalteVon: s + 1, zeileVon: z + 1, spalten: breite, zeilen: hoehe });
          gesetzt = true;
        }
      }
    }
  }
  return { platz, zeilen: belegt.length };
}
