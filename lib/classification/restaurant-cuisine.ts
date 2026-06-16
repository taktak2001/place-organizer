export const RESTAURANT_CUISINE_TAGS = [
  "Italian",
  "French",
  "Japanese",
  "Sushi",
  "Soba / Udon",
  "Ramen",
  "Yakiniku",
  "Yakitori",
  "Izakaya",
  "Bistro",
  "Wine Bar",
  "Chinese",
  "Korean",
  "Thai",
  "Vietnamese",
  "Curry",
  "Pizza",
  "Burger",
  "Cafe / Dessert",
  "Seafood",
  "Steak",
  "Other"
] as const;

export type RestaurantCuisineTag = typeof RESTAURANT_CUISINE_TAGS[number];

export type RestaurantCuisineInput = {
  name: string;
  source_list_names: string[];
  address: string | null;
  primary_type: string | null;
  types: string[];
  website_url: string | null;
  raw_google_summary?: Record<string, unknown> | null;
};

export type RestaurantCuisineResult = {
  category_tags: RestaurantCuisineTag[];
  confidence: number;
  reason: string;
  source: "rule";
};

const CUISINE_TAG_SET = new Set<string>(RESTAURANT_CUISINE_TAGS);

const RULES: Array<{ tag: RestaurantCuisineTag; pattern: RegExp; reason: string }> = [
  { tag: "Pizza", pattern: /pizza|pizzeria|ピザ/i, reason: "pizza keyword" },
  { tag: "Sushi", pattern: /sushi|鮨|寿司/i, reason: "sushi keyword" },
  { tag: "Ramen", pattern: /ramen|ラーメン|中華そば/i, reason: "ramen keyword" },
  { tag: "Soba / Udon", pattern: /soba|udon|蕎麦|そば|うどん/i, reason: "soba/udon keyword" },
  { tag: "Yakiniku", pattern: /yakiniku|焼肉|ホルモン/i, reason: "yakiniku keyword" },
  { tag: "Yakitori", pattern: /yakitori|焼鳥|焼き鳥|鳥料理/i, reason: "yakitori keyword" },
  { tag: "Izakaya", pattern: /izakaya|居酒屋|酒場|大衆酒場/i, reason: "izakaya keyword" },
  { tag: "Wine Bar", pattern: /wine\s?bar|ワインバー|vin|vino/i, reason: "wine bar keyword" },
  { tag: "Bistro", pattern: /bistro|ビストロ/i, reason: "bistro keyword" },
  { tag: "Italian", pattern: /italian|trattoria|osteria|ristorante|イタリアン|イタリア料理/i, reason: "italian keyword" },
  { tag: "French", pattern: /french|français|francaise|フレンチ|フランス料理|brasserie/i, reason: "french keyword" },
  { tag: "Chinese", pattern: /chinese|中華|中国料理|餃子|四川|上海料理/i, reason: "chinese keyword" },
  { tag: "Korean", pattern: /korean|韓国|韓国料理|焼肉韓国|サムギョプサル/i, reason: "korean keyword" },
  { tag: "Thai", pattern: /thai|タイ料理|タイレストラン/i, reason: "thai keyword" },
  { tag: "Vietnamese", pattern: /vietnamese|ベトナム|フォー\b|pho\b/i, reason: "vietnamese keyword" },
  { tag: "Curry", pattern: /curry|カレー|スパイス/i, reason: "curry keyword" },
  { tag: "Burger", pattern: /burger|hamburger|ハンバーガー|バーガー/i, reason: "burger keyword" },
  { tag: "Cafe / Dessert", pattern: /cafe|coffee|dessert|bakery|patisserie|gelato|ice cream|喫茶|カフェ|珈琲|ベーカリー|パティスリー|ジェラート|スイーツ/i, reason: "cafe/dessert keyword" },
  { tag: "Seafood", pattern: /seafood|oyster|魚介|海鮮|鮮魚|牡蠣|寿司割烹/i, reason: "seafood keyword" },
  { tag: "Steak", pattern: /steak|ステーキ|鉄板焼/i, reason: "steak keyword" },
  { tag: "Japanese", pattern: /japanese|和食|日本料理|割烹|会席|懐石|定食|食堂|天ぷら|おでん|うなぎ|鰻/i, reason: "japanese keyword" }
];

