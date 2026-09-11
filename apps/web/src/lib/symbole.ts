import {
  Award,
  Boxes,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Euro,
  Factory,
  FileText,
  GraduationCap,
  LayoutGrid,
  MessageSquareText,
  Network,
  Newspaper,
  Ruler,
  ScrollText,
  Settings,
  ShieldCheck,
  Thermometer,
  TrendingUp,
  Truck,
  Upload,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Ein Sinnbild je Kachel.
 *
 * Geschlüsselt nach Adresse, nicht nach App-Kennung: dieselbe Tabelle dient
 * dem Starter und den Übersichtsseiten, und die Unterseiten haben gar keine
 * Kennung. Wofür nichts dasteht, bekommt das neutrale Raster — eine neue
 * Seite soll nicht ohne Bild dastehen.
 */
const SYMBOLE: Record<string, LucideIcon> = {
  "/atr": Boxes,
  "/einstellungen": Settings,
  "/fair": Ruler,
  "/hr": Users,
  "/hr/dokumente": FileText,
  "/hr/einarbeitung": ClipboardList,
  "/hr/kennzahlen": ChartColumn,
  "/hr/kompetenzen": Award,
  "/hr/onboarding": UserPlus,
  "/hr/organigramm": Network,
  "/hr/schulungen": GraduationCap,
  "/hr/zeugnisse": ScrollText,
  "/kpi": ChartColumn,
  "/kpi/bewertung": MessageSquareText,
  "/kpi/einkauf": Truck,
  "/kpi/finanzen": Euro,
  "/kpi/produktion": Factory,
  "/kpi/qualitaet": ClipboardCheck,
  "/kpi/vertrieb": TrendingUp,
  "/newsletter": Newspaper,
  "/platform": ShieldCheck,
  "/produktion": Factory,
  "/qualitaet": ClipboardCheck,
  "/sensoren": Thermometer,
  "/uploads": Upload,
};

export function symbol(pfad: string): LucideIcon {
  return SYMBOLE[pfad] ?? LayoutGrid;
}
