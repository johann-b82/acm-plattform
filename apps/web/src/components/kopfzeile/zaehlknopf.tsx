import Link from "next/link";

import { KNOPF } from "@/components/kopfzeile/knopf";
import { badgeText } from "@/lib/kopfzeile";

/**
 * Ein Zeichen in der Kopfzeile mit einer Zahl daran.
 *
 * Die Zahl steht nur da, wenn es etwas zu sehen gibt. `dringend` färbt sie
 * rot — die Farbe sagt „überfällig“, die Zahl sagt „wie viele“; die
 * Beschriftung sagt beides noch einmal in Worten, denn Farbe allein ist keine
 * Auskunft für jeden.
 */
export function Zaehlknopf({
  href,
  beschriftung,
  anzahl,
  dringend = false,
  children,
}: {
  href: string;
  beschriftung: string;
  anzahl: number;
  dringend?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={beschriftung}
      title={beschriftung}
      className={`relative ${KNOPF}`}
    >
      {children}
      {anzahl > 0 && (
        <span
          aria-hidden
          className={`absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums ${
            dringend
              ? "bg-[var(--danger)] text-white"
              : "bg-[var(--fg)] text-[var(--surface)]"
          }`}
        >
          {badgeText(anzahl)}
        </span>
      )}
    </Link>
  );
}
