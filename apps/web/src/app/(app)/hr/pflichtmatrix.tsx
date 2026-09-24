"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import { GELTUNGEN, positionNorm, type Geltung, type PflichtBasis } from "@/lib/pflicht";
import { Button } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";
import { Segmentwahl } from "./segmentwahl";
import { Blaettern, Matrixsuche, useMatrixseiten } from "./matrixseiten";

/**
 * Die Anforderungsmatrix — geteilt von Schulungen und Einweisungen.
 *
 * Eine Pflicht gilt für **alle**, eine **Abteilung**, eine **Position** oder
 * die **Kombination** beider. Die drei ersten Geltungen sind eine Kreuztabelle
 * (Zeile × Achsenwert, ein Häkchen je Zelle); die Kombination ist selten und
 * frei, deshalb steht sie als kleine Regelliste je Zeile. Ein Häkchen wirkt
 * sofort — wie im Altsystem, das hier keinen Bearbeitungsmodus kennt.
 *
 * Beide Fachbereiche reichen ihre Zeilen und ihre Pflicht-API herein; die
 * Matrix kennt nur `PflichtBasis` und die Kennung der Zeile.
 */

/** Eindeutig je Pflicht: Zeile + Geltung + Abteilung + normierte Position. */
function ident(
  zielId: string,
  geltung: Geltung,
  abteilung: string | null,
  positionNormWert: string | null,
): string {
  return `${zielId}|${geltung}|${abteilung ?? ""}|${positionNormWert ?? ""}`;
}

export interface PflichtmatrixApi<P extends PflichtBasis> {
  /** Namensraum der Achsen-Abfragen, damit sich Schulung und Einweisung nicht überschneiden. */
  bereich: string;
  pflichten: P[];
  pflichtKey: readonly unknown[];
  /** Die Kennung der Zeile, auf die sich eine Pflicht bezieht (Schulung bzw. Inhalt). */
  zielId: (p: P) => string;
  /** Ein optimistischer Pflicht-Eintrag für die sofortige Anzeige. */
  neuePflicht: (
    zielId: string,
    geltung: Geltung,
    abteilung: string | null,
    position: string | null,
  ) => P;
  achse: (feld: "abteilung" | "position", pflichten: P[]) => Promise<string[]>;
  setzen: (
    zielId: string,
    geltung: Geltung,
    ziel: { abteilung?: string | null; position?: string | null },
    an: boolean,
  ) => Promise<void>;
}

interface Zeilenzugriff<Z> {
  zeilen: Z[];
  id: (z: Z) => string;
  kopf: (z: Z) => ReactNode;
  titel: (z: Z) => string;
  suchwert: (z: Z) => string;
}

interface EingabeWunsch {
  zielId: string;
  geltung: Geltung;
  abteilung: string | null;
  position: string | null;
  an: boolean;
}

