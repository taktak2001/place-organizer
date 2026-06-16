import { getSupabaseRead } from "./server";

export type SupabaseStatus<T> = {
  data: T;
  error: string | null;
};

export async function safeQuery<T>(fallback: T, query: (supabase: ReturnType<typeof getSupabaseRead>) => Promise<T>): Promise<SupabaseStatus<T>> {
  try {
    const supabase = getSupabaseRead();
    const data = await query(supabase);
    return { data, error: null };
  } catch (error) {
    return { data: fallback, error: String(error) };
  }
}
