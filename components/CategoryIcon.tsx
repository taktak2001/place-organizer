import {
  Bath,
  BedDouble,
  Coffee,
  Hospital,
  MapPin,
  MoreHorizontal,
  Palette,
  Shirt,
  Sparkles,
  Utensils,
  Waves,
  type LucideIcon
} from "lucide-react";
import { categoryConfigFromMain, type CategoryIconKey } from "@/lib/categories/config";

type Props = {
  category?: unknown;
  iconKey?: CategoryIconKey | string | null;
  size?: number;
  className?: string;
  decorative?: boolean;
};

const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  coffee: Coffee,
  palette: Palette,
  shirt: Shirt,
  bed: BedDouble,
  bath: Bath,
  waves: Waves,
  hospital: Hospital,
  "map-pin": MapPin,
  sparkles: Sparkles,
  "more-horizontal": MoreHorizontal
};

export function CategoryIcon({ category, iconKey, size = 20, className = "text-ink", decorative = true }: Props) {
  const resolvedKey = iconKey ?? categoryConfigFromMain(category)?.iconKey ?? "more-horizontal";
  const Icon = ICONS[String(resolvedKey)] ?? MoreHorizontal;
  return (
    <Icon
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : "img"}
      className={className}
      size={size}
      strokeWidth={1.9}
    />
  );
}
