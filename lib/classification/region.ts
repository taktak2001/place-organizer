import type { NormalizedImportItem } from "@/types/import";

const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県"
];

const TOKYO_AREAS = ["六本木", "表参道", "青山", "銀座", "京橋", "日本橋", "丸の内", "日比谷", "上野", "清澄白河", "中目黒", "代官山", "恵比寿", "渋谷", "新宿", "原宿", "神保町", "白金", "天王洲", "駒込", "馬喰町"];
const TRAVEL_REGIONS = ["箱根", "軽井沢", "熱海", "京都", "金沢", "前橋", "北杜", "直島", "瀬戸内", "Paris", "Arles", "Seoul", "New York", "Brooklyn", "Los Angeles", "London", "Zurich", "Switzerland", "Taipei", "Taiwan", "Hong Kong", "Copenhagen", "Helsinki", "Berlin", "Milan", "Venice"];
const MAJOR_CITY_REGIONS: Array<{ city: string; region: string }> = [
  { city: "京都市", region: "京都" },
  { city: "名古屋市", region: "名古屋" },
  { city: "北茨城市", region: "北茨城" },
  { city: "金沢市", region: "金沢" },
  { city: "前橋市", region: "前橋" },
  { city: "北杜市", region: "北杜" }
];
const OVERSEAS_REGION_RULES: Array<{ region: string; country: string; pattern: RegExp; area?: string }> = [
  { region: "Paris", country: "France", pattern: /paris|パリ/i, area: "Paris" },
  { region: "Arles", country: "France", pattern: /arles|アルル/i, area: "Arles" },
  { region: "Seoul", country: "South Korea", pattern: /seoul|서울|ソウル/i, area: "Seoul" },
  { region: "Brooklyn", country: "United States", pattern: /brooklyn|ブルックリン/i, area: "Brooklyn" },
  { region: "New York", country: "United States", pattern: /new york|nyc|manhattan|ニューヨーク|マンハッタン/i, area: "New York" },
  { region: "Los Angeles", country: "United States", pattern: /los angeles|la\b|ロサンゼルス/i, area: "Los Angeles" },
  { region: "London", country: "United Kingdom", pattern: /london|ロンドン/i, area: "London" },
  { region: "Zurich", country: "Switzerland", pattern: /zurich|zürich|チューリッヒ/i, area: "Zurich" },
  { region: "Switzerland", country: "Switzerland", pattern: /switzerland|suisse|schweiz|スイス/i },
  { region: "Taipei", country: "Taiwan", pattern: /taipei|台北/i, area: "Taipei" },
  { region: "Taiwan", country: "Taiwan", pattern: /taiwan|台湾/i },
  { region: "Hong Kong", country: "Hong Kong", pattern: /hong kong|香港/i, area: "Hong Kong" },
  { region: "Copenhagen", country: "Denmark", pattern: /copenhagen|københavn|コペンハーゲン/i, area: "Copenhagen" },
  { region: "Helsinki", country: "Finland", pattern: /helsinki|ヘルシンキ/i, area: "Helsinki" },
  { region: "Berlin", country: "Germany", pattern: /berlin|ベルリン/i, area: "Berlin" },
  { region: "Firenze", country: "Italy", pattern: /firenze|florence|フィレンツェ/i, area: "Firenze" },
  { region: "Milan", country: "Italy", pattern: /milan|milano|ミラノ/i, area: "Milan" },
  { region: "Venice", country: "Italy", pattern: /venice|venezia|ベネチア|ヴェネツィア/i, area: "Venice" }
];
const COORDINATE_REGIONS: Array<{ region: string; country: string; area: string; lat: [number, number]; lng: [number, number] }> = [
  { region: "Paris", country: "France", area: "Paris", lat: [48.8, 48.92], lng: [2.2, 2.48] },
  { region: "Arles", country: "France", area: "Arles", lat: [43.6, 43.75], lng: [4.55, 4.75] },
  { region: "Seoul", country: "South Korea", area: "Seoul", lat: [37.45, 37.7], lng: [126.8, 127.15] },
  { region: "Brooklyn", country: "United States", area: "Brooklyn", lat: [40.55, 40.75], lng: [-74.05, -73.85] },
  { region: "New York", country: "United States", area: "New York", lat: [40.68, 40.9], lng: [-74.05, -73.85] },
  { region: "Los Angeles", country: "United States", area: "Los Angeles", lat: [33.85, 34.2], lng: [-118.55, -118.15] },
  { region: "London", country: "United Kingdom", area: "London", lat: [51.35, 51.65], lng: [-0.35, 0.1] },
  { region: "Zurich", country: "Switzerland", area: "Zurich", lat: [47.3, 47.45], lng: [8.45, 8.65] },
  { region: "Taipei", country: "Taiwan", area: "Taipei", lat: [24.95, 25.15], lng: [121.45, 121.65] },
  { region: "Hong Kong", country: "Hong Kong", area: "Hong Kong", lat: [22.2, 22.4], lng: [113.9, 114.3] },
  { region: "Copenhagen", country: "Denmark", area: "Copenhagen", lat: [55.6, 55.75], lng: [12.45, 12.7] },
  { region: "Helsinki", country: "Finland", area: "Helsinki", lat: [60.1, 60.25], lng: [24.8, 25.1] },
  { region: "Berlin", country: "Germany", area: "Berlin", lat: [52.4, 52.6], lng: [13.25, 13.55] },
  { region: "Firenze", country: "Italy", area: "Firenze", lat: [43.72, 43.82], lng: [11.18, 11.34] },
  { region: "Milan", country: "Italy", area: "Milan", lat: [45.4, 45.55], lng: [9.05, 9.3] },
  { region: "Venice", country: "Italy", area: "Venice", lat: [45.35, 45.5], lng: [12.25, 12.45] }
];

