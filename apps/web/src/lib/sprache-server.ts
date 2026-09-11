import { cookies } from "next/headers";

import { COOKIE, spracheAus, type Sprache } from "@/lib/sprache";
import { texteFuer } from "@/texte";

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
