import type { Metadata } from "next";
import { cookies } from "next/headers";

import { COOKIE, spracheAus, type Sprache } from "@/lib/sprache";
import { texteFuer, type Texte } from "@/texte";

/**
 * Die gewählte Sprache dieser Anfrage. Nur auf dem Server — `cookies()` macht
 * die Seite dynamisch, und das ist sie hier ohnehin: jede Seite hinter der
 * Anmeldung liest die Sitzung aus Cookies.
 */
export async function sprache(): Promise<Sprache> {
  return spracheAus((await cookies()).get(COOKIE)?.value);
}

/** Die Texte dieser Anfrage. */
export async function texte() {
  return texteFuer(await sprache());
}

/**
 * Der Titel im Browser-Tab, in der Sprache der Anfrage und mit dem
 * konfigurierten App-Namen (SET-06).
 *
 * `generateMetadata` statt `metadata`, weil der Titel von einem Cookie abhängt
 * (Sprache) und vom App-Namen — beides eine Konstante wäre beim Bauen
 * festgeschrieben.
 */
export async function seitentitel(waehle: (t: Texte) => string): Promise<Metadata> {
  const { ladeErscheinung } = await import("@/lib/erscheinung-server");
  const { appName } = await ladeErscheinung();
  return { title: `${waehle(await texte())} · ${appName}` };
}
