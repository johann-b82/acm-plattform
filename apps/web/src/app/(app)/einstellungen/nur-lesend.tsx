import { Card } from "@/components/ui/primitives";

/**
 * Ein Abschnitt, den man sehen, aber nicht ändern darf.
 *
 * Die Seite zeigt jeder Person, was für ihre Apps eingestellt ist — auch wenn
 * sie es nicht ändern darf. Wer nichts anfassen kann, soll wenigstens wissen,
 * womit gerechnet wird, und woran es liegt.
 */
export function NurLesend({ recht }: { recht: string }) {
  return (
    <Card className="p-4 text-sm text-[var(--fg-muted)]">
      Ansehen ja, ändern nein — dafür braucht es das Recht {`„${recht}“`}.
    </Card>
  );
}