const TYPE_RULES: Array<{ tag: RestaurantCuisineTag; types: string[]; reason: string }> = [
  { tag: "Cafe / Dessert", types: ["bakery", "dessert_shop", "ice_cream_shop", "confectionery", "cafe", "coffee_shop"], reason: "google cafe/dessert type" },
  { tag: "Izakaya", types: ["japanese_izakaya_restaurant"], reason: "google izakaya type" },
  { tag: "Sushi", types: ["sushi_restaurant"], reason: "google sushi type" },
  { tag: "Ramen", types: ["ramen_restaurant"], reason: "google ramen type" },
  { tag: "Chinese", types: ["chinese_restaurant"], reason: "google chinese type" },
  { tag: "Korean", types: ["korean_restaurant"], reason: "google korean type" },
  { tag: "Thai", types: ["thai_restaurant"], reason: "google thai type" },
  { tag: "Vietnamese", types: ["vietnamese_restaurant"], reason: "google vietnamese type" },
  { tag: "Pizza", types: ["pizza_restaurant"], reason: "google pizza type" },
  { tag: "Seafood", types: ["seafood_restaurant"], reason: "google seafood type" },
  { tag: "Steak", types: ["steak_house"], reason: "google steak type" }
];

export function classifyRestaurantCuisineByRule(input: RestaurantCuisineInput): RestaurantCuisineResult {
  const text = cuisineText(input);
  const tags = new Set<RestaurantCuisineTag>();
  const reasons: string[] = [];
  const typeValues = [input.primary_type, ...input.types].map((type) => String(type ?? "").trim()).filter(Boolean);

  for (const rule of TYPE_RULES) {
    if (rule.types.some((type) => typeValues.includes(type))) {
      tags.add(rule.tag);
      reasons.push(rule.reason);
    }
  }

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      tags.add(rule.tag);
      reasons.push(rule.reason);
    }
  }

  if (tags.size === 0 && typeValues.some((type) => /restaurant|bar|food|meal_takeaway/i.test(type))) {
    tags.add("Other");
    reasons.push("restaurant type fallback");
  }

  return {
    category_tags: [...tags],
    confidence: tags.size > 0 && !tags.has("Other") ? 0.78 : tags.size > 0 ? 0.55 : 0.3,
    reason: [...new Set(reasons)].join(", ") || "no cuisine rule matched",
    source: "rule"
  };
}

export function normalizeCuisineTags(value: unknown): RestaurantCuisineTag[] {
  const values = Array.isArray(value) ? value : [];
  const tags = values.map((item) => {
    const text = String(item ?? "").trim();
    return RESTAURANT_CUISINE_TAGS.find((tag) => tag.toLowerCase() === text.toLowerCase()) ?? null;
  }).filter((item): item is RestaurantCuisineTag => item !== null && CUISINE_TAG_SET.has(item));
  return [...new Set(tags)];
}

function cuisineText(input: RestaurantCuisineInput) {
  const raw = input.raw_google_summary ?? {};
  return [
    input.name,
    input.source_list_names.join(" "),
    input.address,
    input.primary_type,
    input.types.join(" "),
    input.website_url,
    displayName(raw),
    raw.formattedAddress,
    Array.isArray(raw.types) ? raw.types.join(" ") : null,
    raw.primaryType,
    raw.primary_type
  ].filter(Boolean).join(" ");
}

function displayName(raw: Record<string, unknown>) {
  const display = raw.displayName;
  if (typeof display === "object" && display !== null) return (display as Record<string, unknown>).text;
  return raw.name;
}
