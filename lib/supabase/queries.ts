import { getSupabaseRead } from "./server";

export type SupabaseStatus<T> = {
  data: T;
  error: string | null;
};

export type SafeSupabaseError = {
  query: string;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

export async function safeQuery<T>(
  fallback: T,
  query: (supabase: ReturnType<typeof getSupabaseRead>) => Promise<T>,
  queryName = "supabaseQuery"
): Promise<SupabaseStatus<T>> {
  try {
    const supabase = getSupabaseRead();
    const data = await query(supabase);
    return { data, error: null };
  } catch (error) {
    return { data: fallback, error: formatSupabaseError(error, queryName) };
  }
}

export function formatSupabaseError(error: unknown, queryName: string) {
  const safe = safeSupabaseError(error, queryName);
  const lines = [
    `query: ${safe.query}`,
    `message: ${safe.message}`,
    safe.code ? `code: ${safe.code}` : null,
    safe.details ? `details: ${safe.details}` : null,
    safe.hint ? `hint: ${safe.hint}` : null
  ].filter(Boolean);
  return lines.join("\n");
}

export function safeSupabaseError(error: unknown, queryName: string): SafeSupabaseError {
  if (error instanceof Error) {
    return sanitizeErrorObject({
      query: queryName,
      message: error.message,
      ...plainObject(error)
    });
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return sanitizeErrorObject({
      query: queryName,
      message: stringValue(record.message) ?? "Supabase query failed",
      code: stringValue(record.code),
      details: stringValue(record.details),
      hint: stringValue(record.hint)
    });
  }
  return sanitizeErrorObject({ query: queryName, message: String(error || "Supabase query failed") });
}

function plainObject(error: Error) {
  return Object.fromEntries(Object.entries(error));
}

function sanitizeErrorObject(error: SafeSupabaseError): SafeSupabaseError {
  return {
    query: sanitizeText(error.query),
    message: sanitizeText(error.message),
    code: error.code ? sanitizeText(error.code) : undefined,
    details: error.details ? sanitizeText(error.details) : undefined,
    hint: error.hint ? sanitizeText(error.hint) : undefined
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function sanitizeText(value: string) {
  return value
    .replace(/https?:\/\/[^\s)]+/g, "[redacted-url]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/(apikey|api_key|key|token)=([^&\s]+)/gi, "$1=[redacted]");
}