export function Pflichtmatrix<Z, P extends PflichtBasis>({
  api,
  zugriff,
  spaltenKopf,
  beschriftung,
  darfSchreiben,
}: {
  api: PflichtmatrixApi<P>;
  zugriff: Zeilenzugriff<Z>;
  spaltenKopf: string;
  beschriftung: string;
  darfSchreiben: boolean;
}) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [geltung, setGeltung] = useState<Geltung>("abteilung");

  const anzahl = api.pflichten.length;
  const brauchtAbteilung = geltung === "abteilung" || geltung === "abteilung_position";
  const brauchtPosition = geltung === "position" || geltung === "abteilung_position";
  const achseAbt = useQuery({
    queryKey: [api.bereich, "achse", "abteilung", anzahl],
    queryFn: () => api.achse("abteilung", api.pflichten),
    enabled: brauchtAbteilung,
  });
  const achsePos = useQuery({
    queryKey: [api.bereich, "achse", "position", anzahl],
    queryFn: () => api.achse("position", api.pflichten),
    enabled: brauchtPosition,
  });

  const gesetzt = useMemo(
    () =>
      new Set(
        api.pflichten.map((p) => ident(api.zielId(p), p.geltung, p.abteilung, p.position_norm)),
      ),
    [api],
  );

  const setzen = useMutation({
    mutationFn: (w: EingabeWunsch) =>
      api.setzen(w.zielId, w.geltung, { abteilung: w.abteilung, position: w.position }, w.an),
    onMutate: async (w) => {
      await queryClient.cancelQueries({ queryKey: api.pflichtKey });
      const vorher = queryClient.getQueryData<P[]>(api.pflichtKey);
      const ziel = ident(w.zielId, w.geltung, w.abteilung, w.position ? positionNorm(w.position) : null);
      queryClient.setQueryData<P[]>(api.pflichtKey, (alt = []) =>
        w.an
          ? [...alt, api.neuePflicht(w.zielId, w.geltung, w.abteilung, w.position)]
          : alt.filter(
              (p) => ident(api.zielId(p), p.geltung, p.abteilung, p.position_norm) !== ziel,
            ),
      );
      return { vorher };
    },
    onError: (fehler: Error, _w, kontext) => {
      if (kontext?.vorher) queryClient.setQueryData(api.pflichtKey, kontext.vorher);
      toast.error(fehler.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: api.pflichtKey }),
  });

  const seiten = useMatrixseiten(zugriff.zeilen, zugriff.suchwert);

  const hinweis: Record<Geltung, string> = {
    alle: worte.geltung.alleHinweis,
    abteilung: worte.geltung.abteilungHinweis,
    position: worte.geltung.positionHinweis,
    abteilung_position: worte.geltung.kombiHinweis,
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmentwahl
          wert={geltung}
          onChange={setGeltung}
          beschriftung={worte.geltung.titel}
          optionen={GELTUNGEN.map((g) => ({ wert: g, titel: worte.geltung[g] }))}
        />
        {seiten.zeigeSuche && (
          <Matrixsuche wert={seiten.suchtext} onChange={seiten.setSuchtext} beschriftung={beschriftung} />
        )}
      </div>
      <p className="max-w-prose text-sm text-[var(--fg-muted)]">{hinweis[geltung]}</p>

      {geltung === "abteilung_position" ? (
        <KombiListe
          api={api}
          zugriff={zugriff}
          seiten={seiten}
          abteilungen={achseAbt.data ?? []}
          positionen={achsePos.data ?? []}
          onSetzen={(w) => setzen.mutate(w)}
          darfSchreiben={darfSchreiben}
          beschriftung={beschriftung}
        />
      ) : (
        <Kreuztabelle
          zugriff={zugriff}
          seiten={seiten}
          spalten={
            geltung === "alle"
              ? [{ id: "alle", titel: worte.geltung.alleSpalte, abteilung: null, position: null }]
              : geltung === "abteilung"
                ? (achseAbt.data ?? []).map((a) => ({ id: a, titel: a, abteilung: a, position: null }))
                : (achsePos.data ?? []).map((p) => ({ id: p, titel: p, abteilung: null, position: p }))
          }
          spaltenKopf={spaltenKopf}
          gesetzt={gesetzt}
          zielIdent={(zielId, spalte) =>
            ident(
              zielId,
              geltung,
              spalte.abteilung,
              spalte.position ? positionNorm(spalte.position) : null,
            )
          }
          onSetzen={(zielId, spalte, an) =>
            setzen.mutate({
              zielId,
              geltung,
              abteilung: spalte.abteilung,
              position: spalte.position,
              an,
            })
          }
          darfSchreiben={darfSchreiben}
          beschriftung={beschriftung}
          leer={worte.geltung.matrixLeer}
        />
      )}
    </div>
  );
}

interface Spalte {
  id: string;
  titel: string;
  abteilung: string | null;
  position: string | null;
}

type Seiten<Z> = ReturnType<typeof useMatrixseiten<Z>>;