export function classifyRegion(item: NormalizedImportItem) {
  const text = [item.name, item.address, item.source_list_name, googleRegionText(item.raw)].filter(Boolean).join(" ");
  const prefecture = PREFECTURES.find((pref) => text.includes(pref)) ?? null;
  const ward = inferWard(text, prefecture);
  const city = inferCity(text, prefecture);
  const overseasRule = OVERSEAS_REGION_RULES.find((rule) => rule.pattern.test(text));
  const coordinateRegion = inferCoordinateRegion(item.latitude, item.longitude);
  const domesticRegion = inferTravelRegion(prefecture, city, text, item.latitude, item.longitude);
  const travelRegion = domesticRegion ?? overseasRule?.region ?? coordinateRegion?.region ?? TRAVEL_REGIONS.find((region) => new RegExp(region, "i").test(text)) ?? null;
  const areaLabel = inferDomesticAreaLabel(text, prefecture, city, ward) ?? overseasRule?.area ?? coordinateRegion?.area ?? null;

  return {
    country: inferCountry(text, prefecture, item.latitude, item.longitude, overseasRule?.country ?? coordinateRegion?.country ?? null),
    prefecture,
    city,
    ward,
    area_label: areaLabel,
    nearest_station: inferStation(text),
    travel_region: travelRegion
  };
}

function inferCountry(text: string, prefecture: string | null, lat: number | null, lng: number | null, overseasCountry: string | null) {
  if (overseasCountry) return overseasCountry;
  if (/Paris|Arles|France/i.test(text)) return "France";
  if (/United States|USA|New York|Brooklyn|Los Angeles/i.test(text)) return "United States";
  if (/United Kingdom|London/i.test(text)) return "United Kingdom";
  if (/Switzerland|Zurich|Zürich/i.test(text)) return "Switzerland";
  if (/Taiwan|Taipei/i.test(text)) return "Taiwan";
  if (/Hong Kong/i.test(text)) return "Hong Kong";
  if (/Denmark|Copenhagen/i.test(text)) return "Denmark";
  if (/Finland|Helsinki/i.test(text)) return "Finland";
  if (/Germany|Berlin/i.test(text)) return "Germany";
  if (/Italy|Milan|Milano|Venice|Venezia/i.test(text)) return "Italy";
  if (/Firenze|Florence/i.test(text)) return "Italy";
  if (/South Korea|Seoul/i.test(text)) return "South Korea";
  if (prefecture) return "Japan";
  if (lat !== null && lng !== null && lat > 20 && lat < 46 && lng > 122 && lng < 154) return "Japan";
  return null;
}

function inferTravelRegion(prefecture: string | null, city: string | null, text: string, lat: number | null, lng: number | null) {
  if (/箱根/.test(text) || inBounds(lat, lng, [35.16, 35.3], [138.95, 139.15])) return "箱根";
  if (/軽井沢/.test(text) || inBounds(lat, lng, [36.25, 36.4], [138.5, 138.7])) return "軽井沢";
  if (/熱海/.test(text) || inBounds(lat, lng, [35.05, 35.15], [139.0, 139.15])) return "熱海";
  if (/直島/.test(text) || inBounds(lat, lng, [34.42, 34.48], [133.96, 134.02])) return "直島";
  if (/瀬戸内/.test(text)) return "瀬戸内";
  if (/北杜/.test(text) || inBounds(lat, lng, [35.7, 36.05], [138.15, 138.55])) return "北杜";
  if (/北茨城/.test(text) || city === "北茨城市") return "北茨城";
  if (/名古屋/.test(text) || city === "名古屋市") return "名古屋";
  if (TOKYO_AREAS.some((area) => text.includes(area))) return "東京";
  if (prefecture === "東京都") return "東京";
  const majorCity = MAJOR_CITY_REGIONS.find((item) => item.city === city);
  if (majorCity) return majorCity.region;
  if (prefecture === "京都府" || city === "京都市") return "京都";
  if (prefecture === "石川県" && /金沢/.test(text)) return "金沢";
  if (prefecture === "群馬県" && /前橋/.test(text)) return "前橋";
  if (city) return city.replace(/市$/, "");
  return prefecture ? prefecture.replace(/[都道府県]$/, "") : null;
}

