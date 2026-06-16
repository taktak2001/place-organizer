export const CATEGORY_CONFIGS = [
  {
    slug: "restaurant",
    main_category: "Restaurant",
    labelJa: "レストラン",
    iconKey: "utensils",
    href: "/category/restaurant",
    sortOrder: 10
  },
  {
    slug: "cafe",
    main_category: "Cafe",
    labelJa: "カフェ",
    iconKey: "coffee",
    href: "/category/cafe",
    sortOrder: 20
  },
  {
    slug: "art",
    main_category: "Art",
    labelJa: "アート",
    iconKey: "palette",
    href: "/category/art",
    sortOrder: 30
  },
  {
    slug: "fashion",
    main_category: "Fashion",
    labelJa: "ファッション",
    iconKey: "shirt",
    href: "/category/fashion",
    sortOrder: 40
  },
  {
    slug: "hotel",
    main_category: "Hotel",
    labelJa: "ホテル",
    iconKey: "bed",
    href: "/category/hotel",
    sortOrder: 50
  },
  {
    slug: "bath",
    main_category: "Bath",
    labelJa: "風呂・サウナ",
    iconKey: "waves",
    href: "/category/bath",
    sortOrder: 60
  },
  {
    slug: "hospital",
    main_category: "Hospital",
    labelJa: "病院",
    iconKey: "hospital",
    href: "/category/hospital",
    sortOrder: 70
  },
  {
    slug: "life",
    main_category: "Life",
    labelJa: "ライフ",
    iconKey: "map-pin",
    href: "/category/life",
    sortOrder: 80
  },
  {
    slug: "other",
    main_category: "Other",
    labelJa: "その他",
    iconKey: "more-horizontal",
    href: "/category/other",
    sortOrder: 90
  }
] as const;

export type CategoryConfig = typeof CATEGORY_CONFIGS[number];
export type CategorySlug = CategoryConfig["slug"];
export type MainCategory = CategoryConfig["main_category"];
export type CategoryIconKey = CategoryConfig["iconKey"] | "bath" | "sparkles";

export const PRIMARY_CATEGORY_CONFIGS = CATEGORY_CONFIGS.filter((category) =>
  ["restaurant", "cafe", "art", "fashion", "hotel", "bath"].includes(category.slug)
);

export const CATEGORY_BY_SLUG = Object.fromEntries(CATEGORY_CONFIGS.map((category) => [category.slug, category])) as Record<CategorySlug, CategoryConfig>;
export const CATEGORY_BY_MAIN = Object.fromEntries(CATEGORY_CONFIGS.map((category) => [category.main_category, category])) as Record<MainCategory, CategoryConfig>;

export function categoryConfigFromSlug(slug: string) {
  return CATEGORY_CONFIGS.find((category) => category.slug === slug) ?? null;
}

export function categoryConfigFromMain(category: unknown) {
  const key = String(category ?? "");
  return CATEGORY_CONFIGS.find((config) => config.main_category === key) ?? null;
}