/** Kreuztabelle für „Alle“, „Abteilung“ und „Position“: ein Häkchen je Zelle. */
function Kreuztabelle<Z>({
  zugriff,
  seiten,
  spalten,
  spaltenKopf,
  gesetzt,
  zielIdent,
  onSetzen,
  darfSchreiben,
  beschriftung,
  leer,
}: {
  zugriff: Zeilenzugriff<Z>;
  seiten: Seiten<Z>;
  spalten: Spalte[];
  spaltenKopf: string;
  gesetzt: ReadonlySet<string>;
  zielIdent: (zielId: string, spalte: Spalte) => string;
  onSetzen: (zielId: string, spalte: Spalte, an: boolean) => void;
  darfSchreiben: boolean;
  beschriftung: string;
  leer: string;
}) {
  const worte = useTexte();
  if (spalten.length === 0) {
    return <p className="text-sm text-[var(--fg-muted)]">{leer}</p>;
  }
  return (
    <>
      <div className="max-h-[70vh] overflow-auto rounded-md border border-[var(--border)]">
        <table className="border-collapse text-sm" aria-label={beschriftung}>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky start-0 top-0 z-20 min-w-64 border-b border-e border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-start font-medium"
              >
                {spaltenKopf}
              </th>
              {spalten.map((s) => (
                <th
                  key={s.id}
                  scope="col"
                  title={s.titel}
                  className="sticky top-0 z-10 whitespace-nowrap border-b border-[var(--border)] bg-[var(--muted)] px-2 py-2 text-center text-xs font-medium"
                >
                  {s.titel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {seiten.fenster.zeilen.map((z) => {
              const zielId = zugriff.id(z);
              return (
                <tr key={zielId}>
                  <th
                    scope="row"
                    title={zugriff.titel(z)}
                    className="sticky start-0 z-10 max-w-96 truncate border-b border-e border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-start font-normal"
                  >
                    {zugriff.kopf(z)}
                  </th>
                  {spalten.map((s) => {
                    const an = gesetzt.has(zielIdent(zielId, s));
                    return (
                      <td key={s.id} className="border-b border-[var(--border)] px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={an}
                          disabled={!darfSchreiben}
                          aria-label={`${zugriff.titel(z)} – ${s.titel}`}
                          onChange={() => onSetzen(zielId, s, !an)}
                          className="h-4 w-4 cursor-pointer accent-[var(--ring)] disabled:cursor-default"
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {seiten.fenster.gesamt === 0 && (
              <tr>
                <td colSpan={spalten.length + 1} className="px-3 py-2 text-[var(--fg-muted)]">
                  {worte.tabelle.keineTreffer}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Blaettern fenster={seiten.fenster} onSeite={seiten.setSeite} beschriftung={beschriftung} />
    </>
  );
}

/** Regelliste je Zeile für die Kombination Abteilung + Position. */
function KombiListe<Z, P extends PflichtBasis>({
  api,
  zugriff,
  seiten,
  abteilungen,
  positionen,
  onSetzen,
  darfSchreiben,
  beschriftung,
}: {
  api: PflichtmatrixApi<P>;
  zugriff: Zeilenzugriff<Z>;
  seiten: Seiten<Z>;
  abteilungen: string[];
  positionen: string[];
  onSetzen: (w: EingabeWunsch) => void;
  darfSchreiben: boolean;
  beschriftung: string;
}) {
  const worte = useTexte();
  const kombis = useMemo(() => {
    const nach = new Map<string, P[]>();
    for (const p of api.pflichten) {
      if (p.geltung !== "abteilung_position") continue;
      const id = api.zielId(p);
      (nach.get(id) ?? nach.set(id, []).get(id)!).push(p);
    }
    return nach;
  }, [api]);

  return (
    <>
      <div className="max-h-[70vh] divide-y divide-[var(--border)] overflow-auto rounded-md border border-[var(--border)]">
        {seiten.fenster.zeilen.map((z) => (
          <KombiZeile
            key={zugriff.id(z)}
            kopf={zugriff.kopf(z)}
            regeln={kombis.get(zugriff.id(z)) ?? []}
            abteilungen={abteilungen}
            positionen={positionen}
            onHinzufuegen={(abteilung, position) =>
              onSetzen({ zielId: zugriff.id(z), geltung: "abteilung_position", abteilung, position, an: true })
            }
            onEntfernen={(abteilung, position) =>
              onSetzen({ zielId: zugriff.id(z), geltung: "abteilung_position", abteilung, position, an: false })
            }
            darfSchreiben={darfSchreiben}
          />
        ))}
        {seiten.fenster.gesamt === 0 && (
          <p className="px-3 py-2 text-sm text-[var(--fg-muted)]">{worte.tabelle.keineTreffer}</p>
        )}
      </div>
      <Blaettern fenster={seiten.fenster} onSeite={seiten.setSeite} beschriftung={beschriftung} />
    </>
  );
}

function KombiZeile<P extends PflichtBasis>({
  kopf,
  regeln,
  abteilungen,
  positionen,
  onHinzufuegen,
  onEntfernen,
  darfSchreiben,
}: {
  kopf: ReactNode;
  regeln: P[];
  abteilungen: string[];
  positionen: string[];
  onHinzufuegen: (abteilung: string, position: string) => void;
  onEntfernen: (abteilung: string, position: string) => void;
  darfSchreiben: boolean;
}) {
  const worte = useTexte();
  const [abt, setAbt] = useState("");
  const [pos, setPos] = useState("");
  const auswahl =
    "h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm";

  const hinzufuegen = useCallback(() => {
    if (!abt || !pos) return;
    onHinzufuegen(abt, pos);
    setAbt("");
    setPos("");
  }, [abt, pos, onHinzufuegen]);

  return (
    <div className="space-y-2 bg-[var(--surface)] px-3 py-2.5">
      <div className="font-medium">{kopf}</div>
      <div className="flex flex-wrap gap-1.5">
        {regeln.length === 0 && (
          <span className="text-sm text-[var(--fg-muted)]">{worte.geltung.keineRegeln}</span>
        )}
        {regeln.map((r) => (
          <span
            key={`${r.abteilung}|${r.position_norm}`}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)] py-0.5 ps-2.5 pe-1 text-xs"
          >
            {r.abteilung} · {r.position}
            {darfSchreiben && (
              <button
                type="button"
                aria-label={worte.geltung.regelEntfernen}
                title={worte.geltung.regelEntfernen}
                onClick={() => onEntfernen(r.abteilung ?? "", r.position ?? "")}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--fg-muted)] hover:text-[var(--fg)]"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
      </div>
      {darfSchreiben &&
        (abteilungen.length === 0 || positionen.length === 0 ? (
          <p className="text-xs text-[var(--fg-muted)]">{worte.geltung.matrixLeer}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={auswahl}
              aria-label={worte.geltung.abteilungWaehlen}
              value={abt}
              onChange={(e) => setAbt(e.target.value)}
            >
              <option value="">{worte.geltung.abteilungWaehlen}</option>
              {abteilungen.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className={auswahl}
              aria-label={worte.geltung.positionWaehlen}
              value={pos}
              onChange={(e) => setPos(e.target.value)}
            >
              <option value="">{worte.geltung.positionWaehlen}</option>
              {positionen.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" disabled={!abt || !pos} onClick={hinzufuegen}>
              <Plus className="me-1 h-3.5 w-3.5" aria-hidden />
              {worte.geltung.regelHinzufuegen}
            </Button>
          </div>
        ))}
    </div>
  );
}
