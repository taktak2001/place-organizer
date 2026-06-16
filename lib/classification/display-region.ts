export type DisplayRegionGroup = "Tokyo" | "Japan" | "Overseas" | "Unknown";

export type DisplayRegionInput = {
  country?: string | null;
  prefecture?: string | null;
  city?: string | null;
  ward?: string | null;
  area_label?: string | null;
  travel_region?: string | null;
  address?: string | null;
  raw_google_summary?: Record<string, unknown> | null;
};

export type DisplayRegion = {
  region_group: DisplayRegionGroup;
  region_filter_label: string;
  region_sort_order: number;
};

export const TOKYO_REGION_LABELS = [
  "渋谷",
  "表参道・青山",
  "中目黒・代官山・恵比寿",
  "六本木・麻布",
  "銀座・丸の内・日本橋",
  "清澄白河",
  "上野・谷中",
  "新宿",
  "池袋",
  "吉祥寺・中央線",
  "目黒・白金",
  "その他東京"
] as const;

export const JAPAN_REGION_LABELS = [
  "京都",
  "大阪",
  "名古屋",
  "金沢",
  "軽井沢",
  "箱根",
  "直島・瀬戸内",
  "福岡",
  "神奈川",
  "千葉",
  "埼玉",
  "北海道",
  "東北",
  "その他日本"
] as const;

export const OVERSEAS_REGION_LABELS = [
  "Paris",
  "Seoul",
  "New York",
  "Brooklyn",
  "Los Angeles",
  "London",
  "Copenhagen",
  "Milan",
  "Firenze",
  "Arles",
  "Taipei",
  "Hong Kong",
  "Bangkok",
  "Singapore",
  "その他海外"
] as const;

export const REGION_FILTER_SECTIONS = [
  { group: "Tokyo", title: "東京", labels: TOKYO_REGION_LABELS },
  { group: "Japan", title: "日本", labels: JAPAN_REGION_LABELS },
  { group: "Overseas", title: "海外", labels: OVERSEAS_REGION_LABELS }
] as const;

const TOKYO_MAJOR_AREAS = [
  "渋谷", "表参道", "青山", "中目黒", "代官山", "恵比寿", "六本木", "麻布", "銀座", "丸の内", "日本橋",
  "京橋", "日比谷", "清澄白河", "上野", "谷中", "新宿", "池袋", "吉祥寺", "中央線", "目黒", "白金", "原宿"
];

export function classifyDisplayRegion(input: DisplayRegionInput): DisplayRegion {
  const text = normalizedText(input);
  if (!text.trim()) return unknownRegion();

  const tokyoLabel = tokyoRegionLabel(text, input);
  if (tokyoLabel) return region("Tokyo", tokyoLabel);

  const japanLabel = japanRegionLabel(text, input);
  if (japanLabel) return region("Japan", japanLabel);

  const overseasLabel = overseasRegionLabel(text, input);
  if (overseasLabel) return region("Overseas", overseasLabel);

  if (isJapan(input, text)) return region("Japan", "その他日本");
  if (isOverseas(input, text)) return region("Overseas", "その他海外");
  return unknownRegion();
}

function tokyoRegionLabel(text: string, input: DisplayRegionInput) {
  const isTokyo = /東京|東京都|tokyo/i.test(text) ||
    input.prefecture === "東京都" ||
    input.travel_region === "東京" ||
    TOKYO_MAJOR_AREAS.some((area) => String(input.area_label ?? "").includes(area));
  if (!isTokyo) return null;

  if (/渋谷|原宿|神宮前/i.test(text)) return "渋谷";
  if (/表参道|青山|外苑前/i.test(text)) return "表参道・青山";
  if (/中目黒|代官山|恵比寿|広尾/i.test(text)) return "中目黒・代官山・恵比寿";
  if (/六本木|麻布|乃木坂|赤坂|神谷町/i.test(text)) return "六本木・麻布";
  if (/銀座|丸の内|日本橋|京橋|日比谷|有楽町|八重洲|大手町/i.test(text)) return "銀座・丸の内・日本橋";
  if (/清澄白河|清澄|白河|森下/i.test(text)) return "清澄白河";
  if (/上野|谷中|根津|千駄木|御徒町/i.test(text)) return "上野・谷中";
  if (/新宿|四谷|代々木/i.test(text)) return "新宿";
  if (/池袋/i.test(text)) return "池袋";
  if (/吉祥寺|三鷹|西荻|荻窪|阿佐ヶ谷|高円寺|中野|中央線/i.test(text)) return "吉祥寺・中央線";
  if (/目黒|白金|白金台|五反田/i.test(text)) return "目黒・白金";
  return "その他東京";
}

