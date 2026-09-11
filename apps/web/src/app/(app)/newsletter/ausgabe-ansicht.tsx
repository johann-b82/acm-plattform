"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { packeRaster } from "@/lib/newsletter/puzzle";
import { KATEGORIE_LABEL, VERTEILUNG_LABEL } from "@/lib/kpi/personal";
import type {
  Ausgabe,
  Bild,
  Kapitel,
  KpiStand,
  Neuzugang,
} from "@/lib/newsletter";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Eine Ausgabe als Folge von A4-Seiten.
 *
 * Jede Seite trägt `data-seite`; daran hängt der PDF-Export, der genau diese
 * Knoten einzeln setzt. Deshalb steht hier alles in festen Maßen und nicht in
 * Bildschirmeinheiten: was am Bildschirm eine Seite ist, ist im PDF eine.
 *
 * Markdown wird ohne rohes HTML gerendert (react-markdown lässt es
 * standardmäßig weg, und dabei bleibt es).
 */

const DATUM = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" });

function Seite({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-seite
      // 210 × 297 mm im Verhältnis; die Breite gibt der Behälter vor.
      className={`relative mx-auto w-full max-w-[210mm] overflow-hidden bg-white text-neutral-900 shadow-sm ${className}`}
      style={{ aspectRatio: "210 / 297" }}
    >
      {children}
    </div>
  );
}

function Deckblatt({ ausgabe, bildUrl }: { ausgabe: Ausgabe; bildUrl?: string }) {
  return (
    <Seite className="flex flex-col justify-end">
      {bildUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bildUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-500" />
      )}
      <div className="relative bg-gradient-to-t from-black/70 to-transparent p-[12mm] text-white">
        <p className="text-sm uppercase tracking-[0.2em] opacity-90">
          Quartal {ausgabe.quartal} · {ausgabe.jahr}
        </p>
        <h2 className="mt-2 text-4xl font-semibold leading-tight">
          {ausgabe.titel || "Newsletter"}
        </h2>
      </div>
    </Seite>
  );
}

function Rueckseite({ bildUrl }: { bildUrl?: string }) {
  return (
    <Seite>
      {bildUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bildUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-gradient-to-tr from-neutral-800 to-neutral-500" />
      )}
    </Seite>
  );
}

function Bilderraster({
  bilder,
  urls,
}: {
  bilder: Bild[];
  urls: Record<string, string>;
}) {
  const { platz, zeilen } = useMemo(
    () => packeRaster(bilder.map((b) => ({ spalten: b.spalten, zeilen: b.zeilen }))),
    [bilder],
  );
  if (!bilder.length) return null;
  return (
    <div
      className="mt-4 grid gap-2"
      style={{
        gridTemplateColumns: "repeat(4, 1fr)",
        gridTemplateRows: `repeat(${zeilen}, 1fr)`,
        aspectRatio: `4 / ${zeilen}`,
      }}
    >
      {bilder.map((bild, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={bild.id}
          src={urls[bild.pfad]}
          alt=""
          className="h-full w-full rounded object-cover"
          style={{
            gridColumn: `${platz[i].spalteVon} / span ${platz[i].spalten}`,
            gridRow: `${platz[i].zeileVon} / span ${platz[i].zeilen}`,
          }}
        />
      ))}
    </div>
  );
}

