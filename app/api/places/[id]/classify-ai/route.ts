import { NextResponse } from "next/server";
import { buildAIClassificationInput, classificationToDbPayload, classifyPlaceWithAI } from "@/lib/classification/ai";
import { AdminAuthError, assertAdminRequest, getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertAdminRequest(request);
    const body = await request.json().catch(() => ({}));
    const apply = body.apply === true;
    const force = body.force === true;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY が未設定です。.env.local に OPENAI_API_KEY を設定してください。" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: place, error } = await supabase
      .from("places")
      .select("*, place_classifications(*), source_links(*)")
      .eq("id", params.id)
      .single();
    if (error) throw error;

    const classification = firstClassification(place.place_classifications);
    if (classification?.manual_override === true && !force) {
      return NextResponse.json({
        skipped: true,
        reason: "manual_override=true のためAI分類では上書きしません。force=true の場合のみ上書きします。"
      });
    }

    const input = buildAIClassificationInput(place);
    const result = await classifyPlaceWithAI(input, { apiKey });

    if (apply) {
      const { error: updateError } = await supabase
        .from("place_classifications")
        .upsert({
          place_id: params.id,
          ...classificationToDbPayload(result, "ai"),
          manual_override: false
        }, { onConflict: "place_id" });
      if (updateError) throw updateError;
    }

    return NextResponse.json({
      skipped: false,
      applied: apply,
      classification: result
    });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function firstClassification(value: unknown) {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
