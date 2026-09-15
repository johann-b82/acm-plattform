import { supabaseBrowser } from "@/lib/supabase/client";
import { KonfliktFehler, leereAntwort } from "@/lib/realtime";

/**
 * Speichern und Löschen mit der geladenen Version (ADR-0006).
 *
 * Die Bedingung `version = <geladen>` geht mit jedem Schreiben mit. Trifft sie
 * keine Zeile, wird nachgelesen, warum: war jemand schneller, gibt es einen
 * `KonfliktFehler` — die Oberfläche sagt es und lädt den aktuellen Stand. Die
 * Version selbst schickt die Oberfläche nie als Wert; die Datenbank zählt sie.
 */

async function deuteLeer(tabelle: string, id: string, version: number) {
  const { data, error } = await supabaseBrowser()
    .from(tabelle)
    .select("version")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return leereAntwort((data as { version: number } | null) ?? null, version);
}

/** Speichert die Felder, wenn die Zeile noch die geladene Version hat, und
 *  gibt die neue Version zurück. */
export async function speichereVersioniert(
  tabelle: string,
  id: string,
  version: number,
  felder: object,
): Promise<number> {
  const werte: Record<string, unknown> = { ...felder };
  delete werte.version;
  const { data, error } = await supabaseBrowser()
    .from(tabelle)
    .update(werte)
    .eq("id", id)
    .eq("version", version)
    .select("id,version");
  if (error) throw new Error(error.message);
  if (data?.length) return (data[0] as { version: number }).version;

  const grund = await deuteLeer(tabelle, id, version);
  if (grund === "recht") throw new Error("Nicht gespeichert — fehlt das Recht?");
  throw new KonfliktFehler(grund);
}

/** Hält an, wenn jemand anders die Zeile seit dem Laden geändert hat — für
 *  alles, was vor dem eigentlichen Löschen geschieht und sich nicht
 *  zurücknehmen lässt (Dateien im Speicher). Ist die Zeile schon weg, geht es
 *  weiter: dann hat jemand anders dasselbe Ziel schon erreicht. */
export async function pruefeVersion(tabelle: string, id: string, version: number): Promise<void> {
  const grund = await deuteLeer(tabelle, id, version);
  if (grund === "konflikt") throw new KonfliktFehler(grund);
}

/** Löscht die Zeile, wenn sie noch die geladene Version hat. Ist sie schon
 *  weg, ist das Ziel erreicht — kein Fehler. */
export async function loescheVersioniert(tabelle: string, id: string, version: number): Promise<void> {
  const { data, error } = await supabaseBrowser()
    .from(tabelle)
    .delete()
    .eq("id", id)
    .eq("version", version)
    .select("id,version");
  if (error) throw new Error(error.message);
  if (data?.length) return;

  const grund = await deuteLeer(tabelle, id, version);
  if (grund === "geloescht") return;
  if (grund === "recht") throw new Error("Nicht gelöscht — fehlt das Recht?");
  throw new KonfliktFehler(grund);
}
