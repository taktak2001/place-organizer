import { NextResponse } from "next/server";
import { getSupabaseRead } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = getSupabaseRead();
    const { data, error } = await supabase
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return NextResponse.json({ batches: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: String(error), batches: [] }, { status: 500 });
  }
}
