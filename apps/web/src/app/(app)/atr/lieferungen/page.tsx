import { redirect } from "next/navigation";

/** Die Lieferungen sind seit ATR-10 der Einstieg unter `/atr`; alte Verweise
 *  und Lesezeichen kommen dort an. Die Detailseiten bleiben hier darunter. */
export default function LieferungenPage() {
  redirect("/atr");
}
