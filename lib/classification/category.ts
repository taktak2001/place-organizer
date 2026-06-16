import type { NormalizedImportItem, PlaceClassification } from "@/types/import";
import { classifyRegion } from "./region";

const CATEGORY_RULES: Array<{ category: string; pattern: RegExp; reason: string }> = [
  { category: "Art", pattern: /art|art_gallery|museum|gallery|white cube|perrotin|taka ishii|美術館|博物館|ギャラリー|アート|芸術|財団|foundation/i, reason: "art keyword" },
  { category: "Cafe", pattern: /cafe|coffee|coffee_shop|bakery|dessert_shop|ice_cream_shop|confectionery|gelato|ice cream|patisserie|カフェ|喫茶|珈琲|ベーカリー|パティスリー|ジェラート/i, reason: "cafe keyword" },
  { category: "Restaurant", pattern: /restaurant|bar|meal_takeaway|food|bistro|sushi|ramen|レストラン|ビストロ|寿司|鮨|ラーメン|蕎麦|焼肉|居酒屋|食堂|定食|カレー|イタリアン|フレンチ|中華/i, reason: "restaurant keyword" },
  { category: "Fashion", pattern: /fashion|clothing|clothing_store|shoe_store|jewelry_store|department_store|vintage|select shop|kith|靴|時計|古着|服|アパレル|セレクトショップ/i, reason: "fashion keyword" },
  { category: "Hotel", pattern: /hotel|lodging|旅館|ホテル|inn|ryokan/i, reason: "hotel keyword" },
  { category: "Bath", pattern: /銭湯|サウナ|温泉|bath|sauna|spa|public_bath|hot_spring|風呂/i, reason: "bath keyword" },
  { category: "Hospital", pattern: /hospital|clinic|doctor|dentist|病院|クリニック|歯科|医院/i, reason: "hospital keyword" },
  { category: "Life", pattern: /transit_station|train_station|bus_stop|airport|book_store|bookstore|library/i, reason: "life type" }
];

export function classifyPlace(item: NormalizedImportItem): PlaceClassification {
  const googleText = googleClassificationText(item.raw);
  const text = [item.source_list_name, item.name, item.address, item.google_maps_url, googleText].filter(Boolean).join(" ");
  const source = item.source_list_name ?? "";
  let main = "Other";
  let reason = "fallback";
  let confidence = 0.45;

  const sourceCategory = classifyFromSourceList(source);
  if (sourceCategory) {
    main = sourceCategory;
    reason = "source list";
    confidence = 0.92;
  }

  if (!sourceCategory) {
    for (const rule of CATEGORY_RULES) {
      if (rule.pattern.test(source) || rule.pattern.test(text)) {
        main = rule.category;
        reason = rule.reason;
        confidence = rule.pattern.test(source) ? 0.9 : 0.72;
        break;
      }
    }
  }

  const artSub = main === "Art" ? classifyArtSubCategory(text) : null;
  const sceneTags = main === "Restaurant" ? classifyRestaurantScenes(text) : [];
  const region = classifyRegion(item);

  return {
    main_category: main,
    sub_category: artSub,
    scene_tags: sceneTags,
    ...region,
    priority: null,
    visited_status: source.includes("行ってみたい") || /want to go/i.test(source) ? "want" : "unknown",
    confidence,
    reason
  };
}

function classifyFromSourceList(source: string) {
  if (/^art$|museum|美術|ギャラリー/i.test(source)) return "Art";
  if (/^fashion$/i.test(source)) return "Fashion";
  if (/^cafe$/i.test(source)) return "Cafe";
  if (/^restaurant$/i.test(source)) return "Restaurant";
  if (/風呂|bath|sauna|spa/i.test(source)) return "Bath";
  if (/^hotel$/i.test(source)) return "Hotel";
  if (/hospital|病院|クリニック|歯科/i.test(source)) return "Hospital";
  return null;
}

function googleClassificationText(raw: Record<string, unknown>) {
  const google = raw.google;
  if (!google || typeof google !== "object") return "";
  const googleRecord = google as Record<string, unknown>;
  const record = typeof googleRecord.candidate_place === "object" && googleRecord.candidate_place !== null
    ? googleRecord.candidate_place as Record<string, unknown>
    : googleRecord;
  return [
    record.primaryType,
    Array.isArray(record.types) ? record.types.join(" ") : null,
    typeof record.displayName === "object" && record.displayName !== null ? (record.displayName as Record<string, unknown>).text : null,
    record.formattedAddress
  ].filter(Boolean).join(" ");
}

function classifyArtSubCategory(text: string) {
  if (/美術館|museum/i.test(text)) return "Museum";
  if (/ギャラリー|gallery/i.test(text)) return "Gallery";
  if (/アートセンター|art center/i.test(text)) return "Art Center";
  if (/建築|architecture/i.test(text)) return "Architecture";
  if (/shop|ストア|ショップ|書店/i.test(text)) return "Art Shop";
  if (/public art|屋外|彫刻/i.test(text)) return "Public Art";
  if (/財団|foundation/i.test(text)) return "Foundation";
  if (/archive|library|資料館|図書館|アーカイブ/i.test(text)) return "Archive / Library";
  return "Other Art";
}

function classifyRestaurantScenes(text: string) {
  const tags = new Set<string>();
  if (/ラーメン|カレー|蕎麦|定食|食堂/i.test(text)) {
    tags.add("Solo");
    tags.add("Casual");
  }
  if (/ビストロ|イタリアン|フレンチ|ワインバー|wine/i.test(text)) tags.add("Date");
  if (/個室|会席|鮨|高級|コース|割烹/i.test(text)) {
    tags.add("Business");
    tags.add("High-end");
  }
  if (/居酒屋|焼肉|大衆|バル|酒場/i.test(text)) {
    tags.add("Group");
    tags.add("Casual");
  }
  if (/観光|名物|旅|local/i.test(text)) {
    tags.add("Travel");
    tags.add("Local");
  }
  return [...tags];
}