function KpiSeite({ titel, stand }: { titel: string; stand: KpiStand }) {
  const kacheln = [
    { label: "Beschäftigte", wert: stand.gesamt },
    { label: "davon neu im Quartal", wert: stand.neu },
    { label: "im Bestand", wert: stand.bestand },
  ];
  // Verteilungen kommen als flache Liste mit `art` als Gruppe.
  const gruppen = new Map<string, { kategorie: string; anzahl: number }[]>();
  for (const z of stand.verteilung ?? []) {
    const liste = gruppen.get(z.art) ?? [];
    liste.push({ kategorie: z.kategorie, anzahl: z.anzahl });
    gruppen.set(z.art, liste);
  }

  return (
    <Seite className="p-[15mm]">
      <h2 className="text-2xl font-semibold">{titel}</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Stand {stand.stichtag ? DATUM.format(new Date(stand.stichtag)) : "—"}
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {kacheln.map((k) => (
          <div key={k.label} className="rounded-lg bg-neutral-100 p-4">
            <p className="text-3xl font-semibold tabular-nums">{k.wert}</p>
            <p className="mt-1 text-xs text-neutral-600">{k.label}</p>
          </div>
        ))}
      </div>

      {[...gruppen].map(([art, zeilen]) => {
        const summe = zeilen.reduce((s, z) => s + z.anzahl, 0) || 1;
        return (
          <div key={art} className="mt-6">
            <h3 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
              {VERTEILUNG_LABEL[art] ?? art}
            </h3>
            <ul className="mt-2 space-y-1.5">
              {zeilen.map((z) => (
                <li key={z.kategorie} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 truncate">
                    {KATEGORIE_LABEL[z.kategorie] ?? z.kategorie}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200">
                    <span
                      className="block h-full rounded-full bg-neutral-700"
                      style={{ width: `${(z.anzahl / summe) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-end tabular-nums">{z.anzahl}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </Seite>
  );
}

function NeuzugangsSeite({
  titel,
  leute,
}: {
  titel: string;
  leute: Neuzugang[];
}) {
  const worte = useTexte();
  return (
    <Seite className="p-[15mm]">
      <h2 className="text-2xl font-semibold">{titel}</h2>
      {leute.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          {worte.newsletter.niemandDazu}
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3">
          {leute.map((p, i) => (
            <li key={i} className="rounded-lg bg-neutral-100 p-4">
              <p className="font-medium">
                {[p.vorname, p.nachname].filter(Boolean).join(" ")}
              </p>
              <p className="mt-0.5 text-sm text-neutral-600">{p.abteilung || "—"}</p>
              {p.hire_date && (
                <p className="mt-1 text-xs text-neutral-500">
                  seit {DATUM.format(new Date(p.hire_date))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Seite>
  );
}

function KapitelSeite({
  kapitel,
  urls,
}: {
  kapitel: Kapitel;
  urls: Record<string, string>;
}) {
  return (
    <Seite className="p-[15mm]">
      <h2 className="text-2xl font-semibold">{kapitel.titel}</h2>
      <div className="mt-6 space-y-8">
        {kapitel.newsletter_eintrag.map((e) => (
          <article key={e.id}>
            {e.untertitel && (
              <h3 className="text-lg font-medium">{e.untertitel}</h3>
            )}
            {e.inhalt_md && (
              <div className="prose-newsletter mt-2 text-sm leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.inhalt_md}</ReactMarkdown>
              </div>
            )}
            <Bilderraster bilder={e.newsletter_bild} urls={urls} />
          </article>
        ))}
      </div>
    </Seite>
  );
}

/** Die Seiten einer Ausgabe. Leere Kapitel fallen heraus — ein Kapitel ohne
 *  Inhalt wäre im PDF eine leere Seite. */
export function AusgabeAnsicht({
  ausgabe,
  kapitel,
  urls,
}: {
  ausgabe: Ausgabe;
  kapitel: Kapitel[];
  urls: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      <Deckblatt
        ausgabe={ausgabe}
        bildUrl={ausgabe.titelbild ? urls[ausgabe.titelbild] : undefined}
      />
      {kapitel.map((k) => {
        if (k.art === "kpi") {
          return k.stand ? (
            <KpiSeite key={k.id} titel={k.titel} stand={k.stand as KpiStand} />
          ) : null;
        }
        if (k.art === "neuzugaenge") {
          return k.stand ? (
            <NeuzugangsSeite key={k.id} titel={k.titel} leute={k.stand as Neuzugang[]} />
          ) : null;
        }
        return k.newsletter_eintrag.length ? (
          <KapitelSeite key={k.id} kapitel={k} urls={urls} />
        ) : null;
      })}
      <Rueckseite bildUrl={ausgabe.rueckseite ? urls[ausgabe.rueckseite] : undefined} />
    </div>
  );
}
