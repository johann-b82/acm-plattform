"use server";

import { cookies } from "next/headers";

import { COOKIE, COOKIE_MAXALTER, spracheAus } from "@/lib/sprache";

/**
 * Merkt die Sprachwahl im Cookie.
 *
 * `spracheAus` prüft den Wert: was von außen kommt, landet nicht ungeprüft im
 * Cookie, auch wenn hier nur ein Kürzel steht. `httpOnly` ist bewusst aus —
 * die Wahl ist kein Geheimnis, und der Browser darf sie lesen.
 */
export async function setzeSprache(wert: string): Promise<void> {
  (await cookies()).set(COOKIE, spracheAus(wert), {
    maxAge: COOKIE_MAXALTER,
    sameSite: "lax",
    path: "/",
  });
}