function japanRegionLabel(text: string, input: DisplayRegionInput) {
  if (!isJapan(input, text)) return null;
  if (/京都|京都府|kyoto/i.test(text)) return "京都";
  if (/大阪|大阪府|osaka/i.test(text)) return "大阪";
  if (/名古屋|愛知|nagoya/i.test(text)) return "名古屋";
  if (/金沢|石川|kanazawa/i.test(text)) return "金沢";
  if (/軽井沢|karuizawa/i.test(text)) return "軽井沢";
  if (/箱根|hakone/i.test(text)) return "箱根";
  if (/直島|瀬戸内|豊島|犬島|naoshima|setouchi/i.test(text)) return "直島・瀬戸内";
  if (/福岡|fukuoka/i.test(text)) return "福岡";
  if (/神奈川|横浜|鎌倉|湘南|川崎|kanagawa|yokohama|kamakura/i.test(text)) return "神奈川";
  if (/千葉|chiba/i.test(text)) return "千葉";
  if (/埼玉|saitama/i.test(text)) return "埼玉";
  if (/北海道|札幌|hokkaido|sapporo/i.test(text)) return "北海道";
  if (/青森|岩手|宮城|秋田|山形|福島|仙台|tohoku|sendai/i.test(text)) return "東北";
  return "その他日本";
}

function overseasRegionLabel(text: string, input: DisplayRegionInput) {
  if (!isOverseas(input, text)) return null;
  if (/brooklyn/i.test(text)) return "Brooklyn";
  if (/new york|nyc|manhattan/i.test(text)) return "New York";
  if (/paris|パリ/i.test(text)) return "Paris";
  if (/seoul|ソウル/i.test(text)) return "Seoul";
  if (/los angeles|la\b/i.test(text)) return "Los Angeles";
  if (/london|ロンドン/i.test(text)) return "London";
  if (/copenhagen|コペンハーゲン/i.test(text)) return "Copenhagen";
  if (/milan|milano|ミラノ/i.test(text)) return "Milan";
  if (/firenze|florence|フィレンツェ/i.test(text)) return "Firenze";
  if (/arles|アルル/i.test(text)) return "Arles";
  if (/taipei|台北/i.test(text)) return "Taipei";
  if (/hong kong|香港/i.test(text)) return "Hong Kong";
  if (/bangkok|バンコク/i.test(text)) return "Bangkok";
  if (/singapore|シンガポール/i.test(text)) return "Singapore";
  return "その他海外";
}

function isJapan(input: DisplayRegionInput, text: string) {
  const country = String(input.country ?? "").trim();
  return country === "日本" || /日本|〒|東京都|京都府|大阪府|愛知県|石川県|神奈川県|千葉県|埼玉県|北海道|福岡県|香川県|長野県|静岡県|茨城県/.test(text);
}

function isOverseas(input: DisplayRegionInput, text: string) {
  const country = String(input.country ?? "").trim();
  if (country && country !== "日本" && country !== "Unknown" && country !== "未分類") return true;
  return /paris|france|seoul|korea|new york|brooklyn|los angeles|london|united kingdom|copenhagen|denmark|milan|milano|firenze|florence|italy|arles|taipei|taiwan|hong kong|bangkok|thailand|singapore|switzerland|zurich|berlin|germany/i.test(text);
}

function region(group: DisplayRegionGroup, label: string): DisplayRegion {
  return {
    region_group: group,
    region_filter_label: label,
    region_sort_order: sortOrder(group, label)
  };
}

function unknownRegion(): DisplayRegion {
  return {
    region_group: "Unknown",
    region_filter_label: "未分類",
    region_sort_order: 9999
  };
}

function sortOrder(group: DisplayRegionGroup, label: string) {
  const groupBase: Record<DisplayRegionGroup, number> = {
    Tokyo: 100,
    Japan: 200,
    Overseas: 300,
    Unknown: 900
  };
  const labels = group === "Tokyo" ? TOKYO_REGION_LABELS : group === "Japan" ? JAPAN_REGION_LABELS : group === "Overseas" ? OVERSEAS_REGION_LABELS : ["未分類"];
  const index = labels.findIndex((item) => item === label);
  return groupBase[group] + (index === -1 ? 99 : index);
}

function normalizedText(input: DisplayRegionInput) {
  const raw = input.raw_google_summary ?? {};
  return [
    input.country,
    input.prefecture,
    input.city,
    input.ward,
    input.area_label,
    input.travel_region,
    input.address,
    raw.formattedAddress,
    raw.formatted_address,
    raw.address,
    raw.name,
    displayName(raw)
  ].filter(Boolean).join(" ").normalize("NFKC");
}

function displayName(raw: Record<string, unknown>) {
  const display = raw.displayName;
  if (typeof display === "object" && display !== null) return (display as Record<string, unknown>).text;
  return null;
}
