import { RESTAURANT_SCENE_TAGS } from "./ai";

export type RestaurantSceneTag = typeof RESTAURANT_SCENE_TAGS[number];

export type RestaurantSceneInput = {
  name: string;
  source_list_names: string[];
  address: string | null;
  primary_type: string | null;
  types: string[];
  website_url: string | null;
  rating: number | null;
  price_level: number | null;
};

export type RestaurantSceneResult = {
  scene_tags: RestaurantSceneTag[];
  confidence: number;
  reason: string;
  source: "rule" | "ai" | "hybrid";
  ai_raw?: Record<string, unknown> | null;
  ai_model?: string | null;
};

const SCENE_TAG_SET = new Set<string>(RESTAURANT_SCENE_TAGS);

export function classifyRestaurantScenesByRule(input: RestaurantSceneInput): RestaurantSceneResult {
  const text = [
    input.name,
    input.source_list_names.join(" "),
    input.address,
    input.primary_type,
    input.types.join(" "),
    input.website_url,
    input.rating,
    input.price_level
  ].filter(Boolean).join(" ");
  const tags = new Set<RestaurantSceneTag>();
  const reasons: string[] = [];

  if (/ラーメン|ramen|カレー|curry|蕎麦|そば|soba|定食|食堂/i.test(text)) {
    add(tags, ["Solo", "Casual"]);
    reasons.push("solo/casual keyword");
  }
  if (/ビストロ|bistro|イタリアン|italian|フレンチ|french|ワインバー|wine\s?bar|wine/i.test(text)) {
    add(tags, ["Date"]);
    reasons.push("date keyword");
  }
  if (/鮨|寿司|sushi|会席|懐石|個室|高級|コース|course|fine dining|omakase/i.test(text)) {
    add(tags, ["Business", "High-end"]);
    reasons.push("business/high-end keyword");
  }
  if (/居酒屋|izakaya|焼肉|yakiniku|バル|bar\b|大衆|酒場|pub/i.test(text)) {
    add(tags, ["Group", "Casual"]);
    reasons.push("group/casual keyword");
  }
  if (/地方名物|名物|観光地|旅先|旅行|local|tourist|郷土|regional/i.test(text)) {
    add(tags, ["Travel", "Local"]);
    reasons.push("travel/local keyword");
  }
  if (input.price_level !== null && input.price_level >= 4) {
    add(tags, ["High-end"]);
    reasons.push("price level");
  }
  if (input.rating !== null && input.rating >= 4.5 && tags.size === 0) {
    add(tags, ["Date"]);
    reasons.push("high rating fallback");
  }
  if (tags.size === 0 && /restaurant|food|meal|dining|飲食|レストラン/i.test(text)) {
    add(tags, ["Casual"]);
    reasons.push("restaurant fallback");
  }

  return {
    scene_tags: [...tags],
    confidence: tags.size > 0 ? 0.72 : 0.35,
    reason: reasons.join(", ") || "no scene rule matched",
    source: "rule"
  };
}

export async function classifyRestaurantScenesWithAI(input: RestaurantSceneInput, apiKey: string, model = process.env.OPENAI_MODEL ?? "gpt-4o-mini") {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: restaurantScenePrompt() },
        { role: "user", content: JSON.stringify({ ...input, website_url_exists: Boolean(input.website_url), website_url: undefined }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI API response did not include JSON content.");
  const raw = JSON.parse(content) as Record<string, unknown>;
  const tags = normalizeSceneTags(raw.scene_tags);
  return {
    scene_tags: tags,
    confidence: clampConfidence(raw.confidence, tags.length > 0 ? 0.75 : 0.4),
    reason: cleanText(raw.reason) ?? "ai restaurant scene classification",
    source: "ai" as const,
    ai_raw: raw,
    ai_model: model
  };
}

export function normalizeSceneTags(value: unknown): RestaurantSceneTag[] {
  const values = Array.isArray(value) ? value : [];
  const tags = values.map((item) => {
    const text = String(item ?? "").trim();
    return RESTAURANT_SCENE_TAGS.find((tag) => tag.toLowerCase() === text.toLowerCase()) ?? null;
  }).filter((item): item is RestaurantSceneTag => item !== null && SCENE_TAG_SET.has(item));
  return [...new Set(tags)];
}

function restaurantScenePrompt() {
  return [
    "Classify restaurant usage scenes for a private place organizer.",
    "Return JSON only.",
    `scene_tags must be a subset of: ${RESTAURANT_SCENE_TAGS.join(", ")}.`,
    "Use multiple scene_tags when appropriate.",
    "Rules: ramen/curry/soba/set meal means Solo and Casual. Bistro/Italian/French/wine bar means Date. Sushi/kaiseki/private room/high-end/course means Business and High-end. Izakaya/yakiniku/bar/popular casual means Group and Casual. Local specialty/tourist/travel place means Travel and Local.",
    "If unsure, use Casual or an empty array.",
    "Output keys: scene_tags, confidence, reason."
  ].join("\n");
}

function add(target: Set<RestaurantSceneTag>, values: RestaurantSceneTag[]) {
  for (const value of values) target.add(value);
}

function clampConfidence(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
