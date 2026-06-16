import { getSupabaseAdmin } from "./server";

export type SupabaseStatus<T> = {
  data: T;
  error: string | null;
};

export async function safeQuery<T>(fallback: T, query: (supabase: ReturnType<typeof getSupabaseAdmin>) => Promise<T>): Promise<SupabaseStatus<T>> {
  try {
    const supabase = getSupabaseAdmin();
    const data = await query(supabase);
    return { data, error: null };
  } catch (error) {
    return { data: fallback, error: String(error) };
  }
}