function inferStation(text: string) {
  const match = text.match(/([^,\s]{1,12}駅)/);
  return match?.[1] ?? null;
}

function inferDomesticAreaLabel(text: string, prefecture: string | null, city: string | null, ward: string | null) {
  const tokyoArea = TOKYO_AREAS.find((area) => text.includes(area));
  if (prefecture === "東京都" && tokyoArea) return tokyoArea;
  if (!prefecture && tokyoArea) return tokyoArea;
  const parisArea = text.match(/Paris\s*(\d{1,2}e)/i)?.[0];
  if (parisArea) return parisArea.replace(/\s+/, " ");
  if (prefecture === "東京都" && ward) return ward;
  if (/箱根/.test(text)) return "箱根";
  if (/軽井沢/.test(text)) return "軽井沢";
  if (/金沢/.test(text)) return "金沢";
  if (/直島/.test(text)) return "直島";
  if (/北茨城/.test(text)) return "北茨城";
  if (/瀬戸内/.test(text)) return "瀬戸内";
  if (city && ward) return `${city}${ward}`;
  if (city) return city;
  if (/京都/.test(text) || city === "京都市") return ward ? `京都市${ward}` : "京都";
  if (/前橋/.test(text)) return "前橋";
  if (/北杜/.test(text)) return "北杜";
  if (/北茨城/.test(text)) return "北茨城市";
  if (/熱海/.test(text)) return "熱海";
  return null;
}

function inferWard(text: string, prefecture: string | null) {
  if (prefecture === "東京都") {
    return text.match(/東京都([^,\s]{1,8}区)/)?.[1] ?? text.match(/([^,\s]{1,8}区)/)?.[1] ?? null;
  }
  const cityWard = text.match(/(?:都|道|府|県)?[^,\s]{1,12}市([^,\s]{1,8}区)/)?.[1];
  if (cityWard) return cityWard;
  return null;
}

function inferCity(text: string, prefecture: string | null) {
  if (prefecture) {
    const afterPrefecture = text.slice(text.indexOf(prefecture) + prefecture.length);
    const city = afterPrefecture.match(/^([^,\s]{1,12}市)/)?.[1];
    if (city) return city;
    const districtTown = afterPrefecture.match(/(?:[^,\s]{1,12}郡)?([^,\s]{1,12}[町村])/)?.[1];
    if (districtTown) return districtTown;
  }
  return text.match(/([^都道府県,\s]{1,12}市)/)?.[1] ?? text.match(/([^都道府県,\s]{1,12}[町村])/)?.[1] ?? (prefecture === "京都府" ? "京都市" : null);
}

function inferCoordinateRegion(lat: number | null, lng: number | null) {
  return COORDINATE_REGIONS.find((region) => inBounds(lat, lng, region.lat, region.lng)) ?? null;
}

function inBounds(lat: number | null, lng: number | null, latRange: [number, number], lngRange: [number, number]) {
  return lat !== null && lng !== null && lat >= latRange[0] && lat <= latRange[1] && lng >= lngRange[0] && lng <= lngRange[1];
}

function googleRegionText(raw: Record<string, unknown>) {
  const google = raw.google;
  if (!google || typeof google !== "object") return "";
  const googleRecord = google as Record<string, unknown>;
  const candidate = typeof googleRecord.candidate_place === "object" && googleRecord.candidate_place !== null
    ? googleRecord.candidate_place as Record<string, unknown>
    : null;
  const record = candidate ?? googleRecord;
  return [
    record.formattedAddress,
    record.formatted_address,
    addressComponentsText(record.addressComponents),
    addressComponentsText(record.address_components),
    typeof record.displayName === "object" && record.displayName !== null ? (record.displayName as Record<string, unknown>).text : null,
    record.googleMapsUri,
    record.primaryType,
    Array.isArray(record.types) ? record.types.join(" ") : null,
    candidate ? googleRecord.googleMapsUri : null
  ].filter(Boolean).join(" ");
}

function addressComponentsText(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value
    .map((component) => {
      if (typeof component !== "object" || component === null) return null;
      const record = component as Record<string, unknown>;
      return record.longText ?? record.long_name ?? record.shortText ?? record.short_name ?? null;
    })
    .filter(Boolean)
    .join(" ");
}
